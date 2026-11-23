import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {getAddress} from 'viem'
import {reader,readMatch} from '../chain.js'
import {installTransport,leader} from '../transport.js'

installTransport()
const evidence = JSON.parse(readFileSync('evidence/studionet.json','utf8'))
const source = readFileSync('contracts/switchyard.py')
assert.equal(Number(await reader.getChainId()),61999)
assert.equal(evidence.chainId,61999)
assert.equal(createHash('sha256').update(source).digest('hex'),evidence.sourceSha256)
assert.deepEqual(Buffer.from(await reader.getContractCode(getAddress(evidence.address))),source)
for(const [label,step] of Object.entries(evidence.steps)){
  const receipt=await reader.getTransaction({hash:step.hash})
  assert.equal(receipt.statusName,'FINALIZED',label)
  assert.equal(receipt.result_name,'MAJORITY_AGREE',label)
  assert.equal(receipt.from_address.toLowerCase(),step.sender,label)
  assert.equal(leader(receipt)?.execution_result,step.execution,label)
  if(label==='deployment'){
    assert.equal(receipt.data.contract_address.toLowerCase(),evidence.address.toLowerCase())
  }
  if(label==='duplicate-dispatch'){
    assert.match(JSON.stringify(leader(receipt)?.result),/DISPATCH_ALREADY_SIGNED/)
    assert.deepEqual(step.readback,evidence.steps['split-tracks-first'].readback)
  }
  console.log(label,receipt.statusName,step.execution,step.hash)
}
for(const [label,state,reason] of [
  ['split-tracks-resolve','CLEARED','BOTH_ARRIVED'],
  ['same-track-resolve','BLOCKED','OCCUPANCY_CONFLICT'],
]){
  const {readback}=evidence.steps[label]
  const match=await readMatch(evidence.address,readback.key)
  assert.deepEqual(match,readback)
  assert.equal(match.state,state)
  assert.equal(match.reason,reason)
  console.log(match.key,state,reason)
}

const collision=evidence.steps['same-track-resolve'].readback
assert.deepEqual(collision.attempted,['N','N'])
assert.equal(collision.stopped_at,1)

const browser = JSON.parse(readFileSync('evidence/browser-match.json','utf8'))
assert.equal(browser.chainId,evidence.chainId)
assert.equal(browser.address,evidence.address)
for(const [label,step] of Object.entries(browser.steps)){
  const receipt=await reader.getTransaction({hash:step.hash})
  assert.equal(receipt.statusName,'FINALIZED',label)
  assert.equal(receipt.result_name,'MAJORITY_AGREE',label)
  assert.equal(receipt.from_address.toLowerCase(),step.sender,label)
  assert.equal(leader(receipt)?.execution_result,'SUCCESS',label)
  console.log('browser '+label,receipt.statusName,step.hash)
}
const browserMatch=await readMatch(browser.address,browser.key)
assert.deepEqual(browserMatch,browser.readback)
assert.deepEqual(browserMatch.frames,[['W','E'],['S','N'],['E','W']])

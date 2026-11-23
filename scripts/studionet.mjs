import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {dirname} from 'node:path'
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {createAccount,createClient,generatePrivateKey} from 'genlayer-js'
import {studionet} from 'genlayer-js/chains'
import {installTransport} from '../transport.js'
installTransport()

const reader=createClient({chain:studionet})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const rpc='https://studio.genlayer.com/api'
const signer=secret=>{
  assert.match(secret ?? '',/^0x[0-9a-f]{64}$/i,'Provide an authorized Studionet test signer')
  const account=createAccount(secret)
  return {address:account.address.toLowerCase(), client:createClient({chain:studionet,account})}
}

export function lab(sourceFile) {
  const source=readFileSync(sourceFile,'utf8')
  const temporary=process.env.STUDIO_SIGNERS==='ephemeral'
  const owner=signer(temporary ? generatePrivateKey() : process.env.STUDIO_OWNER_KEY)
  const delegate=signer(temporary ? generatePrivateKey() : process.env.STUDIO_DELEGATE_KEY)
  const path=process.env.STUDIO_EVIDENCE_PATH ?? '.private/studionet.json'
  const sourceSha256=createHash('sha256').update(source).digest('hex')
  const evidence=existsSync(path) ? JSON.parse(readFileSync(path,'utf8'))
    : {chainId:61999,rpc,sourceSha256,owner:owner.address,delegate:delegate?.address,steps:{}}
  assert.equal(evidence.sourceSha256,sourceSha256)
  assert.equal(evidence.owner,owner.address)
  assert.equal(evidence.delegate,delegate?.address)
  mkdirSync(dirname(path),{recursive:true})
  const save=()=>writeFileSync(path,JSON.stringify(evidence,null,2)+'\n')
  async function read(method,...args) {
    const value=await reader.readContract({address:evidence.address,functionName:method,args,transactionHashVariant:'latest-final'})
    return value ? JSON.parse(value) : null
  }
  async function tx(label, method, args, verify, {actor=owner, expectedError}={}) {
    let step=evidence.steps[label]
    if (step?.verified) return step.readback
    if (!step) {
      assert.equal(Number(await reader.getChainId()),61999)
      assert.equal(BigInt(await reader.request({method:'eth_gasPrice',params:[]})),0n)
      evidence.steps[label]=step={method,args,sender:actor.address,hash:null}
      save()
      step.hash=method==='deploy'
        ? await actor.client.deployContract({code:source,args:[],leaderOnly:false})
        : await actor.client.writeContract({address:evidence.address,functionName:method,args,value:0n,leaderOnly:false})
      save()
    }
    assert(step.hash,'Submission is uncertain. Check the chain before any retry.')
    console.log(label,step.hash)
    let receipt
    for(let count=0;count<120;count++){
      try { receipt=await reader.getTransaction({hash:step.hash}) }
      catch { await delay(4000); continue }
      if ([7,'FINALIZED'].includes(receipt?.status)) break
      if (['CANCELED','UNDETERMINED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT'].includes(receipt?.statusName)) {
        throw Error('Terminal consensus status '+receipt.statusName)
      }
      await delay(4000)
    }
    assert([7,'FINALIZED'].includes(receipt?.status),'Finalization not confirmed')
    assert.equal(receipt.from_address.toLowerCase(),actor.address)
    assert([6,'MAJORITY_AGREE'].includes(receipt.result),'Consensus did not agree')
    const entries=[receipt.consensus_data?.leader_receipt].flat()
    const leader=entries.find(item=>item?.mode==='leader') ?? entries[0]
    assert(leader,'Leader receipt unavailable')
    Object.assign(step,{status:'FINALIZED',consensus:'MAJORITY_AGREE',execution:leader.execution_result})
    if (expectedError) step.error=leader.result?.payload?.readable ?? leader.result?.readable ?? JSON.stringify(leader.result)
    save()
    if(expectedError){
      assert.equal(step.execution,'ERROR')
      assert(String(step.error).includes(expectedError),String(step.error))
    } else assert.equal(step.execution,'SUCCESS',leader.result?.payload?.readable)
    step.readback=await verify(receipt)
    step.verified=true
    save()
    console.log(label,step.status,step.execution)
    return step.readback
  }
  async function deploy() {
    return tx('deployment','deploy',[],async receipt=>{
      evidence.address=receipt.data.contract_address
      assert.equal(await reader.getContractCode(evidence.address),source)
      return {address:evidence.address,sourceVerified:true}
    })
  }
  return {owner,delegate,read,tx,deploy}
}

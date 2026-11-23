import assert from 'node:assert/strict'
import {lab} from './studionet.mjs'

const {owner,delegate,read,tx,deploy}=lab('contracts/switchyard.py')
await deploy()
for(const [slug,second,end,reason] of [
  ['split-tracks','Tick 1: go to S. Tick 2: go to W. Tick 3: wait.','CLEARED','BOTH_ARRIVED'],
  ['same-track','Tick 1: go to N. Tick 2: go to W. Tick 3: wait.','BLOCKED','OCCUPANCY_CONFLICT'],
]){
  const key=owner.address+'/'+slug
  const first='Tick 1: go to N. Tick 2: go to E. Tick 3: wait.'
  async function state(expected){
    const match=await read('get_match',key)
    assert.equal(match.state,expected)
    assert.deepEqual(match.players,[owner.address,delegate.address])
    return match
  }
  await tx(slug+'-open','open_match',[slug,delegate.address],()=>state('PLANNING'))
  const planning=await tx(slug+'-first','dispatch',[key,first],()=>state('PLANNING'))
  if(end==='CLEARED') await tx('duplicate-dispatch','dispatch',[key,first],async()=>{
    const after=await state('PLANNING')
    assert.deepEqual(after,planning)
    return after
  },{expectedError:'DISPATCH_ALREADY_SIGNED'})
  await tx(slug+'-second','dispatch',[key,second],()=>state('READY'),{actor:delegate})
  await tx(slug+'-resolve','resolve',[key],async()=>{
    const result=await state(end)
    assert.equal(result.reason,reason)
    assert.deepEqual(result.frames,end==='CLEARED'?[['W','E'],['N','S'],['E','W']]:[['W','E']])
    return result
  })
}

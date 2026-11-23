import './style.css'
import {createAccount,createClient,generatePrivateKey} from 'genlayer-js'
import {formatEther,isAddress} from 'viem'
import deployment from './deployment.json'
import {chain,rpc,explorer,reader,checkNetwork,readMatch,waitFinalized} from './chain.js'

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(node=>[node.id,node]))
const temporary = new Map()
const faults = {
  BOTH_ARRIVED:'Both trains reached the opposite terminal.',
  OCCUPANCY_CONFLICT:'Both trains requested the same station.',
  HEAD_ON_SWAP:'The trains attempted to swap ends on the same track.',
  ILLEGAL_TRACK:'A train requested a destination without a direct rail connection.',
  TIME_LIMIT:'The trains did not reach both terminals within three ticks.',
  UNRESOLVED_INSTRUCTION:'A dispatch contains an ambiguous or incomplete instruction.',
}
let actor = null
let provider = null
let match = null
let matchAddress = null
let busy = false
let frames = [['W','E']]

function renderFrame(){
  const tick = Number(ui.tick.value)
  const positions = frames[tick]
  for(const station of document.querySelectorAll('[data-stop]')){
    const [west,east] = positions.map(stop=>stop===station.dataset.stop)
    station.dataset.train = west && east ? 'conflict' : west ? 'west' : east ? 'east' : ''
  }
  const rejected = match?.attempted && tick===frames.length-1
  ui.frame.textContent = (rejected ? 'Rejected move' : tick ? 'Tick '+tick : 'Start')+' · West at '+positions[0]+', East at '+positions[1]
}

function controls(){
  const seat = match && actor ? match.players.indexOf(actor.address.toLowerCase()) : -1
  const same = ui.contract.value.trim().toLowerCase()===matchAddress?.toLowerCase()
  ui.open.hidden = !actor
  ui.dispatch.hidden = !same || seat<0 || match.state!=='PLANNING' || Boolean(match.instructions[seat])
  ui.resolve.hidden = !same || seat<0 || match.state!=='READY'
  ui.actor.textContent = actor ? actor.address+' · '+(actor.local ? 'Temporary Studionet wallet' : 'Injected wallet · network checked before signing') : 'Public read mode'
}

function render(){
  frames = [...(match?.frames ?? [['W','E']]), ...(match?.attempted ? [match.attempted] : [])]
  ui.tick.value = 0
  ui.tick.max = frames.length-1
  renderFrame()
  ui.decision.textContent = match ? match.state+' · '+(faults[match.reason] ?? (match.state==='READY' ? 'Either player can resolve the signed dispatches.' : 'Waiting for the unsigned player seats.'))+(match.resolved_by ? ' Resolved by '+match.resolved_by+'.' : '') : 'Load a finalized match to inspect its dispatch.'
  ui.plans.replaceChildren()
  for(const [seat,address] of (match?.players ?? []).entries()){
    const item = document.createElement('li')
    item.textContent = (seat===0 ? 'West' : 'East')+' · '+address+' · '+(match.instructions[seat] || 'Awaiting signature')+(match.plans ? ' → '+match.plans[seat].join(' / ') : '')
    ui.plans.append(item)
  }
  controls()
}

async function load(address,key){
  if(!isAddress(address)) throw Error('Enter a valid Studionet contract address.')
  const result = await readMatch(address,key)
  matchAddress = address
  match = result
  render()
  ui.status.textContent = result ? 'Finalized match loaded' : 'No finalized match exists for this reference.'
}

function work(action){
  return async event=>{
    event?.preventDefault()
    if(busy) return
    busy=true
    try { await action() }
    catch(error){ ui.status.textContent=error.shortMessage ?? error.message }
    finally{ busy=false }
  }
}

async function changeNetwork(){
  const chainId = '0xf22f'
  if(Number(await provider.request({method:'eth_chainId'}))===61999) return
  try { await provider.request({method:'wallet_switchEthereumChain',params:[{chainId}]}) }
  catch(error){
    if(error.code!==4902) throw error
    await provider.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:'GenLayer Stable Studionet',rpcUrls:[rpc],blockExplorerUrls:[explorer],nativeCurrency:{name:'GEN',symbol:'GEN',decimals:18}}]})
  }
  if(Number(await provider.request({method:'eth_chainId'}))!==61999) throw Error('Switch the wallet to Stable Studionet (61999).')
}

async function transact(method,args,key){
  const address=ui.contract.value.trim()
  if(!actor || !isAddress(address)) throw Error('Select a wallet and a valid contract address.')
  const signer=actor
  await checkNetwork()
  if(!signer.local) await changeNetwork()
  if(actor!==signer) throw Error('Wallet changed. Review the action again.')
  const {distribution,feeValue}=await reader.estimateTransactionFees()
  if(feeValue>200000000000000000n) throw Error('Test fee deposit exceeds 0.2 GEN.')
  if(BigInt(await reader.getBalance({address:signer.address}))<feeValue) throw Error('Insufficient Studionet test GEN for the consensus deposit.')
  if(actor!==signer) throw Error('Wallet changed. Review the action again.')
  if(!confirm('Sign '+method.replaceAll('_',' ')+' on Stable Studionet with a maximum deposit of '+formatEther(feeValue)+' test GEN?')) return
  ui.status.textContent='Waiting for signature and submission'
  ui.receipt.hidden=true
  const client=createClient({chain,account:signer.local ?? signer.address,...(signer.local ? {} : {provider})})
  let hash
  try{ hash=await client.writeContract({address,functionName:method,args,value:0n,leaderOnly:false,fees:{distribution,feeValue}}) }
  catch(error){
    const failure=error.message.match(/EVM tx (0x[a-f0-9]{64})/i)?.[1]
    if(failure) showReceipt(failure)
    throw error
  }
  showReceipt(hash)
  ui.status.textContent='Submitted · waiting for consensus'
  try{
    await waitFinalized(hash, status=>{ui.status.textContent=status})
  } catch(error){
    await load(address,key).catch(()=>{})
    throw error
  }
  ui.key.value=key
  try{ await load(address,key) }
  catch(error){ throw Error('FINALIZED / SUCCESS · readback failed: '+error.message) }
  if(!match) throw Error('FINALIZED / SUCCESS · match was absent on finalized readback.')
  ui.status.textContent='FINALIZED / SUCCESS · match reread from chain'
}

function showReceipt(hash){
  ui.receipt.href=explorer+'/tx/'+hash
  ui.receipt.hidden=false
}

ui.lookup.onsubmit=work(()=>load(ui.contract.value.trim(),ui.key.value.trim()))
ui.tick.oninput=renderFrame
ui.contract.oninput=controls
ui.open.onsubmit=work(()=>{
  const slug=ui.slug.value.trim()
  if(!/^[a-z0-9-]{3,32}$/.test(slug) || !isAddress(ui.guest.value.trim())) throw Error('Use a valid match ID and East player address.')
  return transact('open_match',[slug,ui.guest.value.trim()],actor.address.toLowerCase()+'/'+slug)
})
ui.dispatch.onsubmit=work(()=>transact('dispatch',[match.key,ui.instruction.value],match.key))
ui.resolve.onclick=work(()=>transact('resolve',[match.key],match.key))
ui.temporary.onclick=work(async()=>{
  await checkNetwork()
  const local=createAccount(generatePrivateKey())
  ui.status.textContent='Requesting Studionet faucet funds'
  await reader.request({method:'sim_fundAccount',params:[local.address,'2000000000000000000']})
  if(BigInt(await reader.getBalance({address:local.address}))===0n) throw Error('Faucet funding is not visible yet.')
  ui.status.textContent='Temporary Studionet wallet funded'
  actor={address:local.address,local}
  temporary.set(local.address,actor)
  ui.wallet.add(new Option(local.address,local.address))
  ui.wallet.value=local.address
  controls()
})
ui.wallet.onchange=()=>{actor=temporary.get(ui.wallet.value) ?? null;controls()}
ui.connect.onclick=work(async()=>{
  provider=globalThis.ethereum
  if(!provider?.request) throw Error('No injected EIP-1193 wallet was found.')
  const [address]=await provider.request({method:'eth_requestAccounts'})
  if(!isAddress(address)) throw Error('No wallet account was made available.')
  actor={address}
  const activeProvider=provider
  provider.on?.('accountsChanged',accounts=>{
    if(provider!==activeProvider || actor?.local) return
    actor=isAddress(accounts[0]) ? {address:accounts[0]} : null
    controls()
  })
  controls()
})
ui.disconnect.onclick=()=>{
  if(busy) return
  actor=null
  provider=null
  temporary.clear()
  ui.wallet.replaceChildren()
  controls()
}
if(deployment.address){
  ui.contract.value=deployment.address
  const contractLink=document.createElement('a')
  contractLink.href=explorer+'/address/'+deployment.address
  contractLink.textContent='View contract on Explorer'
  ui.evidence.append(contractLink)
}
for(const example of deployment.examples ?? []){
  const button=document.createElement('button')
  button.textContent=example.title
  button.onclick=work(async()=>{
    ui.contract.value=deployment.address
    ui.key.value=example.key
    await load(deployment.address,example.key)
    if(example.hash) showReceipt(example.hash)
  })
  ui.examples.append(button)
}
if(!deployment.address) ui.status.textContent='No verified deployment is configured. Enter an independently deployed contract to connect.'
render()

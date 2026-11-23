import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

export const chain = studionet
export const rpc = 'https://studio.genlayer.com/api'
export const explorer = 'https://explorer-studio.genlayer.com'
export const reader = createClient({chain})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function readMatch(address, key) {
  const result = await reader.readContract({
    address, functionName: 'get_match', args: [key], transactionHashVariant: 'latest-final',
  })
  return result ? JSON.parse(result) : null
}

export async function checkNetwork(client = reader) {
  if (Number(await client.getChainId()) !== 61999) throw Error('Expected Stable Studionet (61999).')
  if (BigInt(await client.request({method: 'eth_gasPrice', params: []})) !== 0n) {
    throw Error('Studionet reported a nonzero gas price. Submission stopped.')
  }
}

export async function waitFinalized(hash, update = () => {}, {allowExecutionError=false} = {}) {
  for (let attempt = 0; attempt < 120; attempt++) {
    let tx
    try {
      tx = await reader.getTransaction({hash})
    } catch (error) {
      update('Receipt unavailable · retrying')
    }
    if (tx) {
      update(tx.statusName ?? String(tx.status))
      if ([7, 'FINALIZED'].includes(tx.status)) {
        const receipts = [tx.consensus_data?.leader_receipt].flat()
        const leader = receipts.find(item => item?.mode === 'leader') ?? receipts[0]
        if (![6, 'MAJORITY_AGREE'].includes(tx.result) || !leader) {
          throw Error('FINALIZED · Consensus result: ' + (tx.result_name ?? tx.result))
        }
        if (leader.execution_result !== 'SUCCESS' && !allowExecutionError) {
          const reason = leader.result?.payload
          throw Error('FINALIZED / ' + leader.execution_result + (typeof reason === 'string' ? ' · ' + reason : ''))
        }
        return tx
      }
      if (tx.status === 8 || ['CANCELED', 'UNDETERMINED', 'LEADER_TIMEOUT', 'VALIDATORS_TIMEOUT'].includes(tx.statusName ?? tx.status)) {
        throw Error('Consensus stopped: ' + (tx.statusName ?? tx.status))
      }
    }
    await delay(3500)
  }
  throw Error('Finality polling timed out. Use the transaction link to check before retrying.')
}

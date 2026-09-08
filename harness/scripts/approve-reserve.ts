/**
 * Cordon — ensure the reserve allowance for the Aave V3 Pool.
 *
 * The Pool pulls the top-up asset during supply(); it needs an ERC-20
 * allowance first. Approves max uint256 (standard DeFi practice).
 *
 * Simulate → gate → execute → poll, exactly like every other write.
 *
 * Run with: npm run approve -- RESERVE=LINK
 */

import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'
import { AAVE_V3_SEPOLIA, RESERVES, type ReserveSymbol } from '../src/aave-v3.js'

async function main() {
  const config = loadConfig()
  const reserve = (process.env.RESERVE ?? 'LINK') as ReserveSymbol
  const asset = RESERVES[reserve]
  const kh = new KeeperHubClient(config.khApiKey)

  const MAX_UINT = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  const args = {
    chainId: String(config.chainId),
    contractAddress: asset.underlying,
    functionName: 'approve',
    functionArgs: JSON.stringify([AAVE_V3_SEPOLIA.pool, MAX_UINT]),
  }

  console.log(`\nCordon — approve ${reserve} for Aave V3 Pool`)
  console.log(`Token:    ${asset.underlying}`)
  console.log(`Spender:  ${AAVE_V3_SEPOLIA.pool}`)

  const sim = await kh.simulateContractCall(args)
  if (!sim.success || sim.wouldRevert) {
    console.log(`\napprove  → REFUSED by simulation gate: ${sim.error ?? 'would revert'}`)
    process.exit(1)
  }
  console.log(`\napprove  → simulation passed, broadcasting…`)

  const result = await kh.safeContractWrite({
    ...args,
    idempotencyKey: `approve-${reserve}-${Date.now().toString(36)}`,
  })
  if (result.refused) {
    console.log(`approve  → REFUSED: ${result.error}`)
    process.exit(1)
  }
  console.log(`approve  → ${result.status} ${result.txHash ?? ''}`)
  console.log(`\nverified → https://sepolia.etherscan.io/tx/${result.txHash}`)
}

main().catch((err) => {
  console.error(`\napprove failed: ${err.message}`)
  process.exit(1)
})
/**
 * Cordon — mint testnet reserve assets from the Aave V3 Sepolia faucet.
 *
 * The faucet signature is mint(address token, address to, uint256 amount).
 * Simulate → gate → execute → poll, like every other write.
 *
 * Run with: npm run mint -- RESERVE=LINK AMOUNT=100
 */

import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'
import { AAVE_V3_SEPOLIA, RESERVES, type ReserveSymbol } from '../src/aave-v3.js'
import { toWei } from '../src/aave-v3.js'

async function main() {
  const config = loadConfig()
  const reserve = (process.env.RESERVE ?? 'LINK') as ReserveSymbol
  const amount = Number(process.env.AMOUNT ?? '10')
  const asset = RESERVES[reserve]
  const kh = new KeeperHubClient(config.khApiKey)

  const args = {
    chainId: String(config.chainId),
    contractAddress: AAVE_V3_SEPOLIA.faucet,
    functionName: 'mint',
    functionArgs: JSON.stringify([asset.underlying, config.positionAddress, toWei(reserve, amount)]),
  }

  console.log(`\nCordon — mint ${amount} ${reserve} from Aave V3 Sepolia faucet`)
  console.log(`Faucet:   ${AAVE_V3_SEPOLIA.faucet}`)
  console.log(`To:       ${config.positionAddress}`)

  const sim = await kh.simulateContractCall(args)
  if (!sim.success || sim.wouldRevert) {
    console.log(`\nmint      → REFUSED by simulation gate: ${sim.error ?? 'would revert'}`)
    process.exit(1)
  }
  console.log(`\nmint      → simulation passed, broadcasting…`)

  const result = await kh.safeContractWrite({
    ...args,
    idempotencyKey: `mint-${reserve}-${Date.now().toString(36)}`,
  })
  if (result.refused) {
    console.log(`mint      → REFUSED: ${result.error}`)
    process.exit(1)
  }
  console.log(`mint      → ${result.status} ${result.txHash ?? ''}`)
  console.log(`\nverified → https://sepolia.etherscan.io/tx/${result.txHash}`)
}

main().catch((err) => {
  console.error(`\nmint failed: ${err.message}`)
  process.exit(1)
})
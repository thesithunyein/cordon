/**
 * Set up a REAL second Aave V3 position so the multi-position watchlist
 * guards two live positions: faucet-mint LINK → approve Pool → supply LINK
 * collateral → borrow USDC so the position carries debt (finite HF).
 *
 * Every write: simulate → gate → execute → poll, same as every Cordon action.
 * Receipts land as type "drill" with decision "setup-second".
 *
 * Run with: npx tsx --env-file=.env scripts/setup-second.ts
 */
import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'
import { AAVE_V3_SEPOLIA, RESERVES, toWei } from '../src/aave-v3.js'
import { appendReceipt } from '../src/receipts.js'

const SECOND = '0x809d8252aa4f9b8f7d9be7213855b289fe7d0444'
const MAX_UINT = (2n ** 256n - 1n).toString()

async function main() {
  const c = loadConfig()
  const kh = new KeeperHubClient(c.khApiKey)
  const nonce = Date.now().toString(36)
  const link = RESERVES.LINK
  const usdc = RESERVES.USDC

  async function raw(name: string, functionName: string, functionArgs: string, contractAddress: string) {
    console.log(`→ ${name} …`)
    const r = await kh.safeContractWrite({
      chainId: String(c.chainId),
      contractAddress,
      functionName,
      functionArgs,
      idempotencyKey: `setup2-${name}-${nonce}`,
    })
    console.log(`   ${r.refused ? 'REFUSED' : r.status} ${r.txHash ?? ''} ${r.error ?? ''}`)
    await appendReceipt({
      type: 'drill',
      timestamp: new Date().toISOString(),
      position: SECOND,
      positionLabel: 'Secondary',
      healthFactorBefore: null,
      healthFactorAfter: null,
      decision: 'setup-second',
      action: name,
      refused: r.refused,
      txHash: r.txHash ?? null,
      status: r.status,
      error: r.error ?? null,
    })
    return r
  }

  // 1. faucet-mint 25 LINK for SECOND
  await raw('faucet-mint-LINK', 'mint', JSON.stringify([link.underlying, SECOND, toWei('LINK', 25)]), AAVE_V3_SEPOLIA.faucet)

  // 2. approve Pool to pull LINK from SECOND
  await raw('approve-LINK', 'approve', JSON.stringify([AAVE_V3_SEPOLIA.pool, MAX_UINT]), link.underlying)

  // 3. supply 25 LINK collateral
  await raw('supply-LINK', 'supply', JSON.stringify([link.underlying, toWei('LINK', 25), SECOND, '0']), AAVE_V3_SEPOLIA.pool)

  // 4. borrow 3 USDC → position has debt, finite HF. Standard ABI order: borrow(asset, amount, interestRateMode, referralCode, onBehalfOf).
  // The '2' variable rate mode must be passed as a number the encoder accepts; SECOND as the last address arg.
  await raw('borrow-USDC', 'borrow', JSON.stringify([usdc.underlying, toWei('USDC', 3), '2', '0', SECOND]), AAVE_V3_SEPOLIA.pool)

  console.log('\nDone. Second position: LINK collateral + USDC debt.')
}

main().catch((err) => {
  console.error(`setup-second failed: ${err.message}`)
  process.exit(1)
})

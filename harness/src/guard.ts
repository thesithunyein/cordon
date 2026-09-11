/**
 * Cordon — one full guardian cycle across every watched position.
 *
 *   detect → decide → (protect → verify) → record   (per position)
 *
 * Watchlist: POSITION_ADDRESS always cycles. EXTRA_POSITIONS adds more
 * (comma-separated `address[:threshold]`), POSITION_LABELS names them
 * (`0x..=Label`). Single-position setups are unchanged: empty
 * EXTRA_POSITIONS produces exactly the pre-multi behavior.
 *
 * Run with: npm run guard
 */

import { loadConfig } from './config.js'
import { KeeperHubClient } from './kh-client.js'
import { Guardian } from './guardian.js'
import { appendReceipt, type Receipt } from './receipts.js'

async function main() {
  const config = loadConfig()
  const kh = new KeeperHubClient(config.khApiKey)
  const root = new Guardian(kh, config)

  // Watchlist: primary first, then extras. Positional thresholds apply to
  // their own position; the primary keeps its env threshold.
  const watchlist = [
    { address: config.positionAddress, threshold: config.healthFactorThreshold },
    ...config.extraPositions,
  ]

  console.log(`\nCordon — guardian cycle`)
  console.log(`Watching:  ${watchlist.length} position${watchlist.length === 1 ? '' : 's'}`)
  for (const p of watchlist) {
    const g = root.forPosition(p)
    console.log(`  ${g.label()}  threshold ${p.threshold}`)
  }
  console.log(`Chain:     ${config.chainId} (Ethereum Sepolia)\n`)

  for (const p of watchlist) {
    const guardian = root.forPosition(p)

    // detect
    const snapshot = await guardian.detect()
    const hf = Number(snapshot.healthFactor) / 1e18
    console.log(`[${guardian.label()}] detect   → health factor ${hf.toFixed(4)} (${snapshot.atRisk ? 'AT RISK' : 'safe'})`)

    // decide
    const decision = guardian.decide(snapshot)
    console.log(`[${guardian.label()}] decide   → ${decision}`)

    if (decision === 'stand-down') {
      console.log(`[${guardian.label()}] stand-down: position healthy, no action.`)
      await appendReceipt({
        type: 'guard-cycle',
        timestamp: new Date().toISOString(),
        position: p.address,
        positionLabel: guardian.label(),
        healthFactorBefore: snapshot.healthFactor,
        healthFactorAfter: snapshot.healthFactor,
        decision: 'stand-down',
        action: 'stand-down',
        txHash: null,
        status: 'ok',
      })
      continue
    }

    // protect
    const nonce = Date.now().toString(36)
    const protection = await guardian.protect(config.reserve, config.topUpAmount, nonce)
    console.log(`[${guardian.label()}] protect  → ${protection.refused ? 'REFUSED (simulation gate)' : 'executed'} ${protection.txHash ?? ''}`)
    if (protection.refused) console.log(`[${guardian.label()}]           ${protection.error ?? ''}`)

    // verify
    const after = protection.status === 'completed' ? await guardian.verify() : null
    if (after) {
      const hfAfter = Number(after.healthFactor) / 1e18
      console.log(`[${guardian.label()}] verify   → health factor ${hfAfter.toFixed(4)} after protection`)
    }

    const receipt: Receipt = {
      type: 'guard-cycle',
      timestamp: new Date().toISOString(),
      position: p.address,
      positionLabel: guardian.label(),
      healthFactorBefore: snapshot.healthFactor,
      healthFactorAfter: after?.healthFactor ?? null,
      decision,
      action: 'top-up',
      asset: config.reserve,
      amount: String(config.topUpAmount),
      refused: protection.refused,
      txHash: protection.txHash ?? null,
      executionId: protection.executionId ?? null,
      status: protection.status,
      error: protection.error ?? null,
    }
    await appendReceipt(receipt)
  }

  console.log(`\nrecorded → harness/receipts/receipts.json`)
}

main().catch((err) => {
  console.error(`\nCordon guard failed: ${err.message}`)
  process.exit(1)
})

/**
 * Cordon — the evidence campaign.
 *
 * Runs N guard cycles and exports every receipt. The point is scale and
 * honesty: real transactions, real refusals, nothing asserted.
 *
 * Run with: npm run campaign
 */

import { loadConfig } from './config.js'
import { KeeperHubClient } from './kh-client.js'
import { Guardian } from './guardian.js'
import { appendReceipt, summary, type Receipt } from './receipts.js'

async function main() {
  const config = loadConfig()
  const kh = new KeeperHubClient(config.khApiKey)
  const root = new Guardian(kh, config)

  // Watchlist: primary first, then extras (same semantics as guard.ts).
  const watchlist = [
    { address: config.positionAddress, threshold: config.healthFactorThreshold },
    ...config.extraPositions,
  ]

  // Escalating mode: after each completed protective execution, raise the
  // threshold just above the verified health factor so the next round executes
  // again. Used to build real-execution evidence volume on testnet.
  const escalate = process.env.CAMPAIGN_ESCALATE === 'true'

  const rounds = config.campaignRounds
  console.log(`\nCordon — evidence campaign: ${rounds} rounds x ${watchlist.length} position${watchlist.length === 1 ? '' : 's'}`)
  for (const p of watchlist) {
    const g = root.forPosition(p)
    console.log(`  ${g.label()}  threshold ${p.threshold}`)
  }
  console.log(`Threshold base: health factor < ${config.healthFactorThreshold}${escalate ? ' (escalating)' : ''}\n`)

  let executed = 0
  let refused = 0
  let stoodDown = 0

  for (let i = 1; i <= rounds; i++) {
  for (const p of watchlist) {
    const guardian = root.forPosition(p)
    const nonce = `${Date.now().toString(36)}-${i}`
    try {
      const snapshot = await guardian.detect()
      const hf = Number(snapshot.healthFactor) / 1e18
      const decision = guardian.decide(snapshot)

      if (decision === 'stand-down') {
        stoodDown++
        console.log(`[${i}/${rounds}] HF ${hf.toFixed(4)} → stand-down`)
        await appendReceipt({
          type: 'campaign-execution',
          timestamp: new Date().toISOString(),
          position: p.address,
          positionLabel: guardian.label(),
          healthFactorBefore: snapshot.healthFactor,
          healthFactorAfter: null,
          decision: 'stand-down',
          action: 'stand-down',
          txHash: null,
          status: 'ok',
        })
        continue
      }

      const protection = await guardian.protect(config.reserve, config.topUpAmount, nonce)
      if (protection.refused) {
        refused++
        console.log(`[${i}/${rounds}] HF ${hf.toFixed(4)} → REFUSED: ${protection.error ?? 'simulation reverted'}`)
      } else if (protection.status === 'completed') {
        executed++
        console.log(`[${i}/${rounds}] HF ${hf.toFixed(4)} → tx ${protection.txHash}`)
      } else {
        console.log(`[${i}/${rounds}] HF ${hf.toFixed(4)} → ${protection.status}: ${protection.error ?? ''}`)
      }

      const after = protection.status === 'completed' ? await guardian.verify() : null
      if (escalate && after?.healthFactor) {
        // Each 5 LINK top-up raises the health factor by ~2.25 and the verify
        // read can lag one round behind the chain, so a small +0.5 margin lets
        // the threshold catch up with the rising HF and the run stalls. Use a
        // margin above the per-round gain so the threshold always stays ahead.
        guardian.setThreshold(Number(after.healthFactor) / 1e18 + 2.6)
        console.log(`      → threshold escalated to ${(Number(after.healthFactor) / 1e18 + 2.6).toFixed(2)}`)
      }
      const receipt: Receipt = {
        type: 'campaign-execution',
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
    } catch (err: any) {
      console.log(`[${i}/${rounds}] ERROR: ${err.message}`)
      await appendReceipt({
        type: 'campaign-execution',
        timestamp: new Date().toISOString(),
        position: p.address,
        positionLabel: guardian.label(),
        healthFactorBefore: null,
        healthFactorAfter: null,
        decision: 'error',
        txHash: null,
        status: 'error',
        error: err.message,
      })
    }
  }
  }

  const s = await summary()
  console.log(`\n=== CAMPAIGN DONE ===`)
  console.log(`Executed: ${executed}`)
  console.log(`Refused (no gas spent): ${refused}`)
  console.log(`Stand-down: ${stoodDown}`)
  console.log(`Total receipts: ${s.executed + s.refused + stoodDown} → harness/receipts/receipts.json`)
}

main().catch((err) => {
  console.error(`\nCampaign failed: ${err.message}`)
  process.exit(1)
})
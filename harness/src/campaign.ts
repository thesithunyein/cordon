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
  const guardian = new Guardian(kh, config)

  // Escalating mode: after each completed protective execution, raise the
  // threshold just above the verified health factor so the next round executes
  // again. Used to build real-execution evidence volume on testnet.
  const escalate = process.env.CAMPAIGN_ESCALATE === 'true'

  const rounds = config.campaignRounds
  console.log(`\nCordon — evidence campaign: ${rounds} rounds`)
  console.log(`Position:  ${config.positionAddress}`)
  console.log(`Threshold: health factor < ${config.healthFactorThreshold}${escalate ? ' (escalating)' : ''}\n`)

  let executed = 0
  let refused = 0
  let stoodDown = 0

  for (let i = 1; i <= rounds; i++) {
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
          position: config.positionAddress,
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
        config.healthFactorThreshold = Number(after.healthFactor) / 1e18 + 0.5
        console.log(`      → threshold escalated to ${config.healthFactorThreshold.toFixed(2)}`)
      }
      const receipt: Receipt = {
        type: 'campaign-execution',
        timestamp: new Date().toISOString(),
        position: config.positionAddress,
        healthFactorBefore: snapshot.healthFactor,
        healthFactorAfter: after?.healthFactor ?? null,
        decision,
        action: 'top-up',
        asset: config.reserve,
        amount: String(config.topUpAmount),
        refused: protection.refused,
        txHash: protection.txHash ?? null,
        status: protection.status,
        error: protection.error ?? null,
      }
      await appendReceipt(receipt)
    } catch (err: any) {
      console.log(`[${i}/${rounds}] ERROR: ${err.message}`)
      await appendReceipt({
        type: 'campaign-execution',
        timestamp: new Date().toISOString(),
        position: config.positionAddress,
        healthFactorBefore: null,
        healthFactorAfter: null,
        decision: 'error',
        txHash: null,
        status: 'error',
        error: err.message,
      })
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
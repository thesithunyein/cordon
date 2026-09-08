/**
 * Cordon — one full guardian cycle.
 *
 *   detect → decide → (protect → verify) → record
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
  const guardian = new Guardian(kh, config)

  console.log(`\nCordon — guardian cycle`)
  console.log(`Position:  ${config.positionAddress}`)
  console.log(`Chain:     ${config.chainId} (Ethereum Sepolia)`)
  console.log(`Threshold: health factor < ${config.healthFactorThreshold}\n`)

  // detect
  const snapshot = await guardian.detect()
  const hf = Number(snapshot.healthFactor) / 1e18
  console.log(`detect   → health factor ${hf.toFixed(4)} (${snapshot.atRisk ? 'AT RISK' : 'safe'})`)

  // decide
  const decision = guardian.decide(snapshot)
  console.log(`decide   → ${decision}`)

  if (decision === 'stand-down') {
    console.log(`stand-down: position healthy, no action.`)
    await appendReceipt({
      type: 'guard-cycle',
      timestamp: new Date().toISOString(),
      position: config.positionAddress,
      healthFactorBefore: snapshot.healthFactor,
      healthFactorAfter: snapshot.healthFactor,
      decision: 'stand-down',
      txHash: null,
      status: 'ok',
    })
    return
  }

  // protect
  const nonce = Date.now().toString(36)
  const protection = await guardian.protect(config.reserve, config.topUpAmount, nonce)
  console.log(`protect  → ${protection.refused ? 'REFUSED (simulation gate)' : 'executed'} ${protection.txHash ?? ''}`)
  if (protection.refused) console.log(`           ${protection.error ?? ''}`)

  // verify
  const after = protection.status === 'completed' ? await guardian.verify() : null
  if (after) {
    const hfAfter = Number(after.healthFactor) / 1e18
    console.log(`verify   → health factor ${hfAfter.toFixed(4)} after protection`)
  }

  const receipt: Receipt = {
    type: 'guard-cycle',
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
  console.log(`\nrecorded → harness/receipts/receipts.json`)
}

main().catch((err) => {
  console.error(`\nCordon guard failed: ${err.message}`)
  process.exit(1)
})
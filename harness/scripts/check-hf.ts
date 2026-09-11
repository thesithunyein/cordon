/**
 * One-off: read the health factor of the configured position (and any extra
 * positions) via the live KeeperHub MCP → Aave V3 Sepolia plugin.
 *
 *   npx tsx scripts/check-hf.ts
 */
import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'
import { Guardian } from '../src/guardian.js'

async function main() {
  const config = loadConfig()
  const kh = new KeeperHubClient(config.khApiKey)
  const root = new Guardian(kh, config)

  const watchlist = [
    { address: config.positionAddress, threshold: config.healthFactorThreshold },
    ...config.extraPositions,
  ]

  for (const p of watchlist) {
    const g = root.forPosition(p)
    const snap = await g.detect()
    const hf = Number(snap.healthFactor) / 1e18
    console.log(`${g.label().padEnd(20)} HF ${hf.toFixed(4)}  (threshold ${p.threshold}) → ${snap.atRisk ? 'AT RISK' : 'safe'}`)
  }
}

main().catch((err) => {
  console.error(`check-hf failed: ${err.message}`)
  process.exit(1)
})

/**
 * Cordon — one-command setup.
 *
 *   1. Ensures harness/.env exists (copies .env.example if missing)
 *   2. Loads config and fails loudly with a fix hint if anything is missing
 *   3. Proves live connectivity: MCP handshake + a real Aave V3 Sepolia read
 *
 * Run with: npm run setup
 * Result: a working guardian ready for `npm run guard`.
 */

import { existsSync, copyFileSync } from 'node:fs'
import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'

async function main() {
  console.log('\nCordon — setup\n')

  // 1. .env exists?
  const envPath = new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  if (!existsSync('.env') && existsSync('.env.example')) {
    copyFileSync('.env.example', '.env')
    console.log('  ✓ created .env from .env.example — edit it with your KH_API_KEY')
  } else if (!existsSync('.env')) {
    console.error('  ✗ no .env and no .env.example found — run from harness/')
    process.exit(1)
  } else {
    console.log('  ✓ .env present')
  }
  void envPath

  // 2. Config loads (fails with a clear message when a key is missing)
  const config = loadConfig()
  console.log(`  ✓ config loaded`)
  console.log(`    position:  ${config.positionAddress}`)
  console.log(`    chain:     ${config.chainId} (Ethereum Sepolia)`)
  console.log(`    threshold: health factor < ${config.healthFactorThreshold}`)
  console.log(`    reserve:   ${config.reserve} × ${config.topUpAmount}`)

  // 3. Live proof: MCP handshake + a real read of the Aave V3 Sepolia Pool
  console.log('\n  proving live connectivity (KeeperHub MCP → Aave V3 Sepolia)…')
  const kh = new KeeperHubClient(config.khApiKey)
  const snapshot = await kh.callTool('execute_protocol_action', {
    actionType: 'aave-v3/get-user-account-data',
    params: { network: String(config.chainId), user: config.positionAddress },
  })
  if (snapshot.isError) {
    console.error(`  ✗ API handshake failed: ${snapshot.text.slice(0, 200)}`)
    console.error('    Check KH_API_KEY in harness/.env (Settings → Developer → API keys)')
    process.exit(1)
  }
  const hf = Number((snapshot.data?.result ?? snapshot.data)?.healthFactor ?? 0) / 1e18
  console.log(`  ✓ live read OK — health factor ${hf.toFixed(2)}`)

  console.log('\nSetup complete. Next: npm run guard (one cycle) or npm run campaign.')
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`)
  process.exit(1)
})

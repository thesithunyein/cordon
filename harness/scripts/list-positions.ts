import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'

/** Candidate second positions: any EOA you control can hold an Aave position. */
async function main() {
  const c = loadConfig()
  const kh = new KeeperHubClient(c.khApiKey)
  const candidates = (process.env.CHECK_ADDRESSES ?? '').split(',').map(s=>s.trim()).filter(Boolean)
  for (const addr of candidates) {
    try {
      const r = await kh.callTool('execute_protocol_action', { actionType: 'aave-v3/get-user-account-data', params: { network: '11155111', user: addr } })
      const d = (r.data?.result ?? r.data) as any
      const hf = Number(d?.healthFactor ?? 0) / 1e18
      const collateral = Number(d?.totalCollateralBase ?? 0) / 1e8
      const debt = Number(d?.totalDebtBase ?? 0) / 1e8
      console.log(`${addr}  HF ${hf.toFixed(2)}  collateral $${collateral.toFixed(2)}  debt $${debt.toFixed(2)}`)
    } catch (e: any) {
      console.log(`${addr}  ERROR ${e.message.slice(0,80)}`)
    }
  }
}
main()

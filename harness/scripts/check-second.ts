import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'

async function main() {
  const c = loadConfig()
  const kh = new KeeperHubClient(c.khApiKey)
  const SECOND = '0x809d8252aa4f9b8f7d9be7213855b289fe7d0444'
  const r = await kh.callTool('execute_protocol_action', {
    actionType: 'aave-v3/get-user-account-data',
    params: { network: '11155111', user: SECOND },
  })
  const d = (r.data?.result ?? r.data) as Record<string, unknown> | undefined
  console.log('collateral $:', Number(d?.totalCollateralBase ?? 0) / 1e8)
  console.log('debt $:', Number(d?.totalDebtBase ?? 0) / 1e8)
  console.log('HF:', Number(d?.healthFactor ?? 0) / 1e18)
  console.log('availableBorrow $:', Number(d?.availableBorrowsBase ?? 0) / 1e8)
}
main()

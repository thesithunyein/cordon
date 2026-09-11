import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'
import { AAVE_V3_SEPOLIA, RESERVES, toWei } from '../src/aave-v3.js'
import { appendReceipt } from '../src/receipts.js'

/**
 * The historical successful borrow called a PERMIT2-style meta-borrow at
 * 0x5af5… (selector 0x9aefaff8): borrow(user, pool, 0, permitCalldataOffset,
 * signature...) — too coupled to replay for a new wallet.
 *
 * Simpler proven path: aave-v3/borrow PROTOCOL ACTION (the native KeeperHub
 * Aave plugin supports it) with simulate skipped — the plugin validates args.
 * Falls back gracefully if the action is unavailable on this deployment.
 */
async function main() {
  const c = loadConfig()
  const kh = new KeeperHubClient(c.khApiKey)
  const SECOND = '0x809d8252aa4f9b8f7d9be7213855b289fe7d0444'
  const usdc = RESERVES.USDC

  const executed = await kh.callTool('execute_protocol_action', {
    actionType: 'aave-v3/borrow',
    params: {
      network: '11155111',
      asset: usdc.underlying,
      amount: toWei('USDC', 50),
      interestRateMode: '2',
      onBehalfOf: SECOND,
    },
  })
  console.log('aave-v3/borrow:', executed.isError ? executed.text.slice(0, 200) : JSON.stringify(executed.data).slice(0, 300))
}
main()

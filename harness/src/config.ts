/**
 * Cordon — configuration.
 * All values come from environment variables (see .env.example).
 */

function required(name: string): string {
  const v = process.env[name]
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}. Copy harness/.env.example to harness/.env and fill it in.`)
  }
  return v
}

export interface CordonConfig {
  khApiKey: string
  positionAddress: string
  healthFactorThreshold: number
  /** Reserve symbol used for the protective top-up (supply). */
  reserve: 'USDC' | 'DAI' | 'LINK' | 'WBTC'
  /** Top-up amount in human units of `reserve`. */
  topUpAmount: number
  campaignRounds: number
  verifyReceipts: boolean
  chainId: number
}

export function loadConfig(): CordonConfig {
  return {
    khApiKey: required('KH_API_KEY'),
    positionAddress: required('POSITION_ADDRESS'),
    healthFactorThreshold: Number(process.env.HEALTH_FACTOR_THRESHOLD ?? '1.5'),
    reserve: (process.env.RESERVE ?? 'USDC') as CordonConfig['reserve'],
    topUpAmount: Number(process.env.TOP_UP_AMOUNT ?? '10'),
    campaignRounds: Number(process.env.CAMPAIGN_ROUNDS ?? '10'),
    verifyReceipts: (process.env.VERIFY_RECEIPTS ?? 'true') === 'true',
    chainId: Number(process.env.CHAIN_ID ?? '11155111'),
  }
}
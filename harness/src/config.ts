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
  /**
   * Multi-position watchlist: additional Aave V3 positions beyond the primary.
   * Each entry: `address[:threshold]`. Threshold defaults to the primary's.
   * Populated from EXTRA_POSITIONS (comma-separated); empty = single-position
   * mode, exactly the pre-multi behavior.
   */
  extraPositions: { address: string; threshold: number }[]
  /** Optional human labels keyed by lowercase address, from POSITION_LABELS (comma-separated `0x..=Name`). */
  positionLabels: Record<string, string>
}

/** Parse a number env var, falling back when absent or not a finite number. */
function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function loadConfig(): CordonConfig {
  const address = required('POSITION_ADDRESS')
  const primaryThreshold = numberEnv('HEALTH_FACTOR_THRESHOLD', 1.5)

  const extraPositions = (process.env.EXTRA_POSITIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const [addr, thr] = entry.split(':')
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr.trim())) {
        throw new Error(`EXTRA_POSITIONS entry is not a valid address: "${entry}"`)
      }
      const threshold = thr !== undefined && thr.trim() !== '' ? Number(thr) : primaryThreshold
      if (!Number.isFinite(threshold) || threshold <= 0) {
        throw new Error(`EXTRA_POSITIONS threshold must be a positive number: "${entry}"`)
      }
      return { address: addr.trim(), threshold }
    })

  const positionLabels: Record<string, string> = {}
  for (const pair of (process.env.POSITION_LABELS ?? '').split(',')) {
    const [addr, label] = pair.split('=')
    if (addr && label && /^0x[0-9a-fA-F]{40}$/.test(addr.trim())) {
      positionLabels[addr.trim().toLowerCase()] = label.trim()
    }
  }

  return {
    khApiKey: required('KH_API_KEY'),
    positionAddress: address,
    healthFactorThreshold: primaryThreshold,
    reserve: (process.env.RESERVE ?? 'USDC') as CordonConfig['reserve'],
    topUpAmount: numberEnv('TOP_UP_AMOUNT', 10),
    campaignRounds: numberEnv('CAMPAIGN_ROUNDS', 10),
    verifyReceipts: (process.env.VERIFY_RECEIPTS ?? 'true') === 'true',
    chainId: numberEnv('CHAIN_ID', 11155111),
    extraPositions,
    positionLabels,
  }
}
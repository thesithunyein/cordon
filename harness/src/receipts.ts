/**
 * Cordon — receipt store.
 *
 * Every execution appends to harness/receipts/receipts.json. The file is the
 * evidence: each row carries a transaction hash on Ethereum Sepolia that any
 * judge can recompute against a public RPC.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RECEIPTS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'receipts', 'receipts.json')

export interface Receipt {
  type: 'guard-cycle' | 'campaign-execution' | 'drill'
  timestamp: string
  position: string
  /** Human label for the watched position (multi-position watchlist); absent on legacy rows. */
  positionLabel?: string
  healthFactorBefore: string | null
  healthFactorAfter: string | null
  decision: string
  action?: string
  asset?: string
  amount?: string
  refused?: boolean
  txHash: string | null
  /** Org-scoped KeeperHub execution id, when the write went through. */
  executionId?: string | null
  status: string
  error?: string | null
}

export interface ReceiptsFile {
  generatedAt: string
  count: number
  receipts: Receipt[]
}

async function read(): Promise<ReceiptsFile> {
  try {
    const raw = await readFile(RECEIPTS_PATH, 'utf8')
    return JSON.parse(raw) as ReceiptsFile
  } catch {
    return { generatedAt: new Date().toISOString(), count: 0, receipts: [] }
  }
}

export async function appendReceipt(receipt: Receipt): Promise<void> {
  const file = await read()
  file.receipts.push(receipt)
  file.count = file.receipts.length
  file.generatedAt = new Date().toISOString()
  await mkdir(dirname(RECEIPTS_PATH), { recursive: true })
  await writeFile(RECEIPTS_PATH, JSON.stringify(file, null, 2), 'utf8')
}

export async function summary(): Promise<{ executed: number; refused: number; txHashes: string[] }> {
  const file = await read()
  const executed = file.receipts.filter((r) => r.status === 'completed').length
  const refused = file.receipts.filter((r) => r.refused).length
  const txHashes = file.receipts
    .map((r) => r.txHash)
    .filter((h): h is string => h !== null && h.length > 0)
  return { executed, refused, txHashes }
}
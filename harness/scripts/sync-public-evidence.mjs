// Sync the evidence corpus into the web app's public folder so
// /receipts.json on cordon.sithunyein.com stays current — and derive the
// headline figures the landing page shows.
//
// The landing page's proof strip used to be a hardcoded string, and it had gone
// stale: it read "1,082 / 91 / 147" against a corpus of 1,109 / 98 / 149, which
// broke the same-numbers-everywhere claim on the first screen a reviewer sees.
// Deriving it here means the daily guard cycle regenerates it automatically,
// because that workflow already runs this script before committing.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../receipts/receipts.json')
const destDir = resolve(here, '../../public')
const dest = resolve(destDir, 'receipts.json')

mkdirSync(destDir, { recursive: true })
cpSync(src, dest)
console.log(`Synced ${src} -> ${dest}`)

// Predicates are deliberately identical to the audit page's, so the landing
// strip and the audit cards can never disagree. Stand-downs appear with either
// field spelling across receipt eras: { action: 'stand-down' } or
// { decision: 'stand_down' }.
const isStandDown = (x) =>
  x.action === 'stand-down' ||
  x.action === 'stand_down' ||
  x.decision === 'stand-down' ||
  x.decision === 'stand_down'

const file = JSON.parse(readFileSync(src, 'utf8'))
const rows = (Array.isArray(file) ? file : (file.receipts ?? [])).filter(
  (x) => typeof x === 'object' && x !== null,
)

const stats = {
  executions: rows.filter((x) => x.status === 'completed' && !x.refused && x.txHash).length,
  refusals: rows.filter((x) => x.refused === true).length,
  standDowns: rows.filter(isStandDown).length,
}

const statsDest = resolve(destDir, 'evidence-stats.json')
writeFileSync(statsDest, `${JSON.stringify(stats, null, 2)}\n`, 'utf8')
console.log(
  `Derived ${statsDest}: ${stats.executions} executions, ` +
    `${stats.refusals} refusals, ${stats.standDowns} stand-downs`,
)
// Sync the evidence corpus into the web app's public folder so
// /receipts.json on cordon.sithunyein.com stays current.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../receipts/receipts.json')
const destDir = resolve(here, '../../public')
const dest = resolve(destDir, 'receipts.json')

mkdirSync(destDir, { recursive: true })
cpSync(src, dest)
console.log(`Synced ${src} -> ${dest}`)
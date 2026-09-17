/**
 * Cordon — local `.env` loading.
 *
 * The README and `.env.example` both say `cp .env.example .env` and fill it in,
 * but nothing ever read that file: `config.ts` only looked at `process.env`, so
 * every documented local run failed with "Missing required env var" — and the
 * error message told you to do the thing that does not work. CI never noticed
 * because GitHub Actions injects real environment variables, which is exactly
 * why this could sit broken in a repo whose whole pitch is that a reviewer can
 * reproduce it.
 *
 * Loading is explicit and dependency-free rather than a dotenv dependency,
 * because the rules have to be precisely these:
 *
 *   - a real environment variable always wins, so `KEY=x npm run guard` behaves
 *     the way a shell user expects, and CI's injected secrets are never shadowed
 *     by a stray file left in a checkout;
 *   - the file is optional — CI has none, and must not need one;
 *   - a missing or unreadable file is not an error, it means "no overrides".
 *
 * Imported for its side effect from `config.ts`, so it runs before anything reads
 * a value at import time (module evaluation is dependency-first, so a script's
 * own top-level `process.env` reads happen after this file has run).
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `harness/.env`, resolved from this file so the loader works from any cwd. */
export const DOTENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')

/**
 * Parse `KEY=value` lines. Blank lines, `#` comments and anything that is not a
 * `KEY=value` pair are skipped rather than treated as an error: a `.env` is a
 * convenience file, and a malformed line should not stop a command that may not
 * even need it.
 */
export function parseEnvLines(content: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, raw] = match
    const value = raw.trim()
    // Strip one layer of matching quotes, so KEY="a b" yields `a b` — the shape
    // a shell would hand over for the same file.
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    parsed[key] = quoted ? value.slice(1, -1) : value
  }
  return parsed
}

/**
 * Apply parsed values to an environment object, never replacing a key that is
 * already set. Takes the target explicitly so the precedence rule is testable
 * without mutating the real `process.env`.
 */
export function applyEnv(
  parsed: Record<string, string>,
  target: Record<string, string | undefined> = process.env,
): void {
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) {
      target[key] = value
    }
  }
}

try {
  if (existsSync(DOTENV_PATH)) {
    applyEnv(parseEnvLines(readFileSync(DOTENV_PATH, 'utf8')))
  }
} catch {
  // An unreadable file (permissions, bad encoding) degrades to "no overrides",
  // matching the contract above: a convenience file must never break a command.
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEnv, parseEnvLines } from './env.js'

test('parseEnvLines: reads plain KEY=value pairs', () => {
  assert.deepEqual(parseEnvLines('KH_API_KEY=kh_abc\nRESERVE=LINK\n'), {
    KH_API_KEY: 'kh_abc',
    RESERVE: 'LINK',
  })
})

test('parseEnvLines: skips comments, blank lines and prose', () => {
  // .env.example is mostly commentary, and the loader is applied to a real copy
  // of it, so anything that is not an assignment has to be ignored silently.
  const parsed = parseEnvLines(
    [
      '# KeeperHub organization API key — create at app.keeperhub.com',
      '',
      '   ',
      'RESERVE=LINK',
      'not an assignment',
      '# HEALTH_FACTOR_THRESHOLD=1.5',
    ].join('\n'),
  )
  assert.deepEqual(parsed, { RESERVE: 'LINK' })
})

test('parseEnvLines: tolerates CRLF and surrounding whitespace', () => {
  assert.deepEqual(parseEnvLines('RESERVE=LINK\r\nTOP_UP_AMOUNT = 5 \r\n'), {
    RESERVE: 'LINK',
    TOP_UP_AMOUNT: '5',
  })
})

test('parseEnvLines: strips one layer of matching quotes', () => {
  assert.deepEqual(parseEnvLines('A="two words"\nB=\'two words\'\nC="unbalanced\n'), {
    A: 'two words',
    B: 'two words',
    C: '"unbalanced',
  })
})

test('parseEnvLines: a value containing = keeps the rest', () => {
  assert.deepEqual(parseEnvLines('IDEMPOTENCY=key=with=equals'), { IDEMPOTENCY: 'key=with=equals' })
})

test('applyEnv: a real environment variable always wins', () => {
  // The rule that matters: CI injects secrets as real environment variables, and
  // `KEY=x npm run guard` must behave the way a shell user expects. Neither may
  // be shadowed by a .env someone left in the checkout.
  const target: Record<string, string | undefined> = { KH_API_KEY: 'from-shell' }
  applyEnv({ KH_API_KEY: 'from-file', RESERVE: 'LINK' }, target)
  assert.equal(target.KH_API_KEY, 'from-shell')
  assert.equal(target.RESERVE, 'LINK')
})

test('applyEnv: absent is filled in, empty is left alone', () => {
  // The precedence rule is "the file fills what the process was not given", and
  // "given" means the key exists. An empty string is a value someone set
  // deliberately, so it is not overwritten here — and because `required()` rejects
  // an empty value, `KH_API_KEY= npm run guard` fails loudly instead of quietly
  // running against the key in the file.
  const absent: Record<string, string | undefined> = {}
  applyEnv({ RESERVE: 'LINK' }, absent)
  assert.equal(absent.RESERVE, 'LINK')

  const empty: Record<string, string | undefined> = { RESERVE: '' }
  applyEnv({ RESERVE: 'LINK' }, empty)
  assert.equal(empty.RESERVE, '')
})

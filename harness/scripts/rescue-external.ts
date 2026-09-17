/**
 * Cordon — defend an Aave V3 position Cordon does not own.
 *
 * The guardian in `guard.ts` protects positions Cordon is configured to watch.
 * This is the other direction: a position belonging to someone else, found by
 * `find-at-risk.ts`, defended because Aave lets a third party act on it:
 *
 *   repay(asset, amount, 2, onBehalfOf)   → spends our asset, cuts their debt
 *   supply(asset, amount, onBehalfOf, 0)  → funds their collateral
 *
 * Neither needs a signature from the protected account, which is the whole
 * point: Cordon can defend a position whose owner is asleep. It goes through the
 * same safe write as everything else — simulate, gate, execute, verify — so a
 * rescue that would revert never reaches the chain and is recorded as a refusal.
 *
 * Read this before running it: a rescue is a GIFT. You cannot take it back.
 * Repaid funds are gone; supplied aTokens are minted to the receiver. The script
 * never hides that, and every receipt says it plainly.
 *
 *   npx tsx scripts/rescue-external.ts --auto --preview    # Cordon picks, plan only
 *   npx tsx scripts/rescue-external.ts --auto              # Cordon picks and defends it
 *   RESCUE_TARGET=0x… npx tsx scripts/rescue-external.ts
 *   RESCUE_TARGET=0x… RESCUE_MODE=supply RESCUE_AMOUNT=5.5 npx tsx scripts/rescue-external.ts
 *
 * Env:
 *   RESCUE_TARGET     the position to defend (required unless RESCUE_AUTO=true)
 *   RESCUE_AUTO       true = find and rank real positions, then defend the worst one
 *   RESCUE_MAX_HF     auto mode: only act below this health factor (default 1.5)
 *   RESCUE_MAX_USD    auto mode: skip rescues that would cost more than this (default 250)
 *   RESCUE_MODE       repay (default) or supply (default in auto mode)
 *   RESCUE_RESERVE    reserve symbol; repaid default = the target's largest debt
 *   RESCUE_AMOUNT     human units; omit to auto-size against TARGET_HF
 *   TARGET_HF         auto-size target (default 2.0)
 *   RESCUE_FORCE      true = act even when the position is above the threshold
 *   RESCUE_PREVIEW    true = print the plan and stop (same as --preview)
 *   RPC_URL, CONCURRENCY, CHAIN_ID  as elsewhere
 */

import { AAVE_V3_SEPOLIA, RESERVES, toWei, type ReserveSymbol } from '../src/aave-v3.js'
import { loadConfig } from '../src/config.js'
import { KeeperHubClient } from '../src/kh-client.js'
import { discoverAtRisk, pickRescueTarget } from '../src/discovery.js'
import { createRpc, debtsOf, mapLimit, readAccount, readPriceUsd, readTokenBalance, type RpcClient } from '../src/onchain.js'
import { baseToUsd, healthFactorOf, hasDebt, sizeRescue } from '../src/position-math.js'
import { appendReceipt, type Receipt } from '../src/receipts.js'

const TARGET_HF = numberEnv('TARGET_HF', 2.0)

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Round up to `decimals` places so a sized rescue never falls short. */
function ceilTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.ceil(value * f) / f
}

/**
 * Which reserve a supply-mode rescue spends.
 *
 * A supply pulls the asset from the executor's wallet, so the reserve has to be
 * one that wallet holds *free* — a supply of an asset we do not hold reverts, and
 * burning a simulation on it tells the operator less than reading the balance
 * does. On Sepolia that distinction is decisive: the treasury is funded in LINK,
 * not stablecoins, so the configured reserve is not automatically the usable one.
 *
 * With no `EXECUTION_WALLET` there is nothing to read, so we trust the configured
 * reserve and let the simulation gate refuse if it is wrong — which is recorded.
 */
async function chooseSupplyReserve(rpc: RpcClient, config: ReturnType<typeof loadConfig>): Promise<ReserveSymbol> {
  const requested = (process.env.RESCUE_RESERVE ?? '').trim().toUpperCase() as ReserveSymbol
  if (requested) return requested

  const funder = (process.env.EXECUTION_WALLET ?? '').trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(funder)) return config.reserve

  const symbols = Object.keys(RESERVES) as ReserveSymbol[]
  const balances = await mapLimit(symbols, 2, async (s) => {
    const reserve = RESERVES[s]
    const raw = await readTokenBalance(rpc, reserve.underlying, funder).catch(() => 0n)
    return { symbol: s, free: Number(raw) / 10 ** reserve.decimals }
  })

  console.log(`\nExecutor wallet ${funder} — free balances:`)
  for (const b of balances) console.log(`  ${b.symbol.padEnd(5)} ${b.free.toFixed(6)}`)

  // Prefer the configured reserve when it is funded; otherwise take the largest
  // balance, which is the asset the treasury actually holds.
  const configured = balances.find((b) => b.symbol === config.reserve && b.free > 0)
  const chosen = configured ?? [...balances].sort((a, b) => b.free - a.free)[0]
  if (!chosen || chosen.free <= 0) {
    throw new Error(`executor wallet ${funder} holds none of ${symbols.join(', ')} — nothing to supply`)
  }
  if (chosen.symbol !== config.reserve) {
    console.log(`Configured reserve ${config.reserve} is not funded; supplying ${chosen.symbol} instead.`)
  }
  console.log(`Supplying from ${chosen.symbol} balance.\n`)
  return chosen.symbol
}

/**
 * Auto mode: rank every real position in the window and take the worst one the
 * treasury can actually make safe.
 *
 * The guards matter more than the ranking does. On Sepolia the deepest positions
 * are dust or liquidation-bot fixtures, and a position can be genuinely at-risk
 * while needing more value than the treasury holds — a partial rescue spends
 * funds and leaves the risk, which is worse than declining. Every skip is printed
 * with its reason, so the choice can be argued with rather than taken on trust.
 */
async function selectAutoTarget(
  rpc: RpcClient,
  config: ReturnType<typeof loadConfig>,
  strategy: 'repay' | 'supply',
): Promise<{ address: string; selection: NonNullable<Receipt['selection']> }> {
  const minCollateralUsd = numberEnv('RESCUE_MIN_COLLATERAL_USD', 25)
  // Never chase a position that is not actually in danger: the point of a rescue
  // is that it was needed, so the ceiling is the guardian's own threshold.
  const maxHealthFactor = numberEnv('RESCUE_MAX_HF', Math.min(config.healthFactorThreshold, 1.5))
  const maxRescueUsd = numberEnv('RESCUE_MAX_USD', 250)

  console.log('\nAuto mode — Cordon is choosing the position to defend')
  const found = await discoverAtRisk(rpc, {
    lookbackBlocks: numberEnv('LOOKBACK_BLOCKS', 30_000),
    hfThreshold: config.healthFactorThreshold,
    targetHf: TARGET_HF,
    minCollateralUsd,
    concurrency: numberEnv('CONCURRENCY', 6),
    exclude: [config.positionAddress, ...(process.env.EXCLUDE ?? '').split(',')],
  })
  console.log(`Scanned:   ${found.candidates.length} accounts named by Pool logs over ${found.lookbackBlocks} blocks`)
  console.log(
    `Bearing debt: ${found.counts.withDebt} | at-risk: ${found.counts['at-risk']} | actionable: ${found.worthDefending.length}`,
  )

  const { target, reason, skipped } = pickRescueTarget(found, {
    minCollateralUsd,
    maxHealthFactor,
    maxRescueUsd,
    strategy,
  })
  for (const s of skipped.slice(0, 5)) console.log(`  skip ${s.address} — ${s.reason}`)
  if (skipped.length > 5) console.log(`  …and ${skipped.length - 5} more skipped`)
  if (!target) throw new Error(`auto selection found nothing to defend: ${reason}`)

  console.log(`Chosen:    ${target.address} — ${reason}`)
  console.log(
    `           collateral $${target.collateralUsd.toFixed(2)} | debt $${target.debtUsd.toFixed(2)} | ` +
      `liquidation threshold ${(target.liquidationThreshold * 100).toFixed(1)}%`,
  )

  return {
    address: target.address,
    selection: {
      method: 'auto',
      considered: found.worthDefending.length,
      chosenHf: target.healthFactor,
      note: `${reason}; ${found.counts.withDebt} accounts with debt scanned over ${found.lookbackBlocks} blocks, ${skipped.length} skipped by the selection guards`,
    },
  }
}

async function main() {
  const preview = process.argv.includes('--preview') || (process.env.RESCUE_PREVIEW ?? '') === 'true'
  const confirmForce = (process.env.RESCUE_FORCE ?? '') === 'true'
  const auto = process.argv.includes('--auto') || (process.env.RESCUE_AUTO ?? '') === 'true'
  // Auto mode defaults to `supply`. A repay must target the asset the stranger
  // actually borrowed, whereas supplying our own reserve works against any debt —
  // and the reserve is the asset the treasury is actually funded in.
  const mode = (process.env.RESCUE_MODE ?? (auto ? 'supply' : 'repay')).toLowerCase()
  if (mode !== 'repay' && mode !== 'supply') throw new Error(`RESCUE_MODE must be repay or supply, got "${mode}"`)

  const config = loadConfig()
  const rpc = createRpc()

  let target = (process.env.RESCUE_TARGET ?? '').trim()
  let selection: Receipt['selection'] = {
    method: 'explicit',
    considered: 1,
    chosenHf: null,
    note: 'position named by the operator',
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
    if (!auto) {
      throw new Error(
        'Set RESCUE_TARGET to the position to defend, or pass --auto to have Cordon find and rank one itself (see: npm run find:at-risk)',
      )
    }
    const chosen = await selectAutoTarget(rpc, config, mode)
    target = chosen.address
    selection = chosen.selection
  }

  if (target.toLowerCase() === config.positionAddress.toLowerCase()) {
    throw new Error('RESCUE_TARGET is our own watched position — use `npm run guard` for that, not a rescue.')
  }

  const account = await readAccount(rpc, target, AAVE_V3_SEPOLIA.pool)
  if (!account) throw new Error(`could not read Aave account data for ${target}`)
  if (!hasDebt(account)) throw new Error(`${target} carries no debt — nothing to defend.`)

  const hfBefore = healthFactorOf(account)
  const collateralUsd = baseToUsd(account.collateralBase)
  const debtUsd = baseToUsd(account.debtBase)
  const sizing = sizeRescue(account, TARGET_HF)

  console.log('\nCordon — third-party rescue')
  console.log(`Target:    ${target}`)
  console.log(`Health:    HF ${hfBefore.toFixed(4)} | collateral $${collateralUsd.toFixed(2)} | debt $${debtUsd.toFixed(2)}`)

  if (hfBefore >= config.healthFactorThreshold && !confirmForce) {
    console.log(`\nStand down: HF ${hfBefore.toFixed(4)} is not below the threshold of ${config.healthFactorThreshold}.`)
    console.log('Nothing is being spent. Set RESCUE_FORCE=true to act anyway.')
    return
  }

  // Which reserve, and how much. A repay has to target the reserve the target
  // actually borrowed — repaying the wrong one is a revert, not a rescue.
  let symbol: ReserveSymbol
  let owedInSymbol = 0
  if (mode === 'repay') {
    const debts = await debtsOf(rpc, target)
    if (debts.length === 0) throw new Error(`${target} shows debt in the account data but no reserve carries it.`)
    const requested = (process.env.RESCUE_RESERVE ?? '').trim().toUpperCase() as ReserveSymbol
    const chosen = requested ? debts.find((d) => d.symbol === requested) : undefined
    if (requested && !chosen) {
      throw new Error(`${target} owes ${debts.map((d) => `${d.symbol} ${d.amount.toFixed(4)}`).join(', ')} — not ${requested}.`)
    }
    const selected = chosen ?? debts[0]
    symbol = selected.symbol
    owedInSymbol = selected.amount
    console.log(`Owes:      ${debts.map((d) => `${d.symbol} ${d.amount.toFixed(4)}`).join(', ')} → repaying ${symbol}`)
  } else {
    symbol = await chooseSupplyReserve(rpc, config)
  }

  const reserve = RESERVES[symbol]
  if (!reserve) throw new Error(`unknown reserve ${symbol}`)

  // Auto-size in USD, convert through the oracle, then cap so a repay can never
  // exceed the outstanding debt (the debt token reverts on over-burn).
  const explicit = process.env.RESCUE_AMOUNT ? Number(process.env.RESCUE_AMOUNT) : undefined
  let amount: number
  if (explicit !== undefined) {
    if (!Number.isFinite(explicit) || explicit <= 0) throw new Error('RESCUE_AMOUNT must be a positive number')
    amount = explicit
  } else {
    const price = await readPriceUsd(rpc, symbol)
    if (!Number.isFinite(price) || price <= 0) throw new Error(`oracle returned no usable price for ${symbol}`)
    const usd = mode === 'repay' ? sizing.repayUsd : sizing.supplyUsd
    amount = ceilTo(usd / price, reserve.decimals > 6 ? 4 : reserve.decimals)
    console.log(`Sizing:    $${usd.toFixed(2)} at $${price.toFixed(4)}/${symbol} → ${amount} ${symbol} (target HF ${TARGET_HF})`)
  }

  if (mode === 'repay' && owedInSymbol > 0 && amount > owedInSymbol) {
    console.log(`Capping:   ${amount} ${symbol} exceeds the ${owedInSymbol.toFixed(6)} ${symbol} owed — repaying the full debt instead.`)
    amount = ceilTo(owedInSymbol, reserve.decimals > 6 ? 4 : reserve.decimals)
  }

  if (amount <= 0) {
    console.log('\nNothing to do: the position is already at or above the target health factor.')
    return
  }

  // The treasury has to actually hold what we are about to spend. Checking here
  // names the shortfall; the simulation gate would otherwise refuse with a revert
  // string that never says which balance ran out.
  const funderAddress = (process.env.EXECUTION_WALLET ?? '').trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(funderAddress)) {
    const free = Number(await readTokenBalance(rpc, reserve.underlying, funderAddress)) / 10 ** reserve.decimals
    console.log(`Treasury:  ${free} ${symbol} free in ${funderAddress}`)
    if (free < amount) {
      throw new Error(
        `executor wallet ${funderAddress} holds ${free} ${symbol} but this rescue needs ${amount} ${symbol} — fund it or lower RESCUE_AMOUNT`,
      )
    }
  }

  const amountWei = toWei(symbol, amount)
  const functionName = mode === 'repay' ? 'repay' : 'supply'
  // repay(asset, amount, interestRateMode, onBehalfOf) — mode 2 = variable.
  // supply(asset, amount, onBehalfOf, referralCode)
  const functionArgs =
    mode === 'repay'
      ? JSON.stringify([reserve.underlying, amountWei, '2', target])
      : JSON.stringify([reserve.underlying, amountWei, target, '0'])

  console.log(`Action:    ${functionName} ${amount} ${symbol} on behalf of ${target}`)
  console.log('           (the post-execution health factor is read back from the chain, not predicted)')

  if (preview) {
    console.log('\nPreview only — no chain write. Drop --preview to execute through KeeperHub.')
    console.log(`Would simulate then execute: ${functionName}(${functionArgs}) on ${AAVE_V3_SEPOLIA.pool}`)
    return
  }

  const kh = new KeeperHubClient(config.khApiKey)
  const idempotencyKey = `cordon-rescue-${target.toLowerCase()}-${mode}-${symbol}-${amount}-${Date.now().toString(36)}`

  // The safe write: simulate the exact calldata, gate on the result, then
  // execute with an idempotency key and poll to a terminal state. A refusal here
  // means the simulation reverted and nothing was broadcast. Each stage is
  // printed as it happens, so the order is visible and not merely asserted.
  console.log('\nKeeperHub safe write — simulate → gate → execute → poll')
  const result = await kh.safeContractWrite({
    chainId: String(config.chainId),
    contractAddress: AAVE_V3_SEPOLIA.pool,
    functionName,
    functionArgs,
    idempotencyKey,
    onStep: (step) => {
      if (step.stage === 'simulate') {
        console.log(step.ok ? '  1/3 simulate  no revert — nothing broadcast yet' : `  1/3 simulate  REVERTED — ${step.error}`)
      } else if (step.stage === 'execute') {
        console.log(`  2/3 execute   KeeperHub executionId ${step.executionId ?? '(none returned)'}`)
      } else {
        console.log(`  3/3 poll      ${step.status}${step.txHash ? `  ${step.txHash}` : ''}`)
      }
    },
  })

  let hfAfter: string | null = null
  let after = hfBefore
  if (result.status === 'completed') {
    const fresh = await readAccount(rpc, target, AAVE_V3_SEPOLIA.pool)
    if (fresh) {
      hfAfter = fresh.healthFactor.toString()
      after = healthFactorOf(fresh)
    }
  }

  const receipt: Receipt = {
    type: 'rescue',
    timestamp: new Date().toISOString(),
    position: target,
    positionLabel: 'external',
    /** The account whose position was defended — set only on third-party rescues. */
    protectedUser: target,
    external: true,
    /** The threshold in force for this decision. Recorded so the judgement is auditable. */
    threshold: config.healthFactorThreshold,
    /** How this position was chosen, so an automatic choice stays re-derivable. */
    selection,
    healthFactorBefore: account.healthFactor.toString(),
    healthFactorAfter: hfAfter,
    decision: result.refused ? 'refuse' : 'rescue',
    action: mode === 'repay' ? 'repay' : 'supply',
    asset: symbol,
    amount: String(amount),
    refused: result.refused,
    txHash: result.txHash ?? null,
    executionId: result.executionId ?? null,
    status: result.status,
    error: result.error ?? null,
  }
  await appendReceipt(receipt)

  if (result.refused) {
    console.log(`\nREFUSED by the simulation gate — zero gas spent, nothing broadcast.`)
    console.log(`Reason: ${result.error ?? 'simulation reverted'}`)
    // Allowance is the one refusal an operator can clear in a single call.
    if (/allowance|transfer amount exceeds/i.test(result.error ?? '')) {
      console.log(`\nThe Pool cannot pull ${symbol} yet — grant the allowance and retry:`)
      console.log(`  npm run approve -- RESERVE=${symbol}`)
    }
    console.log('Recorded as a refusal in harness/receipts/receipts.json.')
    return
  }

  console.log(`\n${result.status === 'completed' ? 'RESCUED' : `Status: ${result.status}`}`)
  console.log(`HF ${hfBefore.toFixed(4)} → ${after.toFixed(4)} on ${target}`)
  if (result.executionId) console.log(`KeeperHub executionId: ${result.executionId}`)
  if (result.txHash) console.log(`Tx: https://sepolia.etherscan.io/tx/${result.txHash}`)
  console.log(`Recorded in harness/receipts/receipts.json (protectedUser ${target}).`)
  console.log('This was a gift: the repaid funds are gone and the collateral is theirs.')
}

main().catch((err) => {
  console.error(`\nrescue-external failed: ${err.message}`)
  process.exit(1)
})

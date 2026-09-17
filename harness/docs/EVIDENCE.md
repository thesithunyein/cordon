# EVIDENCE.md — how every number was produced, and how to verify it

Cordon does not assert numbers. Every claim in the README traces back to a
transaction on Ethereum Sepolia, listed in `harness/receipts/receipts.json`.

## What the receipts contain

Each row records one guard-cycle or campaign execution:

| Field | Meaning |
|---|---|
| `timestamp` | UTC time the cycle ran |
| `position` | the Aave V3 account being protected |
| `healthFactorBefore` | raw 1e18 health factor read from `getUserAccountData` |
| `decision` | `protect` / `stand-down` / `error` |
| `action` / `asset` / `amount` | the protective transaction (supply of `asset`) |
| `refused` | `true` = the simulation gate blocked the write (no gas spent) |
| `txHash` | Sepolia transaction, broadcast by KeeperHub |
| `executionId` | KeeperHub execution id (newer rows) — the KeeperHub team can look this up directly in their system |
| `status` | `completed` / `failed` / `error` |
| `error` | the honest failure text, when there was one |

## Verify any hash, end to end

```bash
curl -s https://ethereum-sepolia-rpc.publicnode.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt",
  "params":["<tx_hash>"]}'
```

A valid receipt returns `"status":"0x1"` and a `gasUsed` figure. The script
`harness/scripts/verify-receipts.mjs` runs this for every hash in the file.

## What the counts mean

- **Executions** — guard cycles that reached the chain (`status: completed`)
- **Refusals** — cycles the simulation gate stopped before broadcast
  (`refused: true`). These are features, not failures: a refused write proves
  the gate works, and it cost zero gas.
- **Regressions** — cycles that should have protected but did not. The target
  is always zero.

## Reproduction

```bash
cd harness
cp .env.example .env        # fill in KH_API_KEY and POSITION_ADDRESS
npm install
npm run campaign            # runs CAMPAIGN_ROUNDS cycles, appends receipts
```

The campaign is resumable: it appends after every round, so an interrupted
run loses nothing.

## The threshold, and why older receipts cannot be re-judged

A receipt records what happened, not the policy it happened under. Until
2026-09-17 no receipt carried the threshold in force, which makes a historical
`protect`/`stand-down` unverifiable: the same health factor is a protect or a
stand-down depending on the policy, and the policy changed during the corpus.

That is not a guess, it is in the data. Campaign rows protect at health factors
up to 2,572 *and* stand down in clusters pinned at single health factors
(6.75, 9.00, 11.25, 90.00, 236.25, 348.85, 389.36, 398.35 — all on 2026-09-08,
within seconds of each other). Under one fixed threshold that combination is
impossible: a stand-down at HF 398 requires the threshold to be at or below 398,
while a protect at HF 2,572 requires it to be above 2,572. The threshold moved.

The campaign can move it deliberately — `campaign.ts` raises it above the
verified health factor after each execution when `CAMPAIGN_ESCALATE=true`, whose
whole purpose is to make the next round execute again (§ `.env.example`). Note
also that `Guardian.forPosition()` builds a fresh config object, so
`setThreshold()` only affects the current round; persistence across rounds comes
from the watchlist entry.

**From 2026-09-17 every receipt written by `guard.ts`, `campaign.ts` and
`rescue-external.ts` carries `threshold`.** The 1,353 earlier rows do not, and
should be read as execution evidence only — never as evidence of a correct
decision.

## Third-party rescues

`scripts/find-at-risk.ts` ranks live Aave V3 Sepolia positions by health factor
(pure JSON-RPC, no KeeperHub key) and `scripts/rescue-external.ts` defends one
through the same safe write as the guardian. Receipts from that path carry:

| Field | Meaning |
|---|---|
| `type: rescue` | a third-party rescue, not a guard cycle |
| `external: true` | the defended position is not ours |
| `protectedUser` | the `onBehalfOf` account the write credited |
| `threshold` | the policy in force for the decision |
| `selection` | how the position was chosen, when Cordon picked it itself |

A rescue is a gift: `supply` mints the receiver the aToken, `repay` spends our
funds against their debt, and neither is reversible. A rescue that would revert
is recorded as `refused: true` with no `txHash`, exactly like a guardian refusal.

```bash
cd harness
npm run find:at-risk                     # no credentials needed
RESCUE_TARGET=0x… npm run rescue -- --preview
npm run rescue:auto -- --preview         # let Cordon choose the worst position
```

Discovery lives in `src/discovery.ts`, not in the script body, because the command
a judge runs to inspect the market is the same code that chose the position Cordon
defended — there is no second, privileged path. `selection.method: auto` marks a
row Cordon chose itself; `considered` is how many actionable positions the ranking
saw, and `chosenHf` is the health factor at selection time, so the choice can be
re-derived from the chain later. Rows where an operator named the target carry
`method: explicit` and assert nothing about the ranking.
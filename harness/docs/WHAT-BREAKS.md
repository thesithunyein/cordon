# WHAT-BREAKS.md — the failure cases we hit, and what we did about them

The hackathon form asks what still breaks. Here is the honest answer, kept
current as we hit things.

## Testnet only

All value moved is Sepolia testnet value. The mechanics are the real Aave V3
mechanics — the official AaveV3Sepolia deployment, `getUserAccountData`,
`supply`, `repay` — but nothing here is worth money yet. Mainnet is the
documented next step: the same harness, a funded wallet, and the Aave V3
plugin's write actions (or the equivalent contract calls).

## Aave V3 plugin writes are mainnet-only

KeeperHub's Aave V3 plugin lists mainnet chains (Ethereum, Base, Arbitrum,
Optimism). On Sepolia, Cordon therefore calls the real Aave V3 Sepolia Pool
through KeeperHub's generic web3 actions with Aave-specific ABI handling in
this repo. If the plugin gains testnet support, switching is a config change,
not a rewrite.

## Single protocol, single position

The guardian protects one Aave V3 position per config. Multi-position watch
lists (one workflow per position, or a For Each over a position list) are the
next milestone.

## The threshold is static

One threshold per workflow, set at creation. Per-position, per-asset dynamic
thresholds are planned. The CLI accepts it via env; the workflow definition
bakes it into the condition node.

## Faucet and balance limits

Sepolia faucets rate-limit. A campaign that outpaces the faucet produces
`refused: true` receipts for `insufficient_balance` — which is honest
evidence of the simulation gate, but not evidence of protection. Campaigns
should stay under the faucet's drip rate, or the campaign should be spaced.

## Real refusals recorded during the evidence campaign

The campaign hit three genuine failure conditions, all caught by the
simulation gate with **zero gas spent** (65 refusals total, all in
`receipts.json` with `refused: true`):

| Condition | Revert reason | Count | What it means |
|---|---|---|---|
| Allowance exhausted | `ERC20: transfer amount exceeds allowance` | 10 | The Pool could not pull more LINK than the approved allowance; simulation refused before broadcast |
| Balance exhausted | `ERC20: transfer amount exceeds balance` | 2 | The wallet ran out of LINK entirely; simulation refused before broadcast |
| Capped reserve (USDC) | `Error(51)` — supply cap / insufficient balance | 50 | The shared deployment's USDC reserve cap is full (USDC was never mintable); the gate refused a doomed supply instead of broadcasting it |

Recovery for both: run `npm run mint` (faucet) then `npm run approve` —
each a real KeeperHub transaction itself — and the campaign continues.
This is exactly the failure playbook the judges asked for: nothing
impossible ever reached the chain.

## Approval dust

The protective flow approves the Pool once per cycle (idempotent). Standing
allowances are safe here (the Pool is a trusted contract), but a full
production version should batch approve-and-supply or reuse standing
allowances to avoid redundant approve transactions.

## Latency

Event → broadcast latency through KeeperHub is now measured end to end by
our upstream contribution: a correlation id minted at event observation and
traced through SQS → executor → runner, with per-stage histograms
([keeperhub/keeperhub#2361](https://github.com/KeeperHub/keeperhub/pull/2361)).
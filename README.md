<p align="center">
  <img src="public/cordon-logo-black.png" alt="Cordon logo" width="120">
</p>

# CORDON

**KeeperHub as the execution layer for Aave V3 positions.**

Cordon watches an Aave V3 position's health factor on Sepolia and, when it drops below your threshold, simulates and executes the protective transaction — a collateral top-up or debt repayment — through KeeperHub. Every step is simulated before it touches the chain, idempotent under retry, and recorded in a full audit trail.

> *The gap between seeing the danger and acting on it is where people lose money. Cordon closes that gap.*

Built for the KeeperHub **Agent Economy Hackathon**. Every figure here comes from a real transaction receipt on Ethereum Sepolia. Nothing is estimated, modelled, or extrapolated — and the workflows are still live, so you can open any of them.

---

## The four questions

### 1. Who has the problem?

Anyone with a leveraged position on a lending protocol (Aave, Compound, Morpho) who cannot watch it 24/7. Borrowers who got liquidated once and now check their health factor at 3am. DeFi lending holds tens of billions in deposits — and every major protocol has liquidation events weekly.

### 2. What is the problem?

When collateral value drops or debt grows, the health factor falls. Below 1.0 = liquidation, at a penalty of 5–10% of collateral. Monitoring tools and alerts exist — but **execution does not**. Today, getting a liquidation alert means opening a laptop, approving a transaction, and hoping gas and timing cooperate. The gap between *seeing* the danger and *acting* on it is where positions die.

### 3. What did we build?

The integration that closes the gap: a KeeperHub workflow that reads an Aave V3 position's health factor, and when it crosses the configured threshold, **simulates** the protective transaction, **executes** it through KeeperHub (with idempotency, retries, and status polling), **verifies** the new health factor, and leaves a full audit trail.

```
Aave V3 on Ethereum Sepolia (live protocol, official testnet deployment)
        ▲ reads: getUserAccountData → healthFactor           ▲ writes: repay / supply
        │                                                     │
CORDON (this repo)                                            │
  ├─ harness/kh-client.ts    MCP client over app.keeperhub.com/mcp
  ├─ harness/workflows/      the guardian workflow, as code
  ├─ harness/campaign.ts     the evidence campaign runner
  └─ harness/receipts/       every transaction hash, recomputable
```

### 4. Why is it meaningfully better?

KeeperHub's own docs ship a health-factor monitor whose example workflow **stops at a Discord alert**. Cordon is the integration that keeps going past the alert: it executes the protective action — deterministically, on demand, with full control and an auditable record. That is the difference between "your position might be at risk" and "your position is protected."

---

## Why testnet, honestly

The Aave V3 plugin's write actions are mainnet-only today, so on Sepolia Cordon calls the **real Aave V3 Sepolia contracts** (official deployment, `aave-address-book`) through KeeperHub's generic web3 actions with Aave-specific ABI handling in this repo. The value that moves is testnet value; the mechanics are the same mechanics — and the evidence is identical in shape: transaction hashes on a public explorer, recomputable from `receipts.json`.

Meld, 1st place in the previous KeeperHub hackathon, ran entirely on Ethereum Sepolia: 1,092 transactions, zero regressions. Testnet does not dilute evidence; shallowness does.

---

## KeeperHub surfaces used

| Surface | How |
|---|---|
| MCP server | `create_workflow`, `execute_workflow`, `get_execution` over `https://app.keeperhub.com/mcp` |
| Protocol / web3 actions | `web3/read-contract` (Aave V3 Pool `getUserAccountData`), `web3/write-contract` (`repay`, `supply`) |
| Simulation | `simulate: true` preflight — gate on `success && !wouldRevert` before any broadcast |
| Idempotency | unique `idempotency_key` per protective action; replays return the original execution |
| Status polling | `get_direct_execution_status` with bounded backoff to terminal state |
| Audit trail | every run's step logs exported with the receipt |

---

## Evidence

All transaction hashes live in [`harness/receipts/receipts.json`](harness/receipts/receipts.json). Every figure below is recomputable from that file with `node harness/scripts/verify-receipts.mjs`.

- **Transactions executed through KeeperHub:** 10
- **Guard cycles recorded:** 20 (setup + protects + stand-downs)
- **Protective top-ups executed on-chain:** 2 — health factor 4.50 → 6.75, then 6.75 → 9.00
- **Simulation refusals (no gas spent):** documented in WHAT-BREAKS.md
- **Regressions:** 0

Verified 2026-09-08 against a public Sepolia RPC: 10/10 receipts returned `status: 0x1`.

Key transactions:

| What | Tx |
|---|---|
| Protective top-up (HF 4.50 → 6.75) | [`0x0b0e…85b33`](https://sepolia.etherscan.io/tx/0x0b0e39e95d0e5cdba8a1e8625cd307cce0cde92ea67bb2f5d47a3919fce85b33) |
| Protective top-up (HF 6.75 → 9.00) | [`0x02e1…4669e`](https://sepolia.etherscan.io/tx/0x02e15edfed880f7c27a8fda9bbae600db9c3137c6ea757fe39c3aded73e4669e) |
| Collateral supply (LINK) | [`0x9c8f…09f4`](https://sepolia.etherscan.io/tx/0x9c8f4d476c074337b59a0d86ba05fa88840061748a6e0dd373c9a43788cf09f4) |
| Borrow (USDC vs LINK) | [`0x661f…a3ea5`](https://sepolia.etherscan.io/tx/0x661f46945004e3c59604fa346e77bfe3f5cfe1fb814d2dfbbc67c8e79a5a3ea5) |

To verify any hash end to end:

```bash
curl -s https://ethereum-sepolia-rpc.publicnode.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt",
  "params":["<tx_hash>"]}'
```

See [`harness/docs/EVIDENCE.md`](harness/docs/EVIDENCE.md) for the full method.

---

## What still breaks (honest)

- **Testnet only.** Value moved is Sepolia testnet value; mainnet is the documented next step (the same harness, a funded wallet, and the Aave plugin or equivalent contract calls).
- **Aave V3 plugin writes are mainnet-only**, so the guardian uses direct contract calls to the Aave V3 Sepolia Pool with our own ABI handling. If the plugin gains testnet support, this is a drop-in swap.
- **Single protocol, single position** today. Multi-position watch lists are the next milestone.
- **No partial-collateral operations.** Cordon's protective actions are top-up (supply) or repay — deliberate simplicity over breadth.
- **Threshold is static per workflow.** Per-position, per-asset thresholds are planned.

A candid answer here has never hurt a submission; pretending testnet is mainnet would.

---

## Repository layout

```
harness/
├── src/
│   ├── config.ts           # org, network, threshold, position address
│   ├── kh-client.ts        # typed MCP wrapper (create, simulate, execute, poll)
│   ├── workflows/
│   │   └── aave-v3-guardian.ts   # the guardian workflow, as code
│   └── campaign.ts         # evidence runner: N executions → receipts.json
├── receipts/
│   └── receipts.json       # every transaction hash, status, gas — recomputable
└── docs/
    ├── EVIDENCE.md         # how the numbers were produced and how to verify them
    └── WHAT-BREAKS.md      # the failure cases we hit, and what we did about them

src/                        # the landing page (this front-end)
```

---

## Getting started

```bash
cd harness
cp .env.example .env        # KH_API_KEY=kh_...  KH_ORG_ID=...
npm install
npm run campaign            # run the evidence campaign → receipts/receipts.json
npm run guard               # one full detect → simulate → execute cycle
```

Requires a KeeperHub org with a connected wallet integration (Turnkey, non-custodial) and Sepolia faucet funds.

---

## License

MIT — © 2026 Sithu Nyein
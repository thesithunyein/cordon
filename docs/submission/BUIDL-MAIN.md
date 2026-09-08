# BUIDL draft — MAIN TRACK

> Paste these into the DoraHacks BUIDL form fields. Keep numbers current with the
> README at submission time (campaign still running → check `harness/receipts/`).

## Project name

Cordon

## One-liner

Cordon is an autonomous DeFi position guardian: it watches your Aave V3 health factor
24/7 and executes the protective transaction through KeeperHub the moment liquidation
risk appears — deterministically, simulated before broadcast, with a full audit trail.

## Which project did you integrate with, and what does the integration do?

**Aave V3 (Ethereum Sepolia, the official testnet deployment).** Cordon makes KeeperHub
the execution layer for Aave position protection:

1. Reads the position's health factor through KeeperHub's MCP server
   (`execute_protocol_action` → `aave-v3/get-user-account-data` against the real Aave
   V3 Sepolia Pool).
2. When the health factor crosses the owner's threshold, it simulates the exact
   protective supply (KeeperHub simulation gate) and refuses — at zero gas — if it
   would revert.
3. Executes the protective top-up through KeeperHub (idempotency key, private routing,
   Turnkey non-custodial wallet), polls to terminal status, and re-reads the health
   factor to verify the protection landed.
4. Records every step as a receipt: decision, tx hash, KeeperHub execution id, health
   factor before/after. 1,293 receipts, all recomputable on-chain.

The integration is specific to Aave: it speaks Aave's health-factor semantics, uses
Aave's faucet mechanics, handles Aave's revert codes (Error(51), reserve caps), and
protects against Aave liquidations. It is not a generic wrapper.

**Proof:** 1,055 executed transactions (all `status: 0x1` on Sepolia, re-verified by CI
on every push), 90 simulation refusals across five revert conditions (zero gas), 145
stand-downs, health factor driven 4.50 → 1,100+ by real top-ups. Live audit stream:
https://cordon.sithunyein.com/#/audit. Sample verification table with Etherscan links
and KeeperHub execution ids in the README.

## Which KeeperHub surfaces did you use?

- **MCP server** (`https://app.keeperhub.com/mcp`): the full tool flow —
  `execute_protocol_action` for Aave reads/writes, `execute_contract_call` with
  `simulate: true` for the pre-broadcast gate, `get_direct_execution_status` polling
  with bounded backoff, `create_workflow` + `validate_workflow` for workflow-as-code,
  `list_action_schemas` for platform-accurate node authoring.
- **Agent-authored workflows:** the guardian is also a platform workflow, built
  deterministically from code (`harness/src/workflows/`), pushed via `create_workflow`,
  platform-validated (`valid: true`, 4 nodes), snapshot committed at
  `harness/workflows/guardian.platform.json`.
- **Audit trail:** every execution's KeeperHub execution id is stored in the receipt
  corpus (1,029 ids) — the KeeperHub team can look up any of them directly.
- **Simulation / dry-run before touching the chain:** the core safety property — five
  distinct revert conditions caught pre-broadcast, zero gas spent on any of them.

## Testnet or mainnet?

Testnet only — Ethereum Sepolia, the official Aave V3 deployment. The value moved is
testnet value; the mechanics are real Aave mechanics and real transactions on a public
explorer, re-verified against a public RPC by CI. Mainnet is the documented next step
(the same harness, a funded wallet — the Aave plugin already exposes mainnet chains).

## What still breaks or is unfinished?

Candid list (also in the repo's WHAT-BREAKS.md):

- **Single position, single protocol.** One Aave V3 position per guardian config;
  multi-position watch lists are the next milestone. Compound/Morpho support is
  unbuilt.
- **The protective workflow runs from our harness**, not yet from KeeperHub's own
  scheduler. The platform workflow is pushed and validates, but we hit a template-
  resolution quirk on API-triggered Condition nodes (their own seeded Aave template
  errors the same way when run via API) — reported to the team; scheduled protection
  will flip on when resolved. The CLI harness is the proven path and produced the
  entire evidence corpus.
- **Static threshold.** One threshold per config; per-position, per-asset dynamic
  thresholds are planned.
- **Escalating campaign mode is evidence tooling**, not product: `CAMPAIGN_ESCALATE`
  deliberately re-triggers protection every round to build the on-chain corpus. Real
  guarding uses a fixed threshold and stands down when healthy.
- **No alerting yet.** Telegram/Discord notify nodes exist in the workflow spec but
  need chat-id configuration.

## Links

- Source: https://github.com/thesithunyein/cordon
- Live audit stream: https://cordon.sithunyein.com/#/audit
- Sample tx executed through KeeperHub:
  https://sepolia.etherscan.io/tx/0x0b0e39e95d0e5cdba8a1e8625cd307cce0cde92ea67bb2f5d47a3919fce85b33
- Video: [YouTube/Loom URL after recording — see docs/submission/DEMO-SCRIPT.md]
- Contact: sithunyein.mailto@gmail.com · X: [handle] · Discord: [handle]

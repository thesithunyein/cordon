# Cordon — harness

The working product behind the Cordon landing page: KeeperHub as the
execution layer for Aave V3 positions on Ethereum Sepolia.

```
detect → decide → simulate → execute (idempotent) → verify → record
```

## Requirements

- Node 18+ (fetch)
- A KeeperHub org with a `kh_` API key:
  app.keeperhub.com → Settings → Developer → API keys
- A connected wallet integration (Turnkey, non-custodial)
- An Aave V3 account on Sepolia with some supplied collateral + debt,
  or at least a balance for the faucet to top up
- Sepolia ETH + faucet assets for the position

## Setup

```bash
cp .env.example .env    # fill KH_API_KEY, POSITION_ADDRESS, policy
npm install
npm run setup           # validates env + proves the live MCP → Aave read
npm test                # unit + evidence-integrity tests
```

## Run

```bash
npm run guard        # one full detect → protect → verify cycle
npm run campaign     # CAMPAIGN_ROUNDS cycles, appends receipts each round
npm run drill        # failure drills: stand-down, refusal, injected-429 retry
npm run workflow:push  # push the guardian workflow (as code) to KeeperHub
npm run typecheck    # TypeScript check
npm run verify       # verify every hash against a public RPC
npm run sync:site    # publish receipts.json to the live audit stream
```

## Files

| Path | Purpose |
|---|---|
| `src/kh-client.ts` | typed MCP wrapper (simulate-gate, idempotent execute, poll) |
| `src/guardian.ts` | the guardian core (detect / decide / protect / verify) |
| `src/workflows/aave-v3-guardian.ts` | the same loop as a KeeperHub workflow (as code) |
| `src/campaign.ts` | evidence runner |
| `scripts/drill.ts` | failure-drill suite (see `docs/DRILLS.md`) |
| `workflows/guardian.platform.json` | the pushed workflow, as it exists on KeeperHub |
| `receipts/receipts.json` | the evidence — every tx hash, recomputable |
| `docs/EVIDENCE.md` | how numbers were produced and verified |
| `docs/WHAT-BREAKS.md` | honest failure cases |
| `docs/DRILLS.md` | the failure drills, with live results |
| `docs/WORKFLOW-AS-CODE.md` | workflow-as-code pushed + validated |

## Contract addresses

Official Aave V3 Sepolia deployment (aave-address-book):

- Pool: `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`
- PoolAddressesProvider: `0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A`
- Faucet: `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D`
- USDC: `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8`
- DAI: `0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357`
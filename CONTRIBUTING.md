# Contributing to Cordon

Thanks for picking this up. Cordon is a small, sharp codebase with one hard
rule: **every claim in the README is either a test or an on-chain receipt.**
Keep it that way.

## One-command start

```bash
cd harness
cp .env.example .env     # add your KH_API_KEY and POSITION_ADDRESS
npm install
npm run setup            # validates env, proves the live MCP → Aave read
npm test                 # 58 unit + evidence-integrity tests
```

## Where things live

| Path | Purpose |
|---|---|
| `harness/src/kh-client.ts` | Typed client over KeeperHub's MCP server (retry, simulation gate, polling) |
| `harness/src/guardian.ts` | The core loop: detect → decide → protect → verify |
| `harness/src/config.ts` | Env-driven config (see `.env.example`) |
| `harness/src/receipts.ts` | Append-only receipt store — the evidence |
| `harness/src/workflows/` | The guardian workflow built as code + its tests |
| `harness/scripts/` | setup, mint, approve, campaign, drill, verify, sync, push-workflow |
| `harness/docs/` | EVIDENCE, WHAT-BREAKS, DRILLS, WORKFLOW-AS-CODE |
| `harness/receipts/receipts.json` | Every decision and transaction, recomputable on-chain |

## Rules of the road

1. **Open an issue first** for anything non-trivial; say what you're changing
   and why. One scope per PR.
2. **Tests where they add value** — logic changes get a unit test; evidence
   claims get re-verified by `npm run verify` (the CI does this on every push).
3. **Never touch `harness/.env` or commit a real API key.** `.env` is
   gitignored; use `.env.example` for anything shareable.
4. **Keep WHAT-BREAKS honest.** If you hit a failure mode, document it there —
   a candid known-issue beats a hidden one.
5. **Formatting:** the repo uses tabs and single quotes. `npm run typecheck`
   must pass before a PR.

## On-chain campaigns

Running the campaign spends Sepolia testnet value and appends real receipts.
That is the point — but be deliberate:

```bash
cd harness
npm run mint        # fund the reserve (faucet)
npm run approve     # allow the Aave Pool to pull the reserve
npm run campaign    # N guard cycles, escalating (receipts append)
npm run verify      # re-verify every receipt against a public RPC
npm run sync:site   # publish the corpus to the live audit stream
```

Each executed receipt carries a real Sepolia tx hash and a KeeperHub execution
id — both are auditable by the KeeperHub team.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be excellent; report anything
that isn't.

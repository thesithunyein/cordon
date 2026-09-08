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
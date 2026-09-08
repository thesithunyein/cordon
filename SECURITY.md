# Security Policy

## Supported versions

Only the current `main` branch of this repository is supported.

## Reporting a vulnerability

**Do not open a public issue for security problems.** Report privately to the
maintainer: open a GitHub issue with the label `security`, or contact the
maintainer directly through the GitHub profile at
https://github.com/thesithunyein.

Please include:

- The affected file and version (commit hash if possible)
- A description of the vulnerability and its impact
- Steps to reproduce, if available

You should expect a first response within 7 days. Please do not disclose the
issue publicly until it has been addressed.

## What Cordon does with your funds

- **Non-custodial.** All funds stay in the KeeperHub Turnkey wallet. Cordon never
  holds, transfers, or has access to private keys.
- **Simulation-first.** No transaction is broadcast until a `simulate` preflight
  proves it will succeed. Reverting transactions cost zero gas.
- **Idempotent.** Every protective action carries a unique `idempotency_key`;
  retries can never double-execute.
- **Least privilege.** The `KH_API_KEY` used by the harness should be scoped to
  the minimum permissions needed (Write + Read; Full access only if required).
- **Key hygiene.** `harness/.env` is gitignored. Never commit API keys, and treat
  them like passwords — they can move funds.

## Testnet disclaimer

This project operates on Ethereum Sepolia testnet. Testnet assets have no real
value and are freely obtainable from faucets. Do not send mainnet funds to any
address mentioned in this repository.

## Faucets (Sepolia)

| Asset | Where |
|---|---|
| ETH | https://cloud.google.com/application/web3/faucet/ethereum/sepolia |
| USDC / LINK / DAI | Aave V3 Sepolia faucet contract `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D` (`mint(token, to, amount)`) |
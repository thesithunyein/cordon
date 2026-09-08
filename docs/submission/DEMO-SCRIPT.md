# Cordon — demo video script (5 minutes, record in one sitting)

**Rule:** everything shown is live. No slides. If a step fails on camera, say so and show
the recovery — that is the product.

## 0:00–0:30 — The problem (screen: the live audit stream)

> "If you have a leveraged position on Aave, you have a 3am problem. When your health
> factor crosses 1.0, you get liquidated — 5 to 10% of your collateral, gone. Monitoring
> tools tell you you're at risk. Alerts wake you up. Neither one protects you.
> This is Cordon — and this is its live audit trail: 1,000-plus real transactions on
> Aave V3 Sepolia, every decision recorded."

*(Show cordon.sithunyein.com/#/audit scrolling — real rows, real tx links.)*

## 0:30–1:15 — The integration, live (terminal)

> "Cordon watches an Aave V3 position through KeeperHub's MCP server. Here's one full
> cycle, live:"

```bash
cd harness && npm run guard
```

Narrate the output as it prints: **detect** (reads the real health factor from the
Aave Pool via KeeperHub) → **decide** → **simulate** → **execute** → **verify**. Point
at the printed transaction hash.

> "That transaction just went through KeeperHub — private routing, idempotency key,
> full audit trail. It's already on Etherscan."

*(Paste the hash into Etherscan, show `status: 1`.)*

## 1:15–2:15 — The simulate gate: the 5 seconds that make it safe

> "Here's what separates Cordon from a bot that blindly fires. Watch what happens when
> protection would fail:"

```bash
npm run drill
```

Show D2: the guardian requests an impossible supply, the simulation reverts,
**nothing broadcasts, zero gas**.

> "That revert never touched the chain. The gate refuses five different failure
> conditions — exhausted balance, exhausted allowance, a capped reserve. And when the
> position is healthy, Cordon stands down — 145 times in this corpus. Restraint is
> evidence too."

Show D3: two injected 429s absorbed by retry-with-backoff.

> "And when KeeperHub itself hiccups? Exponential backoff. No human, no missed
> protection."

## 2:15–3:15 — The evidence, recomputable (README + Etherscan)

Open the README's **Verify any execution yourself** table.

> "Every number in this README is recomputable. Here's a transaction from the middle
> of the corpus — health factor 636 to 643 — click through to Etherscan, status 1.
> And every receipt carries the KeeperHub execution id — their team can look any of
> these up directly. Want the whole corpus? receipts.json, 700-plus rows, also served
> live at the audit stream you saw at the start."

```bash
npm run verify
```

> "The CI re-runs this on every push — 1,055 receipts re-verified against a public
> RPC, zero failures."

## 3:15–4:15 — Workflow-as-code (the agent-economy story)

> "The same guardian also exists as a KeeperHub workflow, authored as code in this
> repo — nodes matching the platform's action catalog, covered by tests. We pushed it
> through the MCP server's create_workflow surface and the platform validated it:
> valid, four nodes. Here's the exact JSON the platform returned, committed in the
> repo. Nothing is inferred at execution time — that's the point."

*(Show harness/workflows/guardian.platform.json + validate output.)*

## 4:15–5:00 — Close

> "Cordon is the execution layer the KeeperHub theme describes: deterministic,
> simulated before broadcast, idempotent, audited. 500-plus on-chain protections
> across a 535-times health-factor range, 91 refusals, 147 stand-downs, zero
> regressions — and an open-source bounty PR implementing KeeperHub's own accepted
> issue. Your position is protected, not just alerted. Cordon off your risk."

---

**Recording notes:** 1080p, terminal font ≥16pt, dark theme. Pre-warm everything
(`npm run setup` once before recording so the MCP handshake is instant). Total on-chain
cost per guard cycle ≈ 5 LINK testnet + relay gas — nothing to budget.

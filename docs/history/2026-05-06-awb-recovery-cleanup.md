# AWB Recovery Cleanup - 2026-05-06

## Context

AWB, originally developed as MTWM and inspired by Reuven Cohen's neural trader, had accumulated multiple trading strategies while trying to recover from early paper-trading losses. The Alpaca paper account had drawn down materially from its original balance. The system had learned useful lessons, but the runtime and strategy surface had become too broad and too fragile.

The project direction changed on 2026-05-06:

- Use the name AWB, Autonomous Wealth Builder, instead of MTWM for the active system.
- Keep Alpaca trading paper-only until the system is stable.
- Treat Trident as an external hosted reasoning and memory service backed by RuVector.
- Keep AWB's trading authority deterministic and limited.
- Prepare for DigitalOcean deployment using DOCR images.
- Leave future wealth streams, such as real estate CRM outreach and collectibles, modular rather than coupled to the trading engine.

## What Went Wrong

The trading engine had drifted from the intended recovery strategies. In addition to RSI-2 and ORB, it contained several opportunistic entry paths:

- Premarket momentum buys.
- Priority watchlist momentum buys.
- Catalyst buys.
- Morning RSI-2 buys.
- Intraday sector inverse buys.

These paths were added during recovery attempts but were not all backed by the same clean specification, backtest discipline, or operational guardrails.

The more serious runtime issue was duplicate orchestration. Multiple gateway and trade-engine processes were running at the same time, which created duplicated sell attempts and inconsistent local state. This explained several confusing behaviors near market close.

There was also a long/short classification bug. Alpaca short positions were not reliably represented as negative-share positions in the local executor, and the RSI scanner could treat any held ticker as eligible for short-cover logic. That allowed normal long holdings, including AMD, to be evaluated through the wrong exit path.

## May 6 Runtime Incident

Near market close, AWB sold or reconciled several positions in ways that did not match the intended RSI-2 behavior. AMD was a clear example: it appeared to be doing fine and should not have been exited as a short cover. The root cause was not the RSI-2 strategy itself, but the combination of:

- Duplicate engine/orchestrator processes.
- Bad long/short detection.
- Exit paths that were too permissive.
- Strategy drift from accumulated recovery experiments.

After inspection, the duplicate gateway and trade-engine processes were stopped. A later process check showed no active `gateway-v2`, `trade-engine`, or `gateway-watchdog` process running.

## Cleanup Completed

The active recovery baseline was tightened:

- `MAX_POSITIONS` set to 5.
- Per-position target set to `$10,000`.
- Total deployed cap set to `$50,000`.
- Momentum, catalyst, watchlist, morning-RSI, and intraday sector-inverse buys defaulted off.
- Broker-side stop placement restored for long entries.
- Broker-side buy stops added for short entries.
- Stale stop cleanup added for both long and short protective orders.
- Same-session sell guard added to reduce duplicate exits.
- Short close paths now record direction correctly.
- Half-profit sell path now records closed trades.
- RSI scanner now separates held long tickers from held short tickers.
- Exit execution now verifies direction before selling longs or covering shorts.
- Alpaca short positions are now mapped to negative shares in the executor.

The sell-path verifier was improved and added to the service build, so `npm run build` now runs TypeScript compilation plus sell-path verification.

## Deployment Cleanup

DigitalOcean Container Registry scaffolding was added:

- `services/Dockerfile` builds the AWB services image.
- `mtwm-ui/Dockerfile` builds the AWB UI image.
- `.github/workflows/docr.yml` builds and pushes `awb-services` and `awb-ui`.
- `docs/deployment/awb-docr.md` documents required GitHub secrets and runtime rules.

The deployment direction is:

- Run exactly one `awb-services` instance with trading enabled.
- Consume Trident externally.
- Do not deploy OpenClaw or research managers as trading authorities.
- Keep SQLite for current gateway transactional state until a deliberate PostgreSQL migration is implemented.
- Use PostgreSQL for enrichment/research where already appropriate.

## Verification

The service build passed:

```text
npm run build
tsc && npm run verify:sell-paths
[verify-sell-paths] OK
```

The UI build passed after removing the network-dependent Google font imports and switching to system font stacks.

```text
npm run build
Next.js compiled successfully
```

## Current Restart Gate

Trading should not be restarted until live Alpaca state is reconciled against local SQLite state. The next restart should be deliberate, with:

- One gateway process.
- One trade engine.
- Paper trading only.
- Verified positions from Alpaca.
- Local state reconciled before the first heartbeat.
- Strategy scope limited to the documented AWB recovery baseline.

This gate was later cleared on 2026-05-06 after Alpaca paper showed only `DVA` and `NVDA`, local open `system_buys` was synced to those two positions, and broker-side paper stops were placed for both. See `docs/history/alpaca-reconcile-2026-05-06.md`.

## Protection Review

AWB currently has two equity loss controls:

- `$100` heartbeat stop: active only while the AWB trade engine is running and able to submit orders.
- 5% Alpaca broker stop: wider disaster protection that survives local process failure and Mac sleep.

The broker stop is still useful even with the `$100` sell parameter because the `$100` rule is software-local. If the local machine sleeps, the gateway crashes, or network/API calls fail, only the broker-side stop remains active.

## Historical Note

The conclusion from this cleanup is that RSI-2 and ORB are still viable strategies, but AWB's operational layer had become noisy. The recovery focus is therefore not to invent more trading ideas, but to reduce authority, enforce single-instance execution, verify exits, and restart from a clean state.

## First Pattern To Preserve

After the cleanup, NVDA was identified as the kind of missed opportunity AWB must learn from: a liquid S&P 500 leader that could have been bought near a favorable prior-week level and reportedly produced an 11.9% move by 2026-05-06.

This should be handled as a reusable pattern, not a one-off hindsight complaint. The candidate pattern is documented in `docs/patterns/2026-05-06-nvda-missed-leader-reversion.md`.

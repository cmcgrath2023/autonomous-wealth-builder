# MTWM Intelligence Layers Audit

**Date:** 2026-04-10
**Context:** Post-incident audit triggered by the -$6,787 loss day. Owner asked for a definitive "what's actually working, what's theater, and what's dead code" in the intelligence stack.
**Method:** Traced every layer from `gateway-v2/src/index.ts` through the running trade loop (`trade-engine.ts`, 120s heartbeat) with file:line evidence.

> **CORRECTION 2026-04-10 (post-fix):** My initial pass labeled NeuralTrader as "dormant / result discarded". I was wrong. NeuralTrader WAS wired as a hard gate in the top-movers buy path (`trade-engine.ts:1104`). What was actually missing was the same gate on the research-star buy path (the primary source of buy candidates). That has now been added — see section 3 below for the corrected status.

---

## Summary table

| # | Layer | Verdict | Gates a decision? | Evidence |
|---|---|---|---|---|
| 1 | Trident Brain | **DELIVERING** | Yes — `shouldBuy`/`shouldSell` hard gates | trade-engine.ts:596, 1117, 1191 |
| 2 | Bayesian Intelligence | **DELIVERING** | Yes — confidence adjust, posterior reject | trade-engine.ts:571-585 |
| 3 | Neural Trader | **DELIVERING (now in both paths)** | Yes — rejects non-'buy' direction | trade-engine.ts:1104, and new gate at ~:605 |
| 4 | Research Worker | **DELIVERING** | Yes — primary candidate source | research-worker.ts (PID sibling process); trade-engine.ts:926 |
| 5 | Warren → Fin urgency cascade | **DELIVERING** | Yes — urgency=critical triggers Fin cuts | warren.ts:91; fin.ts:97-103 |
| 6 | FACT Cache | **OBSERVING (indirect)** | Influences research star scoring only | research-worker.ts:179-227 |
| 7 | SONA | **REMOTE LEARNING (outbound only)** | No local read-back | brain-client.ts:162-171; index.ts:256-264 |
| 8 | Nanobot Scheduler (trade_advisor etc) | **OBSERVING (writes to unread bucket)** | **No** — output goes nowhere | nanobot-bridge.ts:121 vs trade-engine.ts:926 |
| 9 | Liza (news manager) | **OBSERVING** | **No** — output never read by trade-engine | liza.ts runs; no consumer |
| 10 | Ferd (research manager) | **OBSERVING** | **No** — output never read by trade-engine | ferd.ts runs; no consumer |
| 11 | Daily Optimizer (mincut) | **DEAD CODE** | No | trade-engine.ts:268 instantiation; `.optimize()` never called |
| 12 | RVF Engine | **DEAD CODE** | No | index.ts:268-273 instantiated in try/catch; never referenced |
| 13 | LearningEngine | **DEAD CODE** | No | index.ts:268-273 instantiated in try/catch; never referenced |

---

## 1. Trident Brain — DELIVERING

**What it is:** Remote LoRA + memory store at `brain.oceanicai.io` / `trident.cetaceanlabs.com`. Reached from gateway via `services/gateway-v2/src/brain-client.ts` using a Bearer API key (`BRAIN_API_KEY` env var).

**Wired as a hard gate:**
- `brain.shouldBuy(symbol, strength, context)` — called at `trade-engine.ts:596` (research star path) and `:1117` (top mover path). If it returns `should: false`, the buy is rejected with the LoRA's reason logged. Gate 6 in both paths.
- `brain.shouldSell(ticker, pnlPct, unrealizedPnl, holdMinutes)` — called at `trade-engine.ts:1191` for every position outside the neutral zone. If LoRA says sell, the engine places the sell.
- `brain.getTickerHistory(ticker)` — Gate 3 at `:557` and `:1088`. Sets `shouldAvoid` flag if win rate <35% over 5+ trades; blocks the buy.
- `brain.recordTradeClose(ticker, pnl, pct, reason, direction)` — called from every sell path via `recordClosedTrade()` in `trade-recorder.ts`. Records every close as a tagged memory for future LoRA training.

**Background learning:**
- `brain.syncBeliefsToSona()` runs every 5 min in `index.ts:256-264`, pushing serialized Bayesian beliefs to `/v1/train`.
- `brain.getRecentTradeOutcomes()` bulk-recalls past outcomes on startup to reconstruct the Bayesian state.

**Caveat — two different Trident channels:**
1. **Gateway → Trident over HTTPS:** works. Bearer-authed. Records writes, reads queries, 200 OK. The trading-side Trident path is healthy.
2. **Claude Code MCP → Trident via SSE:** broken. `claude mcp list` shows `trident: ... - ✗ Failed to connect`. Session-start directives (`mcp__trident__cognitive_status`, `mcp__trident__search_knowledge`) cannot run from within Claude Code until this is fixed. Does NOT affect the engine.

**Value:** HIGH. Every buy passes through a Trident shouldBuy gate. Every sell either passes through a Trident shouldSell consultation OR records to Brain memory afterward. The LoRA has visibility into every trade outcome.

---

## 2. Bayesian Intelligence — DELIVERING

**What it is:** `services/shared/intelligence/bayesian-intelligence.ts` — Beta-distribution belief tracker keyed by ticker / strategy / timing. Maintains `alpha`, `beta`, `posterior`, `observations`, `avgReturn` per subject.

**Wired as a hard gate:**
- Instantiated at `index.ts:228`, seeded from Brain's bulk-recall of past outcomes (`index.ts:230-242`).
- IPC-pushed from parent to trade-engine child after every `trade:closed` event (`index.ts:362-377`).
- Trade-engine listens for `intelligence:beliefs` messages and rehydrates via `BayesianIntelligence.fromSerialized()` (`trade-engine.ts:33-38`).

**Gate 4 at `trade-engine.ts:571-585`:**
```ts
adjustedScore = _bayesian.adjustSignalConfidence(star.symbol, star.score, 'buy');
const prior = _bayesian.getTickerPrior(star.symbol);
if (prior.observations >= 3 && prior.posterior < 0.40) {
  details.push(`SKIP ${star.symbol} — Bayesian reject`);
  continue;
}
```

If the ticker has 3+ observations and <40% posterior win rate, the buy is rejected. If >70% posterior, the confidence is boosted by 10%.

**Value:** HIGH. This is the second hard-gate alongside Trident LoRA. Blocks tickers with demonstrated losing histories.

---

## 3. NeuralTrader — DELIVERING (corrected)

**What it is:** `services/neural-trader/src/index.ts` (402 lines). The original signal engine that the platform was built on. 7-indicator technical analyzer: RSI, MACD, Bollinger Bands, EMA, momentum, mean-reversion, neural forecast. Exposes `scan()`, `analyze(ticker)`, `addBar(ticker, close, volume)`, `diagnose()`.

**Wired in both buy paths (as of the 2026-04-10 fix):**

### Top-movers path — was already wired
`trade-engine.ts:1093-1112` — Gate 5:
```ts
const barsUrl = `https://data.alpaca.markets/v2/stocks/${g.symbol}/bars?timeframe=15Min&limit=50&feed=iex`;
const barsRes = await fetch(barsUrl, ...);
if (rawBars.length >= 30) {
  for (const bar of rawBars) this.neural.addBar(g.symbol, bar.c, bar.v || 0);
  const neuralSignal = await this.neural.analyze(g.symbol);
  if (neuralSignal && neuralSignal.direction !== 'buy') {
    buyAudit.push(`${g.symbol}: SKIP neural-${neuralSignal.direction}`);
    continue;  // HARD REJECT
  }
}
```

### Research-star path — added 2026-04-10
Same logic added as Gate 5b (before Trident's Gate 6) at `trade-engine.ts:~605`. Now research stars get the same technical confirmation before being bought. Non-crypto only; fetches 50 bars of 15-minute Alpaca data; requires ≥30 bars; rejects any star whose direction isn't `buy`.

**Soft-fail behavior (same in both paths):**
- If bars fetch fails → `FAILED` logged, proceeds without gate (does NOT reject)
- If <30 bars available → `N-bars (need 30)` logged, proceeds without gate
- If neural returns null → `no-signal` logged, proceeds without gate
- If neural returns `direction: 'sell'` or `'hold'` → HARD REJECT

**The original mistake in the first audit pass:** I read `neuralResult` (a log string) and missed the `continue` statement three lines earlier. NeuralTrader was never dormant — the top-movers path has always been gated. But the research-star path — which is where 80% of our buys originate — was NOT gated by Neural until today's fix.

**Value:** HIGH, and higher now that it covers both paths. This is the foundational signal engine and it's back as a first-class citizen.

---

## 4. Research Worker — DELIVERING

**What it is:** `services/gateway-v2/src/research-worker.ts` — runs as a child process alongside trade-engine (visible in `ps` as a sibling). 120s cycle. Parses RSS feeds, fetches Alpaca snapshots for 5 sectors, updates FACT cache, writes research stars to state store.

**Wired as the primary candidate source:**
- `trade-engine.ts:926` — `this.store.getResearchStars()` is read first every buy cycle
- Alpaca top movers and Yahoo gainers are used ONLY if research stars are empty (`trade-engine.ts:951-981`)
- Stars carry symbol + sector + catalyst + score; score is Bayesian-adjusted inside the research worker

**Value:** HIGH. This is the primary candidate feeder. If it stopped running, the engine would fall back to blunt "top % gainers" with no sector or catalyst context.

---

## 5. Warren → Fin urgency cascade — DELIVERING (partial)

**What it is:** `managers/warren.ts` (MD, 30s cycle) + `managers/fin.ts` (trading manager, 60s cycle). Started from `managers/index.ts:31-45`.

**Live control loop:**
- **Warren** reads P&L, position count, total deployed, each manager's health. Computes an urgency level (`normal` / `elevated` / `critical`). Writes to `store.set('warren:urgency', ...)` every 30 seconds (`warren.ts:91`).
- **Fin** reads the urgency at `fin.ts:95` on each 60-second cycle. When urgency == 'critical', Fin runs emergency cuts (`fin.ts:97-103`) — closes any position with >$30 unrealized loss.
- **Fin also independently manages positions:** tightens trailing stops on positions >$100 unrealized (`fin.ts:222-230`), banks outsized winners >$500 unrealized (`fin.ts:209-213`).

**Value:** MEDIUM. The urgency signal is a secondary safety net parallel to the main circuit breaker. Fin's bank-winner logic is the one place the engine ever takes profit above the +15% TP floor.

---

## 6. FACT Cache — OBSERVING (indirect)

**What it is:** `services/shared/src/fact-cache.ts` — caches sector+catalyst+condition patterns with hit/miss tracking.

**Wired in research worker only:**
- `research-worker.ts:179-227` — looks up past patterns, weights new star scores by historical success rate, records outcomes
- `trade-engine.ts` never instantiates or queries FACT cache directly

**Value:** MEDIUM. Influence flows indirectly: better-cached patterns → higher research star scores → trade-engine sees them with higher confidence. No direct gating.

---

## 7. SONA — REMOTE LEARNING (outbound only)

**What it is:** Trident's internal self-optimizing pattern system. MTWM pushes Bayesian beliefs to it via the `/v1/train` endpoint.

**Wired as a one-way data push:**
- `index.ts:256-264` — every 5 minutes, calls `brain.syncBeliefsToSona(beliefs)`
- `brain-client.ts:162-171` — POSTs each belief as `{ input, output }` training pairs to `/v1/train`
- No code reads SONA predictions back

**Value:** UNKNOWN. We cannot measure local impact because there's no read-back. If Trident consolidates these pushes into better LoRA weights, the value shows up indirectly in `shouldBuy`/`shouldSell` responses. If it doesn't, we're paying for the POST traffic with no return.

---

## 8. Nanobot Scheduler — OBSERVING (writes to a dead drop)

**What it is:** `services/gateway-v2/src/nanobot-scheduler.ts` + `nanobot-bridge.ts`. Cron-scheduled sub-agent tasks that spawn LLM-backed nanobots:
- `market_monitor` every 5 min
- `trade_advisor` every 10 min (weekdays only)
- `forex_alert` every 15 min
- `digital_twin_check` every hour
- `briefing_generator` daily at 7 AM

**The broken pipeline:**
- `trade_advisor` successfully runs, calls Haiku/Sonnet, produces `{ ticker, action: 'buy', reason, confidence }` recommendations
- Output is written to the store as `advisor_star:${ticker}` (`nanobot-bridge.ts:121`)
- **`trade-engine.ts:926` reads `store.getResearchStars()` — which queries a DIFFERENT store key.** `advisor_star:*` is written to and never read.
- Other nanobot outputs (`market_monitor`, `forex_alert`) are stored but never queried either.

**Value:** ZERO direct. Cost: every 5-10 minutes a Haiku or Sonnet call is made during market hours, producing recommendations that are written into a bucket nothing reads. Pure theater, and it's costing API spend.

**Fix options:**
- Wire `advisor_star:*` into `getResearchStars()` so trade_advisor recommendations actually gate buys
- OR turn off the trade_advisor cron entry in `nanobot-scheduler.ts:63-80`

---

## 9. Liza (news manager) — OBSERVING

**What it is:** `managers/liza.ts` — runs on 90s cycle, scans news sources, writes status to store.

**The disconnect:** Nothing in `trade-engine.ts` reads Liza's output. News analysis happens; no buy or sell decision depends on it.

**Value:** ZERO direct.

---

## 10. Ferd (research manager) — OBSERVING

**What it is:** `managers/ferd.ts` — runs on 120s cycle, produces research analysis, writes directives to store.

**The disconnect:** Same pattern as Liza. Fin reads directives like `fill_open_slots` (`fin.ts:94, 109-116`) but treats them as log entries, not execution triggers. Trade-engine reads nothing from Ferd.

**Value:** ZERO direct.

---

## 11. Daily Optimizer (mincut) — DEAD CODE

**What it is:** `services/mincut/src/daily-optimizer.ts` — Kelly fraction / MinCut tactical strategy engine. Produces `{ riskBudget, takeProfitTarget, approach, maxNewPositions, actions }`.

**The disconnect:**
- Instantiated at `trade-engine.ts:268` (`this.dailyOptimizer = new DailyOptimizer()`)
- `_lastStrategy` is declared at `trade-engine.ts:205`
- **`dailyOptimizer.optimize()` is NEVER called** — grep produces zero results anywhere in gateway-v2
- `_lastStrategy` is read at `trade-engine.ts:430` (`strategy.maxPositions`) but it's permanently null
- The read falls through to defaults (`MAX_POSITIONS = 10`, `BUDGET_MAX = 25_000`)

**Value:** ZERO. It's architectural debt — a planned feature that was never wired.

---

## 12. RVF Engine — DEAD CODE

**What it is:** `services/rvf-engine/src/index.ts` — trait engine for market pattern retrieval.

**The disconnect:**
- Instantiated at `index.ts:268-273` inside a try/catch (so failures are silent)
- No method on `rvfEngine` is ever called anywhere in gateway-v2
- Variable is not exported, not passed to any other module

**Value:** ZERO.

---

## 13. LearningEngine — DEAD CODE

**What it is:** `services/rvf-engine/src/learning-engine.ts` — sibling of RVF engine, meant to consolidate trade outcomes into learned patterns.

**The disconnect:**
- Same story: instantiated in the same try/catch at `index.ts:268-273`
- `.train()`, `.learn()`, `.consolidate()` — none of them are called

**Value:** ZERO.

---

## What this means

**4 layers are actively gating decisions and delivering value:**
1. Trident Brain (shouldBuy / shouldSell hard gates)
2. Bayesian Intelligence (posterior reject)
3. NeuralTrader (direction gate in both buy paths as of 2026-04-10)
4. Research Worker (primary candidate source)

Plus Warren → Fin urgency as a secondary safety net.

**3 layers are running and producing output that nothing reads** (Nanobot trade_advisor, Liza, Ferd). These are the "80% theater" the owner called out. Cost: LLM API spend on Nanobot + CPU cycles on the manager loops, for zero trading impact.

**3 layers are dead code that gets instantiated at startup and never touched again** (Daily Optimizer, RVF Engine, LearningEngine). Maintenance risk: the next time someone reads the code they'll assume these are doing something, the way I assumed the circuit breaker was working.

---

## Priority cleanup (from this audit)

1. **Delete or wire the dead code.** Daily Optimizer, RVF Engine, LearningEngine. Three imports, three instantiations, zero callers. Delete unless they're going to be wired this week.

2. **Fix Nanobot plumbing.** Either add `advisor_star:*` to `getResearchStars()` so trade_advisor recommendations actually gate buys, or turn off the `trade_advisor` cron. Right now we're paying API tokens to write to /dev/null.

3. **Decide about Liza and Ferd.** If their analysis is valuable, add read-calls in trade-engine. If it's not, stop running the cycles. Half-running is the worst option.

4. **Get the Claude Code → Trident MCP connection fixed.** Low priority; the trading-side Trident path is healthy. But the session-start cognitive_status calls can't run until this works.

5. **Add verification for the "no orphan intelligence" class of bug.** A test similar to `verify-sell-paths.ts` that fails at build time if a class is instantiated but never called. This would have caught Daily Optimizer / RVF / LearningEngine on day one.

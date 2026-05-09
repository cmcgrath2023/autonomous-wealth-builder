# MTWM Trading Strategy Specification

**Version:** 3.0 — Buffett Quality + RSI-2 Timing + Catalyst Momentum
**Implemented:** 2026-04-22 (RSI-2), evolved 2026-05-08 (Buffett hybrid)
**Last Updated:** 2026-05-09

---

## Core Philosophy: Warren Buffett Hybrid

Buy high-quality companies with durable competitive advantages that are showing momentum. Quality first, timing second. Owner's manual picks using this approach produced $1,400 days.

**Primary filter:** Is this a great business? (Buffett quality — moats, cash flow, management)
**Secondary filter:** Is now a good time to buy? (RSI-2 oversold, catalyst momentum, sector strength)
**Universe:** S&P 500 stocks only + approved inverse ETFs. No speculative small caps.

### Berkshire Portfolio (Pre-Approved Quality)

These tickers get priority when signals appear — they've passed the Buffett quality test:

| Tier | Tickers | Why |
|------|---------|-----|
| Core Holdings | AAPL, AXP, BAC, KO, CVX | Largest Berkshire positions |
| Key Investments | MCO, OXY, COF, GOOGL, KR | Significant Berkshire holdings |
| Owner Favorites | NVDA, MSFT, AMZN, META, DVA | Proven winners from manual trading |

### Blacklisted Tickers (Trident SONA Avoid)

| Ticker | Reason |
|--------|--------|
| DIS | Slow mover, legacy media, never produces meaningful gains |
| (more added via Discord `!note` or Trident training) | |

---

## Overview

| Strategy | When | What It Does | Edge |
|----------|------|-------------|------|
| Morning Prep | 8:00 AM ET | Merges last night RSI-2 + research catalysts + pre-market snapshots | Catches gap-ups at open |
| ORB | 9:48 AM ET | Buys controlled gap-ups that break opening range | 58-62% (Crabel, Fisher) |
| Catalyst Buys | 10:00 AM-3:30 PM | Buys high-score research stars moving up today (S&P 500 only) | Research-backed momentum |
| RSI-2 Long | 3:50 PM ET | Buys oversold S&P 500 stocks in uptrends | 65-73% (Connors) |
| RSI-2 Short | 3:50 PM ET | Shorts extreme overbought (>96) below SMA200 | 55-65%, max 1 |
| Inverse ETF | 3:50 PM ET | Buys SQQQ/SH when SPY < 20-day SMA | Regime filter (Faber) |
| Mover Capture | 3:55 PM ET | Records top 14 S&P 500 winners/losers for analytics | Predictive data |

**Position Sizing:** $10K per position, 5 positions max, $50K total budget

**Protection:** $100 heartbeat stop loss + $500 sell-half take-profit + 5% broker-side disaster stop. No shorts overnight. No new buys after 3:30 PM.

**Trident Gate:** Every buy checked against SONA (avoid flags, owner preferences, trade history). Trident records every outcome for continuous learning via SONA + NOVA.

---

## Strategy 1: RSI-2 Long (Connors Mean Reversion)

**Source:** Larry Connors & Cesar Alvarez, "Short Term Trading Strategies That Work" (2008). Backtested 1993-2008 on S&P 500 constituents.

### Why It Works
Stocks in long-term uptrends that get temporarily oversold attract institutional dip-buyers. The 200-day SMA filter keeps us out of broken stocks falling for fundamental reasons. RSI(2) is extremely sensitive — it flags 1-2 day pullbacks within strong trends.

### Rules

**Entry (Buy at ~3:50 PM ET):**
1. Stock is in the S&P 500
2. RSI(2) < 10 — extreme short-term oversold
3. Price > 200-day SMA — long-term uptrend intact
4. Tiebreaker: stocks with research worker catalysts (Yahoo losers, news) get priority

**Exit:**
1. RSI(2) > 70 — stock has bounced (checked at 3:50 PM daily)
2. OR held > 5 trading days — time stop
3. OR broker stop hit — 5% below entry

**Stop Loss:**
- Broker-side stop order at entry price × 0.95 (5% below)
- Placed as OTO (one-triggers-other) bracket order with the buy
- Alpaca executes automatically — no heartbeat dependency

**Expected:** 65-73% win rate, 2-3 day average hold, +0.75% average gain per trade

---

## Strategy 2: RSI-2 Short

**Source:** Connors' inverse of Strategy 1. Documented but with weaker edge than the long side.

### Why It Works
Stocks in broken downtrends (below 200-day SMA) that get an overbought bounce are likely to resume falling. The bounce is temporary — shorts capture the reversion back down.

### Rules

**Entry (Short sell at ~3:50 PM ET):**
1. Stock is in the S&P 500
2. RSI(2) > 90 — extreme short-term overbought
3. Price < 200-day SMA — long-term downtrend (broken stock)

**Exit:**
1. RSI(2) < 30 — stock has pulled back (cover)
2. OR held > 5 trading days — time stop
3. OR broker stop hit — 5% above entry

**Stop Loss:**
- Broker-side stop order at entry price × 1.05 (5% above)
- For shorts, the stop is a BUY order that triggers if price rises against us

**Expected:** 55-65% win rate in bearish regimes, weaker in bull markets

---

## Strategy 3: Opening Range Breakout (ORB)

**Source:** Toby Crabel (1990), Mark Fisher "The Logical Trader" (2002). Used by MBF Clearing for 20+ years.

### Why It Works
The first 15 minutes concentrate institutional order flow from overnight decisions. A gap-up with volume that holds its opening range signals genuine accumulation. Buying the breakout above the range captures the continuation move.

### Rules

**Pre-scan (9:48 AM ET):**
1. Get Alpaca movers — stocks gapping up 1-8% (NOT >8%, that's a blow-off)
2. Filter: must be S&P 500 stock OR approved inverse ETF
3. Price $10-$500

**Entry (9:48-10:00 AM ET):**
1. Fetch first 15 minutes of 5-min bars (3 bars = opening range)
2. Calculate Opening Range High and Low
3. If current price > OR High → breakout confirmed → buy
4. Stop at Opening Range Low

**Exit:**
1. Target: entry + 2× risk (risk = entry - OR Low)
2. OR flatten by 11:30 AM ET if no target hit (time stop)
3. OR broker stop at OR Low

**Position Sizing:** $10K per ORB trade, max 2 ORB positions (leaves 3 slots for RSI-2)

### Why Inverse ETFs Qualify for ORB
In a down market, inverse ETFs (SQQQ, TSDD, TSLQ) gap UP. They show the same breakout patterns as regular stocks. The ORB rules apply equally — gap 1-8%, break above opening range, stop at OR low. This is how the system profits from down markets during the morning session.

---

## Strategy 4: Inverse ETF Regime Trade

**Source:** Mebane Faber "The Ivy Portfolio" (2009). SPY below its moving average = bearish regime.

### Why It Works
When SPY is below its 20-day SMA, the market is in a downtrend. Inverse ETFs profit from continued weakness. The SMA crossover is one of the most documented regime filters in quantitative finance.

### Rules

**Entry (checked at 3:50 PM ET):**
1. SPY closing price < 20-day SMA — bearish regime confirmed
2. Not already holding SQQQ or SH
3. Buy SQQQ at market

**Exit:**
1. SPY closes above 20-day SMA — regime flipped bullish → sell
2. OR broker stop at 7% below entry
3. OR held > 5 days (3x ETFs decay — don't hold long)

**Stop:** 7% below entry (wider than RSI-2 because SQQQ is 3x leveraged and volatile)

---

## Daily Schedule

| Time (ET) | Action |
|-----------|--------|
| Sunday 5-11 PM | **Sunday Prep:** Scan Friday RSI-2 data + research catalysts → build Monday watchlist |
| 9:30 AM | Market opens. Engine monitors positions. |
| 9:48 AM | **ORB Scan:** Find S&P 500 + inverse ETF gap-ups that broke opening range. Buy max 2. |
| 9:48-11:30 AM | **ORB Management:** Check targets (2× risk) and time stops every 2 min. |
| 11:30 AM | **ORB Flatten:** Close any ORB trade that didn't hit target. |
| All day | Retrofit stops on unprotected positions. Time stops on positions held 5+ days. Backup stop check (6%+). |
| 3:50 PM | **RSI-2 Scan:** All 498 S&P 500 stocks. Buy oversold longs, short overbought names. |
| 3:50 PM | **Regime Check:** SPY vs 20-day SMA. Buy/sell SQQQ accordingly. |
| 3:55 PM | **Daily Summary:** Record to Trident. |
| 4:00 PM | Market closes. Positions held overnight (RSI-2 holds 2-5 days). |

---

## Risk Management

| Rule | Value | Rationale |
|------|-------|-----------|
| Max positions | 5 | Concentration > diversification |
| Per position | $10K | Equal weight across strategies |
| Stop loss (longs) | 5% below entry | Broker-side, automatic |
| Stop loss (shorts) | 5% above entry | Broker-side, automatic |
| Stop loss (SQQQ) | 7% below entry | Wider for 3x leverage volatility |
| Heartbeat dollar stop | -$100 unrealized | Primary active stop while AWB is awake/running |
| Time stop | 5 trading days | RSI-2 mean reversion should complete by then |
| ORB time stop | 11:30 AM | If no target by then, momentum is dead |
| Broker stop | 5%/7% | Disaster floor, survives process crashes and Mac sleep |
| Circuit breaker | DISABLED | Was blocking all trading for days. Broker stops are sufficient. |

### Protection Stack Notes

The `$100` stop and broker stop are not duplicates:

- The `$100` stop is tighter and requires the AWB heartbeat to be running.
- The broker stop is wider and lives at Alpaca, so it still exists if the Mac sleeps, the gateway crashes, or the engine is stopped.
- Before AWB intentionally closes a position, it cancels matching protective stop orders to avoid Alpaca rejecting the sell because shares are already reserved by a GTC stop.
- When AWB sells half a winner, it resizes the broker stop to the remaining share count.

---

## Data Sources

| Source | What | Frequency |
|--------|------|-----------|
| Alpaca Bars API | Daily bars for RSI(2) + SMA(200) on 498 stocks | Once at 3:50 PM |
| Alpaca Bars API | 5-min bars for ORB opening range | Once at 9:48 AM |
| Alpaca Movers API | Gap-up screener for ORB candidates | Once at 9:48 AM |
| Alpaca Positions API | Current holdings + P&L | Every 2 min |
| Alpaca Orders API | Stop order placement + bracket orders | On buy/sell |
| Yahoo Finance Losers | RSI-2 dip-buy candidates (research tiebreaker) | Every 2 min (research worker) |
| Yahoo Finance Gainers | Momentum context (research worker) | Every 2 min (research worker) |
| Yahoo/CNBC/SA RSS | News catalysts (research worker) | Every 2 min (research worker) |
| Alpaca SPY Bars | Regime detection (SPY vs SMA20) | Once at 3:50 PM |

**Rate limiting:** 10 requests per batch, 500ms between batches. ~50 seconds for full 498-stock scan.

---

## Integration

| System | Role |
|--------|------|
| Trident (Brain MCP) | Records every scan, buy, sell, regime change. Trains SONA on outcomes. Does NOT gate trades. |
| PostgreSQL (research-db) | Stores thesis rows for each entry. Research worker writes catalyst data. |
| SQLite (gateway state store) | Heartbeat status, position snapshots, sell attempts, scan results, stop order tracking. |
| Research Worker | Scans RSS feeds + Yahoo gainers/losers every 2 min. Feeds catalysts as RSI-2 tiebreaker. |
| Ops (Tara) | Monitors system health on 15-second cycle. |
| Discord | Trade notifications, scan results, Sunday prep watchlist. |

---

## What Was Removed and Why

| Removed | Why |
|---------|-----|
| Top movers strategy | 30% win rate across 250 trades. Bought at the top. |
| Premarket momentum buys | Reintroduced top-mover behavior outside the documented strategy. Disabled in 2026-05-06 lockdown. |
| Priority watchlist momentum buys | Bought liquid names merely because they were up intraday. Disabled in 2026-05-06 lockdown. |
| Catalyst buys | Research stars are useful context, but automatic catalyst entries recreated discretionary momentum trading. Disabled in 2026-05-06 lockdown. |
| Morning RSI-2 buys | Connors RSI-2 edge is documented near close, not 10:15 AM. Disabled in 2026-05-06 lockdown. |
| Intraday sector inverse buys | Overlapped with the documented 3:50 PM regime trade and risked whipsaw. Disabled in 2026-05-06 lockdown. |
| Circuit breaker ($1K) | Blocked all trading for days. Broker stops are sufficient. |
| Trident as buy gate | Was blocking good trades. Now observes and learns only. |
| Bayesian intelligence gate | Added complexity, no proven edge. |
| NeuralTrader gate | Redundant with RSI-2 quantitative signals. |
| Exit Analyst trailing tiers | Complex, buggy, sold winners. Simple 5% stop + RSI exit is cleaner. |
| Fin manager (trading) | Was selling positions independently. Only the trade engine trades now. |
| Warren manager | Was writing directives nobody read. Paused. |
| OpenClaw engine | Had nothing to orchestrate with managers paused. |
| EOD sell-all at 3:50 | RSI-2 holds 2-5 days. No blanket liquidation. |

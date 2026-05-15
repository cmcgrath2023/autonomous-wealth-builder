# Autonomous Wealth Builder

Autonomous trading system that finds high-conviction opportunities, executes with discipline, and learns from every outcome. Built on Buffett quality principles with modern market sensing.

**Philosophy:** Buy what you'd hold for 100 years, but trade it with momentum. Concentrate on winners, cut losers fast, earn from both directions.

## How It Works

```
Overnight Research (5 PM → 7 AM)
  ├── Catalyst Hunter scans Alpaca news for earnings beats, upgrades, FDA approvals
  ├── Research Worker reads Yahoo Finance, Bloomberg RSS, Biz Insider movers
  ├── Deep Research pulls analyst targets, insider activity, key financials per ticker
  └── Results written as research stars → ready for morning

Morning Prep (8 AM ET)
  ├── Merges overnight catalysts + research stars + pre-market price snapshots
  ├── Confirms movers are actually moving pre-market
  └── Places market-on-open (opg) orders → fill at 9:30 AM

Market Hours (9:30 AM → 4 PM ET)
  ├── Catalyst buys: high-score research stars moving up (10 AM → 2 PM)
  ├── Catalyst shorts: biggest losers from Biz Insider (10 AM → 2 PM)
  ├── SQQQ auto-hedge: when SPY drops 0.5%+ and core tech is exposed
  ├── Core reinforcement: auto-add to high-scoring core holdings
  ├── $100 heartbeat stop + 5% broker stop on every position
  └── All shorts auto-covered at 3:45 PM — no overnight short exposure

Extended Hours (4 PM → 8 PM / 4 AM → 9:30 AM)
  ├── Catalyst hunter catches earnings beats → immediate limit buy
  └── Gets in before the gap-up at open
```

## Intelligence Stack

### Trident (External Intelligence Platform)
Domain-scoped knowledge that persists across sessions and learns from every trade.

| Domain | What It Stores |
|--------|---------------|
| `trade_outcome` | Every closed trade — ticker, strategy, P&L, holding period |
| `avoid` | Blacklisted tickers (railroads, TTWO, owner preferences) |
| `buffett_core` | Berkshire portfolio quality benchmarks |
| `fundamental_profile` | Deep research scores, analyst targets, insider activity |
| `strategy_knowledge` | Strategy rules, earnings dates, catalyst patterns |
| `autonomous_decision` | Every autonomous buy/sell decision for pattern learning |
| `owner_preference` | Owner directives, sector preferences, risk tolerance |

**SONA** learns from trade outcomes → improves `shouldBuy()` decisions over time.

### Research Team (In-Process)

| Component | Cycle | What It Does |
|-----------|-------|-------------|
| **Research Worker** | 2 min | Biz Insider movers scrape, Yahoo gainers/losers, Bloomberg RSS, Alpaca movers |
| **Research News** | 90 sec | News sentiment, catalyst themes (energy/tech/defense/macro), critical events |
| **Research Quality** | 120 sec | Sector performance tracking, promote/demote based on win rates |
| **Catalyst Hunter** | 6x daily | Alpaca news scan for earnings beats, upgrades, FDA, M&A. Overnight: 5 PM, 10 PM, 7 AM |
| **Deep Research** | Daily 7 AM | Yahoo Finance fundamentals per ticker — analyst targets, insider activity, earnings dates |
| **Momentum Scanner** | 2x daily | Yahoo gainers, Alpaca movers, volume leaders → PostgreSQL + research stars |

### Conviction Pipeline

```
Research Worker finds movers (Biz Insider, Yahoo, Bloomberg)
  → Research stars (SQLite) scored 0.85-0.99
    → Signal scan bridges to PostgreSQL research_signals (every 15 min)
      → Thesis generator clusters signals → conviction score (0-100)
        → Triggered theses (conviction ≥ 65) promoted back to research stars
          → Catalyst buy path executes (score ≥ 0.95, Trident shouldBuy gate)
```

### Bayesian Intelligence
Per-ticker win/loss tracking from closed trades. Adjusts research star scores based on historical performance. Tickers with <40% win rate on 3+ observations get rejected.

## Trading Rules

### Buy Logic
- **Morning prep** at 8 AM: overnight catalysts → `opg` orders at open
- **Catalyst buys** 10 AM - 2 PM: Biz Insider movers + catalyst hunter picks
- **Core reinforcement**: auto-add to NVDA/AMZN when deep research score ≥ 90 and Trident approves
- **No new buys after 2 PM ET** — late entries go red after hours
- **$500 minimum** per position — no 1-share waste
- **Extended hours buying**: earnings beats trigger immediate AH limit orders

### Short Logic
- **Catalyst shorts** 10 AM - 2 PM: Biz Insider biggest losers + bearish catalysts (earnings miss, downgrade, guidance cut)
- **Max 2 shorts** at a time
- **All shorts covered at 3:45 PM** — no overnight short exposure
- **5% buy-stop** on every short position

### Hedge Logic
- **SQQQ auto-hedge**: when SPY drops 0.5%+ intraday and we hold core tech (NVDA/AMZN)
- Auto-sells if SPY flips green +1%

### Protection
- **5% broker-side stop** on every position (placed automatically by heartbeat)
- **$100 heartbeat stop** — active monitoring every 2 minutes
- **Core holdings** (AMZN, NVDA) — engine never auto-sells
- **Watchlist rebuy alerts** — Discord notification when sold stocks hit rebuy target

### Avoid List (Trident `avoid` domain)
- Railroads: UNP, CSX, NSC
- TTWO (moral objection)
- DIS (slow mover)
- Additional tickers added via Discord `!note` or Trident training

## Data Sources

| Source | Method | What It Provides |
|--------|--------|-----------------|
| **Biz Insider** | Scrape (curl) | S&P 500 top gainers + biggest losers, updated every 2 min |
| **Yahoo Finance** | RSS + quoteSummary API | Headlines, gainers/losers screener, analyst targets, financials, insider transactions |
| **Bloomberg** | RSS | Market news headlines |
| **Alpaca News** | REST API | Company-specific news with ticker extraction |
| **Alpaca Market Data** | REST + WebSocket | Real-time quotes, snapshots, historical bars |

## Architecture

Single-process Node.js orchestrator running all components in-process:

```
services/gateway-v2/src/
├── index.ts              # Orchestrator — starts everything, schedules crons
├── trade-engine.ts       # Heartbeat (2 min), buy/sell/short execution, all trading logic
├── research-worker.ts    # 2-min cycle: RSS, Yahoo, Biz Insider, Alpaca movers
├── research-crons.ts     # Knowledge graph refresh, signal scan, thesis resolution
├── brain-client.ts       # Trident API client (shouldBuy, recordTrade, search)
├── trade-recorder.ts     # Alpaca reconciler, closed trade recording
├── config-bus.ts         # Credential loading (Alpaca, OANDA)
├── openclaw.ts           # Position monitoring, drop alerts
├── analysts/
│   ├── catalyst-hunter.ts    # News-driven catalyst detection + AH extended hours buying
│   ├── deep-research.ts      # Yahoo Finance per-ticker fundamentals
│   ├── momentum-scanner.ts   # Yahoo gainers, Alpaca movers, volume leaders
│   ├── macro-analyst.ts      # SPY regime detection (bull/bear/choppy)
│   ├── conviction-scorer.ts  # 7-factor conviction scoring from PG + Bayesian + Trident
│   ├── thesis-generator.ts   # Signal clustering → thesis → research star promotion
│   ├── post-mortem.ts        # Daily loss analysis, rule generation
│   ├── sector-rotator.ts     # 16 sector ETF ranking
│   ├── exit-analyst.ts       # Exit strategy recommendations
│   └── risk-manager.ts       # Pre-trade risk checks
└── managers/
    ├── research-news.ts      # 90-sec news intelligence cycle
    ├── research-quality.ts   # 120-sec sector performance tracking
    └── ops.ts                # SRE monitoring
```

### Data Stores

| Store | Technology | What It Holds |
|-------|-----------|--------------|
| **State Store** | SQLite | Research stars, positions snapshot, scan results, daily keys |
| **Research DB** | PostgreSQL (DO) | Companies, relationships, signals, theses, momentum, fundamentals |
| **Trident** | External API | Domain-scoped memories, SONA patterns, trade history |

## Deployment

### DigitalOcean (Production)
```bash
ssh root@104.236.206.28
cd /opt/awb && git pull --ff-only
docker compose -f deploy/do/docker-compose.build.yml build awb-services
docker compose -f deploy/do/docker-compose.build.yml up -d awb-services
```

### Local Development
```bash
cd services/gateway-v2
npm run build    # TypeScript compile + verify sell paths
npm test         # Run tests
```

## Configuration

| Constant | Value | Purpose |
|----------|-------|---------|
| `BUDGET_MAX` | $70,000 | Total deployed cap (cash, no margin) |
| `PER_POSITION` | $6,000 | Default position size |
| `MAX_POSITIONS` | 8 | Maximum concurrent positions |
| `STOP_PCT` | 5% | Broker-side stop loss |
| `DOLLAR_STOP_LOSS` | $100 | Heartbeat active stop |
| `NEW_BUY_CUTOFF_HOUR` | 14 (2 PM ET) | No new buys after this |
| `HEARTBEAT_MS` | 120,000 | 2-minute monitoring cycle |

## Broker Connections

| Broker | Market | Status |
|--------|--------|--------|
| **Alpaca** (Paper) | US Equities + Extended Hours | Active |
| **OANDA** | Forex (7 pairs) | Configured, not active |
| **Crypto** | BTC, ETH, SOL via Alpaca | Disabled (re-enable when market recovers) |

## Key Lessons Learned

1. **Fix basics before adding features** — budget gate math blocked all buys for days
2. **Concentrate on winners** — NVDA at 175 shares beats 8 positions of random picks
3. **Buy movers at open, not oversold losers at close** — RSI-2 consistently lost money
4. **Research must trigger trades** — finding CSCO +15% means nothing if budget blocks the buy
5. **Hedge red days** — SQQQ auto-buy when SPY drops and core tech is exposed
6. **Short the losers early** — not at 2 PM after they've already bottomed
7. **Extended hours = edge** — earnings beats at 5 PM, buy before the gap-up
8. **WWBD (What Would Buffett Do)** — on every trade, both directions

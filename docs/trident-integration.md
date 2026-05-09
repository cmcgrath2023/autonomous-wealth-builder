# AWB ↔ Trident Integration Architecture

**Last Updated:** 2026-05-09

## Overview

AWB uses [Trident](https://trident.cetaceanlabs.com) as its external intelligence platform. Trident provides three complementary learning systems (SONA, NOVA, FACT) powered by RuvLLM under the hood. AWB consumes Trident via REST API only — no direct RuvLLM dependency.

```
AWB (trade engine, research worker, Ops)
  │
  ├── POST /v1/train          → SONA training (trade outcomes, preferences)
  ├── POST /v1/memories        → Memory storage (trade records, catalysts, alerts)
  ├── GET  /v1/memories/search → Decision queries (shouldBuy, ticker history)
  ├── POST /v1/nova/train      → NOVA reinforcement (daily summaries)
  ├── GET  /v1/nova/gaps       → Knowledge gap detection
  ├── GET  /v1/nova/stats      → Learning metrics
  └── GET  /v1/health          → System health check
```

## Data Flow

### 1. Before Every Buy: SONA Check
```
Engine calls brain.shouldBuy(ticker)
  → Searches Trident for "ticker avoid/blacklist" memories
  → If found: BLOCK (e.g., DIS → "SONA flag — AVOID: owner blacklist")
  → If not: Check WIN/LOSS trade history
  → If bad track record (0W/2L+, <35% win rate): BLOCK
  → Otherwise: ALLOW
```

### 2. Every Trade Close: SONA Training
```
recordClosedTrade() fires
  → brain.recordTradeClose() stores WIN/LOSS memory
  → POST /v1/train sends outcome to SONA
  → SONA updates per-ticker, per-strategy patterns
```

### 3. Daily Summary (3:55 PM ET): SONA + NOVA
```
SONA: "Daily summary: $1400 P&L, 5W/1L, best: NVDA, worst: COP"
NOVA: POST /v1/nova/train with daily outcome
NOVA: GET /v1/nova/gaps to identify knowledge deficiencies
```

### 4. Research Worker (every 2 min): Catalyst Recording
```
Research worker scans RSS feeds
  → Finds high-score catalysts (>= 0.95)
  → brain.recordRule() stores each to Trident
  → brain.recordResearchCycle() stores cycle summary
```

### 5. Daily Mover Capture (3:55 PM ET): Market Data
```
Engine fetches S&P 500 snapshots
  → Top 14 winners + 14 losers
  → POST /v1/train with mover data for pattern learning
  → Stored in SQLite for historical analytics
```

### 6. OpenClaw Position Intelligence (every 60s)
```
Position drops 2%+
  → Search Yahoo for news on that ticker
  → Post alert to Discord
  → Record to Trident: "POSITION ALERT: NVDA down 4.3% — AMZN chip threat"
```

### 7. Owner Notes (Discord !note)
```
Owner types: !note MCHP was our best RSI-2 pick
  → Stored as Trident memory with ticker tag
  → SONA learns from owner context
```

## SONA Data Categories

| Category | Example | Used By |
|----------|---------|---------|
| `buffett_core` | AAPL: largest Berkshire holding | shouldBuy() priority |
| `buffett_key` | OXY: significant energy position | shouldBuy() priority |
| `owner_preference` | Owner buys strong momentum stocks | Strategy selection |
| `avoid` / `blacklist` | DIS: slow mover, do not buy | shouldBuy() block |
| `trade_outcome` | MCHP: +$1100, RSI-2 pick, 4-day hold | Per-ticker learning |
| `daily_learning` | 2026-05-08: +$1400, datacenter picks | Day pattern learning |
| `market_data` | S&P 500 movers 2026-05-08 | Predictive analytics |
| `strategy_knowledge` | RSI-2: buy when RSI(2)<10, above SMA200 | Strategy reference |
| `lesson_loss` | Buying top movers had 30% win rate | Anti-pattern detection |
| `sector_knowledge` | AI/Datacenter leaders: NVDA, MSFT, AMZN | Sector identification |

## Authentication

- **API Key:** `BRAIN_API_KEY` env var (loaded from `gateway/.env.local`)
- **MCP Key:** Separate SSE client key for Claude Code integration
- **Endpoint:** `https://trident.cetaceanlabs.com`
- **Tools:** 44 (includes SONA, NOVA, FACT, memory, search)

## Graceful Degradation

If Trident is unavailable:
- `shouldBuy()` catches the error and proceeds without the SONA check
- Trade recording fails silently (fire-and-forget)
- NOVA training skipped
- Engine continues trading based on RSI-2/ORB rules alone
- No hard gate — Trident enhances but doesn't block core trading

## Future: NOVA + FACT + RuvLLM

- **NOVA:** 15-min learning cycles running inside Trident. Reinforces winning patterns overnight.
- **FACT:** Memory-first cache. 90% of shouldBuy() decisions answered without hitting a model.
- **RuvLLM:** Powers SONA/NOVA/FACT backend. HNSW routing, micro-LoRA adapters. AWB benefits transparently.

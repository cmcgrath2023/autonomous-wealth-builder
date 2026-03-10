# SPEC-001: Autonomous Trading System

## Summary
Fully autonomous 24/7 trading system targeting $500-$5000/day income through high-volatility crypto and momentum equity positions.

## Requirements

### R1: Asset Selection Strategy
- **Crypto focus** (24/7 trading): BTC, ETH, SOL, AVAX, LINK, DOGE
- **High-beta equities**: TSLA, NVDA, AMD, COIN, MARA, RIOT, PLTR, SOFI
- Selection criteria: daily volatility >2%, sufficient liquidity, momentum characteristics
- Dynamic watchlist: add/remove based on 30-day volatility screening

### R2: Signal Generation (Neural Trader)
- Technical indicators: RSI, MACD, Bollinger Bands, EMA crossovers
- Minimum 30 data points for signal generation (auto-bootstrap from historical)
- Confidence scoring: 0.3+ threshold for entry, 0.5+ for larger positions
- Pattern recognition: oversold, MACD crossover, BB lower touch, composite
- Time-weighted signal decay: signals lose confidence over time if not acted on

### R3: Position Sizing (MinCut + Kelly)
- Base position: $2,000 per signal
- Confidence scaling: $2K + ($3K × confidence) = $2K-$5K per position
- Kelly criterion: adjust based on win rate and avg win/loss from trait engine
- Maximum 15% portfolio in any single asset
- Deploy 50-70% of capital across 10-15 positions
- 15% cash reserve always maintained

### R4: Execution
- Alpaca paper trading (paper-api.alpaca.markets)
- Crypto: fractional quantities, GTC time-in-force
- Stocks: whole shares, DAY time-in-force
- Market orders for immediate execution
- Wash trade detection: skip opposing orders on same ticker within session

### R5: Autonomy Levels (OpenClaw Heartbeat)
- **Observe**: Monitor only, log signals
- **Suggest**: Generate signals, queue for approval
- **Act**: Execute within Authority Matrix thresholds
- Heartbeat interval: 5 minutes (configurable 1min-1hr)
- Night mode: optional reduced activity 10pm-7am

### R6: Income Targets
| Phase | Daily Target | Monthly | Annual | Capital Required |
|-------|-------------|---------|--------|-----------------|
| 1 | $500 | $15K | $180K | $100K (0.5%/day) |
| 2 | $1,000 | $30K | $360K | $100K (1%/day) |
| 3 | $5,000 | $150K | $1.8M | Reinvested profits |

### R7: Risk Controls
- Maximum daily loss: 2% of portfolio
- Maximum drawdown: 10% from peak
- Stop-loss: 5% per position
- Sector concentration limit: 30%
- Daily volume cap: $25,000 (auto, scaling up with success)

## Technical Plan

### Services Modified
- `midstream/src/index.ts` — Updated watchlist for high-volatility assets
- `neural-trader/src/index.ts` — Enhanced signal generation with volatility weighting
- `neural-trader/src/executor.ts` — Crypto-compatible order submission
- `authority-matrix/src/index.ts` — Raised autonomous thresholds for paper phase
- `gateway/src/server.ts` — Auto-bootstrap, autonomy engine integration
- `gateway/src/autonomy-engine.ts` — Heartbeat-driven execution

### Dependencies
- `sublinear-time-solver` — Optimization for batch signal scoring
- Alpaca Markets API — Broker execution

## Tasks
- [x] Bootstrap historical data on startup
- [x] Update watchlist to high-volatility assets
- [x] Scale position sizing for income targets
- [x] Enable autonomous execution via heartbeat
- [ ] Add stop-loss and take-profit logic
- [ ] Implement volatility-weighted signal scoring
- [ ] Add trailing stop for winning positions
- [ ] Wire Bayesian trait engine for live outcome tracking
- [ ] Implement max daily loss circuit breaker
- [ ] Add portfolio rebalancing on each heartbeat

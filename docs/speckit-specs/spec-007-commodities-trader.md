# SPEC-007: CommoditiesTrader — Agricultural + Energy

## Summary
Trade agricultural, livestock, and energy commodities using spread strategies, seasonal patterns, and Neural Trader integration. Covers 11 contracts across livestock (LE, HE, GF), grains (ZC, ZS, ZW), energy (CL, NG), and metals (HG, GC, SI).

## Requirements

### R1: Commodity Contract Definitions
- 11 contracts with exchange, category, contract size, tick size/value, margin requirements
- Categories: livestock, grains, softs, energy, metals
- Exchanges: CME, CBOT, COMEX, NYMEX
- Track open interest alongside price data

### R2: Price Data Feed
- commodities-api.com API for real-time/delayed quotes
- OHLCV + open interest per contract
- Heartbeat-driven fetch cycle (5-minute default)

### R3: Spread Strategies
- **Cattle-Corn Spread**: Monitor cattle/corn price ratio. Buy cattle when ratio < 22 (historical mean 25-30), confidence 0.7. Margin compression reversion play.
- **Hog Seasonal**: Buy hogs in September, sell February. Winter demand cycle. 5% stop-loss, 12% target, confidence 0.65.
- Track spread P&L as `SpreadPosition` with long/short legs and ratio

### R4: Neural Trader Delegation
- Emit `analyzeRequest` events to Neural Trader for RSI/MACD/Bollinger technical analysis
- Neural Trader returns signals that CommoditiesTrader evaluates within commodity-specific context

### R5: Position Sizing
- Max 5% portfolio per commodity position
- Half-Kelly fraction for sizing
- Margin-aware contract count calculation
- Margins range $1,200 (Corn) to $9,000 (Gold)

### R6: OpenClaw Integration
- Register as OpenClaw agent with `suggest` autonomy level
- 5-minute heartbeat interval
- Signals go to pendingApproval queue (suggest mode) or auto-execute (act mode)

## Technical Plan

### New Files
- `services/commodities-trader/src/index.ts` — Main service class
- `services/commodities-trader/src/types.ts` — CommodityContract, CommodityQuote, CommoditySignal, SpreadPosition
- `services/commodities-trader/src/spreads.ts` — Spread strategy implementations

### Dependencies
- commodities-api.com (requires API key: `COMMODITIES_API_KEY`)
- Neural Trader (event delegation for technical analysis)
- MinCut (position sizing)

## Tasks
- [ ] Create commodities-trader service directory and scaffold
- [ ] Define all 11 commodity contracts with full metadata
- [ ] Implement commodities-api.com quote fetching
- [ ] Implement cattle-corn spread evaluation logic
- [ ] Implement hog seasonal evaluation logic
- [ ] Implement half-Kelly position sizing with margin awareness
- [ ] Wire Neural Trader delegation for technical signals
- [ ] Wire into OpenClaw heartbeat system
- [ ] Add gateway routes: GET /commodities/contracts, POST /commodities/spread/evaluate, POST /commodities/seasonal/evaluate
- [ ] Create UI page: commodities with contract list, spread monitor, seasonal calendar

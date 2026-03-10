# SPEC-011: MetalsTrader — Precious Metals

## Summary
Trade gold, silver, platinum, and palladium as both hedge and momentum plays. Gold momentum via EMA crossovers, silver volatility via RSI + Bollinger mean reversion, auto-hedge when VIX spikes. Micro gold futures (MGC) for capital-efficient exposure.

## Requirements

### R1: Price Data
- APIs: metals-api.com or goldapi.io for spot prices
- Track GC (gold), SI (silver), PL (platinum), PA (palladium) futures
- ETF proxies: GLD, SLV, PPLT for stock-account exposure
- Micro gold futures (MGC) via IBKR when available

### R2: Gold Momentum Strategy
- EMA 20/50 crossover system — ride the trend
- Entry on golden cross (20 > 50), exit on death cross
- Confidence: 0.7 on crossover, decay over time if no follow-through

### R3: Silver Volatility Strategy
- RSI + Bollinger Band mean reversion — silver moves faster than gold
- Entry: RSI < 30 + price touches lower Bollinger Band
- Exit: RSI > 70 or price touches upper Bollinger Band
- Confidence: 0.65

### R4: VIX Hedge Auto-Trigger
- Auto-add gold when VIX > 25 or SPY down > 3% intraday
- Hedge position sized at 5-10% of portfolio
- Reduces to normal sizing when VIX normalizes below 20

### R5: OpenClaw Integration
- Register as OpenClaw agent
- Initial autonomy level: `suggest`
- Heartbeat: 5 minutes

## Technical Plan

### New Files
- `services/metals-trader/src/index.ts` — Main service class
- `services/metals-trader/src/types.ts` — MetalQuote, MetalSignal interfaces

### Dependencies
- metals-api.com or goldapi.io (API key required)
- VIX data from MidStream
- IBKR (optional, for micro futures)

## Tasks
- [ ] Create metals-trader service directory and scaffold
- [ ] Implement metals API quote fetching
- [ ] Implement gold EMA 20/50 crossover strategy
- [ ] Implement silver RSI + Bollinger mean reversion strategy
- [ ] Implement VIX hedge auto-trigger
- [ ] Wire into OpenClaw heartbeat system
- [ ] Add gateway routes for metals quotes and signals
- [ ] Test crossover detection accuracy

# SPEC-012: ForexScanner — Currency Pairs

## Summary
Access the $7.5T daily forex market with major pairs, carry trades, and news-driven plays. Session momentum strategy rides London/NY open volatility. Carry trades on interest rate differentials. OANDA or Interactive Brokers for execution.

## Requirements

### R1: Currency Pairs
- **Majors**: EUR/USD, GBP/USD, USD/JPY
- **Carry trades**: AUD/JPY, NZD/JPY (long high-yield, short low-yield)
- **Crosses**: EUR/GBP, AUD/NZD (correlation pairs)

### R2: Session Momentum Strategy
- Ride London open (08:00 UTC) and NY open (14:30 UTC) volatility spikes
- Entry: breakout from Asian session range on London open
- Confidence: 0.65, higher during London/NY overlap (14:30-16:30 UTC)

### R3: Carry Trade Strategy
- Long high-yield currencies (AUD, NZD), short low-yield (JPY, CHF)
- Hold for interest rate differential (swap income)
- Exit on central bank rate change or trend reversal
- Confidence: 0.6 (slow, steady returns)

### R4: News Plays
- NFP (Non-Farm Payrolls), FOMC, ECB decisions
- Pre-position or fade the spike
- Reduced position size for news events (high volatility)

### R5: Broker Integration
- OANDA API (primary): `OANDA_API_KEY`, `OANDA_ACCOUNT_ID`
- Interactive Brokers (alternative)
- Paper trading mode first

### R6: OpenClaw Integration
- Register as OpenClaw agent
- Initial autonomy level: `observe`
- Heartbeat: 2 minutes (forex moves fast)

## Technical Plan

### New Files
- `services/forex-scanner/src/index.ts` — Main service class
- `services/forex-scanner/src/types.ts` — ForexPair, ForexQuote, ForexSignal interfaces

### Dependencies
- OANDA API or IBKR
- Economic calendar data source for news events

## Tasks
- [ ] Create forex-scanner service directory and scaffold
- [ ] Implement OANDA API quote fetching
- [ ] Implement session momentum strategy (London/NY open)
- [ ] Implement carry trade monitoring
- [ ] Implement economic event calendar integration
- [ ] Wire into OpenClaw heartbeat system
- [ ] Add gateway routes for forex quotes and signals
- [ ] Test session boundary detection

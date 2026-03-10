# SPEC-006: GlobalStream — International Market Data

## Summary
24/7 global market data coverage across Sydney, Tokyo, Hong Kong, London, Frankfurt, New York, and crypto sessions. Extends the existing MidStream pattern for international instruments via Yahoo Finance and Alpaca APIs.

## Requirements

### R1: Market Session Detection
- Track 7 global sessions with UTC open/close windows
- Determine active sessions in real-time (handles midnight crossover)
- Sydney/Tokyo (00:00-06:00), Hong Kong (01:30-08:00), London (08:00-16:30), Frankfurt (07:00-15:30), NY (14:30-21:00), Crypto (24/7)
- Report next open/close for each session

### R2: Multi-Source Quote Fetching
- Yahoo Finance API (`query1.finance.yahoo.com/v8/finance/chart/`) for international instruments
- Alpaca delegation for US-listed ETFs and crypto (via existing MidStream)
- IBKR integration (optional future, flagged but not required for v1)
- ETFs per session: EWA/AUDUSD/FXA (Sydney), EWJ/USDJPY/NKY (Tokyo), EWH/FXI (HK), EWU/GBPUSD (London), EWG/EURUSD (Frankfurt), SPY/QQQ/DIA (NY), BTC/ETH/SOL (Crypto)

### R3: Polling & Event Emission
- Configurable heartbeat interval (default 60s)
- Emit `quote` events with GlobalQuote data (symbol, session, price, change, volume, timestamp)
- Emit `heartbeat` events for OpenClaw integration
- Emit `delegate` events to MidStream for Alpaca-compatible symbols

### R4: OpenClaw Integration
- Register as OpenClaw agent with `observe` autonomy level (read-only initially)
- 1-minute heartbeat interval (slows to 5min in night mode)
- Progression: observe → suggest → act as confidence builds

## Technical Plan

### New Files
- `services/globalstream/src/index.ts` — Main service class
- `services/globalstream/src/types.ts` — MarketSession, GlobalQuote, GlobalStreamConfig interfaces

### Dependencies
- Yahoo Finance API (free tier, no key required)
- Existing MidStream service (event delegation)

## Tasks
- [ ] Create globalstream service directory and scaffold
- [ ] Implement MarketSession definitions for all 7 sessions
- [ ] Implement `getActiveSessions()` with UTC time comparison
- [ ] Implement `fetchYahooQuotes()` for international instruments
- [ ] Implement polling loop with configurable heartbeat
- [ ] Wire into OpenClaw heartbeat system
- [ ] Add gateway routes: GET /global/sessions, /global/quotes, /global/quote/:symbol
- [ ] Create UI page: global markets with session timeline
- [ ] Test session detection across timezone boundaries

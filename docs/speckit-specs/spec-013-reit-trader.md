# SPEC-013: REITTrader — Liquid Real Estate

## Summary
Liquid real estate exposure through REIT trading while hunting physical Nothing Down deals. Data center REITs (AI infrastructure), industrial, residential, and healthcare sectors. Strategies: dividend capture, sector rotation, discount-to-NAV.

## Requirements

### R1: REIT Universe
- **Data Centers**: EQIX, DLR — AI infrastructure play
- **Industrial**: PLD, STAG — E-commerce logistics
- **Residential**: AVB, EQR — Allen knowledge applies
- **Healthcare**: WELL, VTR — Aging population tailwind
- Track NAV, dividend yield, FFO, payout ratio per REIT

### R2: Dividend Capture Strategy
- Buy before ex-dividend date, sell after
- Target REITs with > 4% annual yield
- Time entry 2-3 days before ex-div, exit 1-2 days after

### R3: Sector Rotation Strategy
- Data centers during AI hype cycles (track NVDA, AMD momentum as proxy)
- Residential during housing boom (track existing RE market signals)
- Healthcare as defensive play during market uncertainty
- Rotate based on macro regime signals

### R4: Discount-to-NAV Strategy
- Buy REITs trading below Net Asset Value
- Target: > 10% discount to NAV
- Confidence: 0.7 (mean reversion to NAV is strong historical pattern)

### R5: Phase Allocation (REIT → Physical RE Transition)
- Building Capital: 100% REITs
- First Deal Hunt: 70% REITs / 30% Physical
- Portfolio Growth: 40% REITs / 60% Physical
- Financial Fortress: 25% REITs / 75% Physical

### R6: OpenClaw Integration
- Register as OpenClaw agent
- Initial autonomy level: `suggest`
- Heartbeat: 10 minutes

## Technical Plan

### New Files
- `services/reit-trader/src/index.ts` — Main service class
- `services/reit-trader/src/types.ts` — REITAsset, REITSignal, DividendCalendar interfaces

### Dependencies
- Alpaca Markets API (for REIT stock trading)
- Dividend calendar data source
- NAV data source (REIT/BASE or RapidAPI)

## Tasks
- [ ] Create reit-trader service directory and scaffold
- [ ] Define REIT universe with sector categorization
- [ ] Implement dividend capture strategy with ex-div calendar
- [ ] Implement sector rotation logic
- [ ] Implement discount-to-NAV detection
- [ ] Implement phase allocation calculator (REIT vs physical)
- [ ] Wire into OpenClaw heartbeat system
- [ ] Add gateway routes for REIT positions and signals
- [ ] Link to existing RE pipeline for cross-asset awareness

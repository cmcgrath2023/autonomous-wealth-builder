# SPEC-014: OptionsTrader — Leverage Without Margin Risk

## Summary
Defined-risk options strategies for income generation and directional leverage. Cash-secured puts, covered calls, protective puts, and vertical spreads. 45 DTE max, IV rank filtering, Greeks calculation.

## Requirements

### R1: Income Strategies
- **Cash-Secured Puts**: Get paid to wait for stocks at a discount. Sell puts on stocks you want to own.
- **Covered Calls**: Extract income from winning positions. Sell calls against existing holdings.
- Target: 1-2% monthly premium income on capital deployed

### R2: Directional Strategies
- **Long Calls/Puts**: 10-20x leverage with defined max loss
- **Vertical Spreads**: Reduce cost basis with capped upside/downside
- Only on high-conviction Neural Trader signals (confidence > 0.7)

### R3: Hedging
- **Protective Puts**: Portfolio insurance during uncertainty (VIX > 25)
- **Collars**: Zero-cost hedging by selling covered call + buying protective put
- Auto-trigger when portfolio drawdown > 5%

### R4: Risk Controls
- Defined risk only — no naked short options (Authority Matrix enforced)
- Max 45 DTE (days to expiration)
- IV rank filter: only sell premium when IV rank > 50%
- Greeks: Delta, Gamma, Theta, Vega calculated for all positions
- Max 25% of portfolio in options positions

### R5: Broker Integration
- Evaluate Alpaca options API availability
- IBKR as fallback for full options chain access
- Paper trading mode first

### R6: OpenClaw Integration
- Register as OpenClaw agent
- Initial autonomy level: `suggest` (income strategies), `observe` (directional)
- Heartbeat: 10 minutes

## Technical Plan

### New Files
- `services/options-trader/src/index.ts` — Main service class
- `services/options-trader/src/types.ts` — OptionContract, OptionSignal, Greeks interfaces
- `services/options-trader/src/greeks.ts` — Black-Scholes Greeks calculator

### Dependencies
- Options chain data (Alpaca or IBKR)
- VIX data from MidStream
- Neural Trader (for directional conviction signals)

## Tasks
- [ ] Create options-trader service directory and scaffold
- [ ] Implement Black-Scholes Greeks calculator
- [ ] Implement cash-secured put strategy
- [ ] Implement covered call strategy
- [ ] Implement protective put and collar hedging
- [ ] Implement IV rank filter
- [ ] Implement 45 DTE constraint
- [ ] Wire into OpenClaw heartbeat system
- [ ] Add gateway routes for options positions and signals
- [ ] Evaluate Alpaca options API vs IBKR

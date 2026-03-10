# SPEC-010: Authority Matrix Expansion — New Asset Classes

## Summary
Extend the Authority Matrix with rules for commodity futures, forex, options, and sector allocation limits for the expansion services.

## Requirements

### R1: Commodity Futures Rules
- Single trade: autonomous up to $5K, notify up to $25K, approve above
- Spread trade: autonomous up to $10K, notify up to $50K, approve above
- Physical delivery: always requires human approval (never autonomous)
- Conditions: `market_hours_only`, `position_limit_check`

### R2: Forex Rules
- Single trade: autonomous up to $10K, notify up to $50K, approve above
- Carry trade: autonomous up to $5K, notify up to $25K, approve above

### R3: Options Rules
- Covered calls: autonomous up to $5K, notify up to $25K, approve above
- Cash-secured puts: autonomous up to $5K, notify up to $25K, approve above
- Naked short options: always requires human approval (never autonomous)

### R4: Sector Allocation Limits
- Commodity allocation: autonomous up to 15%, notify up to 20%, approve above 25%
- Datacenter infra allocation: autonomous up to 20%, notify up to 25%, approve above 30%
- Both use percentage-of-portfolio thresholds (values < 1.0)

### R5: Authority Check Function
- `checkAuthority(assetClass, action, value, portfolioValue)` returns `'autonomous' | 'notify' | 'approve'`
- Handle both absolute dollar thresholds and percentage-based portfolio thresholds
- Default to `'approve'` for unknown asset class/action combinations

## Technical Plan

### New Files
- `services/authority-matrix/src/expansion-rules.ts` — AuthorityRule interface and rule definitions

### Modified Files
- `services/authority-matrix/src/index.ts` — Import and apply expansion rules

## Tasks
- [ ] Define AuthorityRule interface with asset class, action, thresholds, conditions
- [ ] Implement all commodity futures rules
- [ ] Implement forex rules
- [ ] Implement options rules
- [ ] Implement sector allocation limits
- [ ] Implement `checkAuthority()` with dollar and percentage threshold support
- [ ] Wire into existing Authority Matrix
- [ ] Test threshold edge cases (exactly at boundary values)

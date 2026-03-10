# SPEC-005: Small Capital Growth Strategy ($5K → $15K in 90 Days)

## Summary
Strategy optimized for $5,000 starting capital, targeting 3x growth (200% return) in 90 days.
That's ~1.2% daily compound return. Aggressive but achievable with crypto volatility.

## Capital Deployment Plan

### Phase 1: Weeks 1-4 ($5K → $7.5K)
- **Focus**: Crypto only (24/7 markets, highest volatility)
- **Position size**: $500-$1,000 per position (10-20% of capital)
- **Max positions**: 5 concurrent
- **Target**: 1% daily compound = 35% monthly
- **Style**: Momentum + RSI oversold entries, quick take-profit at 3-5%

### Phase 2: Weeks 5-8 ($7.5K → $11K)
- **Add**: Penny stocks / high-beta micro-caps during market hours
- **Position size**: $750-$1,500 per position
- **Max positions**: 7 concurrent
- **Target**: 1% daily compound
- **Style**: Crypto swing + equity momentum scalps

### Phase 3: Weeks 9-12 ($11K → $15K+)
- **Full allocation**: Crypto + equities + options (if available)
- **Position size**: $1,000-$2,000 per position
- **Max positions**: 10 concurrent
- **Target**: 0.8% daily (more conservative as capital grows)
- **Begin**: Setting aside RE fund from profits

## Why Crypto is Optimal for $5K

1. **24/7 markets** — No waiting for NYSE open. Compound 7 days/week.
2. **Fractional trading** — Buy $500 of BTC, not a whole coin
3. **Higher volatility** — 3-8% daily moves = more opportunities
4. **No PDT rule** — No pattern day trader restrictions under $25K
5. **Lower fees** — No commissions on Alpaca crypto
6. **Altcoin opportunities** — SOL, AVAX, LINK, DOGE have 5-15% daily swings

## Key Metrics for $5K Account

| Metric | Value | Rationale |
|--------|-------|-----------|
| Max position | $1,000 (20%) | Prevent catastrophic single-loss |
| Stop-loss | 5% per trade | Max loss = $50 per position |
| Take-profit | 3-5% per trade | Target 1.5:1 reward/risk |
| Daily target | $60 (1.2%) | Compounds to 3x in 90 days |
| Win rate needed | 60% | At 1.5:1 R:R, 60% wins = profitable |
| Max daily loss | 3% ($150) | Circuit breaker |
| Cash reserve | 20% ($1,000) | Always keep dry powder |

## Position Sizing Formula (for $5K)

```
positionSize = min(
  capital * 0.20,                    // Max 20% per position
  baseSize * (1 + confidence),       // Scale with signal confidence
  capital - cashReserve              // Never dip below reserve
)

where baseSize = capital * 0.10      // 10% base allocation
```

## What the Paper Trading Phase Proves

The $100K paper account validates:
1. Signal accuracy (win rate) → need >55% over 100 trades
2. Average win vs average loss → need >1.3 ratio
3. Best-performing assets → which crypto consistently signals
4. Optimal heartbeat interval → is 5min, 15min, or 30min best?
5. Strategy drift → does SAFLA detect degradation?

Once paper proves consistent profitability, we deploy $5K real capital with the proven strategy.

## Tasks
- [x] Paper trade with $100K to validate signals
- [ ] Track per-asset win rate in Trait Engine
- [ ] Implement stop-loss and take-profit logic
- [ ] Add max daily loss circuit breaker
- [ ] Create $5K position sizing mode
- [ ] Build profitability proof dashboard (100-trade track record)
- [ ] Implement paper→real transition checklist

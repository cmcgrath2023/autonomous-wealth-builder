# ADR-030: Trident as Decision Gate (Not Just Recorder)

**Status:** ACTIVE
**Date:** 2026-05-08
**Context:** Trident (SONA + NOVA + FACT) was recording trade outcomes and owner preferences but not influencing buy/sell decisions. DIS was bought despite being flagged as "avoid." The system was a diary, not a brain.

## Decision

Trident is a mandatory decision gate:
1. `shouldBuy()` queries SONA avoid flags BEFORE checking trade history
2. Owner preferences (blacklist, sector bias) stored as searchable memories
3. Every trade close trains SONA (via recordClosedTrade)
4. Daily summary trains NOVA (via /v1/nova/train)
5. Research worker records high-value catalysts to Trident
6. If Trident is unavailable, engine proceeds without (graceful degradation, not a hard gate)

## SONA Data Categories

- `buffett_core` — Berkshire core holdings (AAPL, AXP, BAC, KO, CVX)
- `buffett_key` — Key investments (MCO, OXY, COF, GOOGL, KR)
- `owner_preference` — Sector biases, risk tolerance, trading style
- `avoid` / `blacklist` — Tickers to never buy (DIS, etc.)
- `trade_outcome` — Win/loss per ticker/strategy
- `daily_learning` — Daily P&L patterns
- `market_data` — S&P 500 daily mover snapshots

## Consequences

- **Positive:** System learns from owner and improves over time
- **Positive:** DIS-type mistakes prevented automatically
- **Positive:** Buffett quality stocks get priority
- **Negative:** Adds ~200ms latency per buy (Trident API call)
- **Negative:** If SONA has bad data, it could block good trades (mitigated by graceful fallback)

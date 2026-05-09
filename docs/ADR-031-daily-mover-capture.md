# ADR-031: Daily S&P 500 Mover Capture for Predictive Analytics

**Status:** ACTIVE
**Date:** 2026-05-08
**Context:** Owner identified that scanning S&P 500 top movers (Business Insider list) and buying leaders produces consistent gains. Historical mover data would enable pattern detection and prediction.

## Decision

Capture top 14 S&P 500 winners and losers daily at 3:55 PM ET:
1. Fetch snapshots for top 150 S&P 500 stocks
2. Calculate day % change from previous close
3. Store top 14 winners + 14 losers to SQLite (`daily_movers_{date}`)
4. Record to Trident SONA for pattern training
5. Post to Discord for owner visibility

## Future Analytics (Sprint 2+)

With accumulated daily data:
- **Repeat mover frequency** — "NVDA was top 10 mover 15 of last 20 days"
- **Sector correlation** — "when energy moves, defense moves 70% of the time"
- **Multi-day momentum** — "stocks that are top movers 3 days in a row continue 60% of the time"
- **Reversal prediction** — "stocks in losers list for 2 days bounce on day 3"
- **Sector rotation** — which sectors lead/lag in current regime

## Data Format

```json
{
  "date": "2026-05-08",
  "winners": [
    { "symbol": "NVDA", "pct": 5.2, "price": 211.03 },
    ...
  ],
  "losers": [
    { "symbol": "COP", "pct": -3.1, "price": 114.15 },
    ...
  ]
}
```

## Consequences

- **Positive:** Builds foundation for predictive analytics
- **Positive:** Owner can review daily movers via Discord
- **Positive:** SONA learns sector/stock patterns over time
- **Negative:** 150-stock snapshot fetch adds ~2s to 3:55 PM heartbeat
- **Negative:** Predictive value requires weeks of accumulated data

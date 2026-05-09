# ADR-029: Buffett Quality Filter as Primary Investment Framework

**Status:** ACTIVE
**Date:** 2026-05-08
**Context:** RSI-2 mean reversion bought beaten-down stocks hoping for a bounce. Win rate was reasonable but gains were modest. Owner's manual picks using Buffett quality + momentum approach produced $1,400 days.

## Decision

Primary stock selection uses the Warren Buffett playbook:
1. **Quality first** — moats, cash flow, management, proven business
2. **Momentum timing** — buy quality stocks that are already moving up
3. **S&P 500 only** — no speculative small caps
4. **Concentrated positions** — fewer, bigger bets on highest conviction

RSI-2 becomes a secondary timing signal: "this Buffett-quality stock is temporarily oversold = strong buy."

## What This Means in Code

- `shouldBuy()` checks Trident SONA for Buffett quality data and owner preferences
- Berkshire Hathaway portfolio tickers (AAPL, AXP, BAC, KO, CVX, MCO, OXY, COF, GOOGL, KR) get priority
- DIS and other owner-blacklisted tickers are blocked via SONA avoid flags
- Research worker surfaces earnings beats, analyst upgrades, revenue growth — not just RSI numbers

## Consequences

- **Positive:** Aligned with owner's proven approach ($1K+ days)
- **Positive:** Higher conviction per trade, less churn
- **Negative:** Fewer trades per day (concentration vs diversification)
- **Negative:** May miss momentum in non-Buffett sectors

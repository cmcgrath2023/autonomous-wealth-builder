# Pattern: NVDA Leader Reversion Miss - 2026-05-06

## Status

Candidate pattern. User-observed and should be verified against Alpaca historical bars before being promoted into code.

## Observation

Late in the prior week, NVDA was available near a favorable entry level according to the user's review. By 2026-05-06, the move had reportedly produced an 11.9% opportunity. This is the type of missed setup AWB needs to capture and replay.

The important lesson is not simply "buy NVDA." The lesson is that a mega-cap S&P 500 leader can produce an actionable reversion setup when it pulls back into a still-valid uptrend and then rebounds sharply.

## Candidate Pattern

Leader reversion inside an intact trend:

- Ticker is a highly liquid S&P 500 leader.
- Price remains above the 200-day SMA, or the long-term trend is otherwise intact.
- RSI-2 signals short-term oversold exhaustion.
- The broader market or sector is not in confirmed breakdown.
- Entry occurs near the close, consistent with RSI-2 discipline.
- Position is held through the expected 2-5 day reversion window unless RSI exit, time stop, or broker stop triggers.

## Why AWB Missed It

The likely failure was operational, not conceptual:

- Strategy authority had drifted across too many entry and exit paths.
- Duplicate engine processes created unreliable action history.
- Long/short classification bugs made exit decisions untrustworthy.
- The system did not maintain a clean missed-opportunity ledger for high-quality names that met or nearly met RSI-2 criteria.

## What Should Catch This Next Time

AWB should maintain a "leader reversion watchlist" derived from the S&P 500 universe, not from raw momentum movers. Candidates should be ranked, not automatically bought, when they show:

- RSI-2 below the entry threshold or within a narrow near-miss band.
- Price above SMA200.
- High liquidity.
- Large-cap/mega-cap leadership.
- Sector strength or market regime support.
- No unresolved stop or duplicate-process risk.

The trade engine should only buy if the documented RSI-2 or ORB rules fire. The watchlist exists to make the missed pattern visible and to feed Trident memory, not to introduce a new discretionary buy path.

## Validation Needed

Before this becomes automated:

- Pull NVDA daily bars for the relevant prior-week dates.
- Calculate RSI(2), SMA200, close-to-close return, and max favorable excursion.
- Confirm whether the entry would have passed the current RSI-2 rules.
- Confirm whether the exit would have held through the 2026-05-06 move.
- Compare against other S&P 500 leaders over the same window to avoid overfitting a single winner.

## Trident Memory

Record this through the AWB note path:

```bash
cd services
npm run trident:note -- \
  --title "Pattern: NVDA Leader Reversion Miss" \
  --content "NVDA was identified as a missed leader-reversion setup. Lesson: track liquid S&P 500 leaders that pull back while long-term trend remains intact. If RSI-2 fires near the close, hold through the planned 2-5 day reversion unless a documented exit triggers. Candidate only; verify historical bars and replay before automation." \
  --tags nvda,rsi2,leader-reversion,missed-opportunity
```

The memory content should preserve:

```text
Pattern: Leader Reversion Miss
Ticker: NVDA
Date observed: 2026-05-06
Lesson: Do not chase generic movers. Track liquid S&P 500 leaders that pull back while their long-term trend remains intact. If RSI-2 fires near the close, hold through the planned 2-5 day reversion unless a documented exit rule triggers.
Automation status: Candidate only. Requires historical-bar verification and replay.
```

## Implementation Direction

Add a non-trading daily report section:

- "RSI-2 Leader Candidates"
- "Near-Miss Leader Candidates"
- "Missed Reversion Follow-Up"

This should write to local state and Trident, but should not place orders unless the existing RSI-2 or ORB entry rules are satisfied.

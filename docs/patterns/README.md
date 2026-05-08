# AWB Pattern Library

This directory records trading patterns AWB should learn from without immediately turning every observation into trading authority.

Each pattern should answer:

- What was the setup?
- What rule should have detected it?
- What caused AWB to miss it or exit it incorrectly?
- What would have invalidated the trade?
- What code, data, or process change is required before automation?
- What should Trident remember as a reusable lesson?

Patterns are evidence records first. A pattern becomes an automated strategy only after it has a clear rule, a risk model, and enough replay/backtest support to avoid recreating discretionary momentum trading.

## Recording Notes To Trident

AWB can pass event notes to Trident through the Brain client memory API:

```bash
cd services
npm run trident:note -- \
  --title "Pattern: NVDA Leader Reversion Miss" \
  --content "Liquid S&P 500 leader pulled back inside an intact trend, then rebounded sharply. Verify RSI-2/SMA200 eligibility before automation." \
  --tags nvda,rsi2,leader-reversion,missed-opportunity
```

This writes a `pattern` memory through `POST /v1/memories`. It requires `BRAIN_SERVER_URL` and `BRAIN_API_KEY` to be present in the service environment.

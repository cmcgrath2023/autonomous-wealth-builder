# Broker Comparison Research Brief — March 2026

## Current Setup
- **Alpaca** — equities, crypto, options. Full API + paper trading.
- **OANDA** — forex only. Full API + practice account.

## Gap
No futures trading (oil, gold, natgas, copper, S&P futures). Currently using stock proxies (XOM for oil, GLD for gold, SQQQ for hedging). Direct commodity futures would be more capital-efficient and trade nearly 24/7.

## Broker Analysis

### Alpaca (Current — Keep)
- **Strengths:** Full REST API, paper trading, commission-free, 11K+ stocks/ETFs, crypto, options
- **Weaknesses:** No futures, US markets only
- **API:** Excellent — our entire system is built on it
- **Role:** Primary equity + crypto broker

### OANDA (Current — Keep)
- **Strengths:** Full REST API, practice account, major/minor/exotic forex pairs, 50:1 leverage
- **Weaknesses:** Forex only
- **Role:** Forex trading

### Robinhood (Research — Data Source)
- **Strengths:** Futures (CME — oil, gold, BTC, indices), options, prediction markets, Cortex AI
- **Weaknesses:** No official stock/futures API for automation, no paper trading, no sandbox
- **API:** Crypto API only. Stock/futures require unofficial/reverse-engineered access (ToS violation risk)
- **Prediction Markets:** Event contracts — YES/NO on outcomes. Market consensus probabilities useful as research signals
- **Cortex AI:** Scanner + custom indicators via natural language — model for our agent team
- **Role:** Research data source (prediction markets, Cortex signals). Not viable for automated trading.

### Interactive Brokers (Recommended — Add)
- **Strengths:**
  - Full API (REST + WebSocket + Python SDK)
  - **Futures: oil, gold, natgas, copper, indices, BTC — all with paper trading**
  - Options on everything
  - 170 markets in 40 countries
  - Paper trading with real market conditions
  - Could potentially replace Alpaca AND OANDA
- **Weaknesses:** More complex setup, account minimums, commission-based (low but not free)
- **API:** Professional grade — TWS API + REST API + WebSocket streaming
- **Role:** Futures + international markets. Premium tier broker for Deep Canyon.

## Recommended Architecture

### Free Tier (autonomous-wealth-builder)
- Alpaca (equities + crypto)
- OANDA (forex)
- Alpaca options on commodity ETFs for commodity exposure

### Paid Tier (Deep Canyon)
- Alpaca (equities + crypto)
- OANDA (forex)
- **IBKR (futures + international + advanced options)**
- Robinhood data (prediction markets as research signals)

### Implementation Priority
1. **Now:** Alpaca options on USO/GLD/SLV for commodity plays
2. **Next:** IBKR integration for direct futures (oil, gold, indices)
3. **Later:** Robinhood prediction market data feed for research signals
4. **Eventually:** IBKR as single broker replacing Alpaca + OANDA (170 markets)

## Sources
- [Alpaca API Docs](https://docs.alpaca.markets/)
- [OANDA API](https://developer.oanda.com/)
- [Robinhood Futures](https://robinhood.com/us/en/about/futures/)
- [Robinhood Prediction Markets](https://robinhood.com/us/en/prediction-markets/)
- [Robinhood Legend](https://robinhood.com/us/en/legend/)
- [IBKR Trading API](https://www.interactivebrokers.com/en/trading/ib-api.php)
- [IBKR Python API Guide](https://algotrading101.com/learn/interactive-brokers-python-api-native-guide/)
- [CME Futures on Robinhood](https://www.cmegroup.com/media-room/press-releases/2025/1/29/cme_group_futurestolaunchonrobinhoodbringingnewtradingopportunit.html)

## Detailed Cost Comparison

### Margin Rates
- Alpaca: 3.75%
- IBKR: 1.75% (half the cost)
- OANDA: varies by leverage

### Forex Spreads (EUR/USD)
- OANDA: 1.61 pips average
- IBKR: 0.59 pips all-in (62% cheaper)

### Crypto
- Alpaca: commission-free
- IBKR: commission-based (Alpaca wins here)

### IBKR Account Setup
- No minimum deposit
- Paper trading: available immediately after approval
- Futures: requires separate margin approval
- API: free with any account, TWS + REST + WebSocket
- Languages: Python, C#, C++, Java

## Final Recommendation
Add IBKR for futures/commodities. Keep Alpaca + OANDA.
Three brokers = full market coverage + no single point of failure.
IBKR as Deep Canyon premium feature.

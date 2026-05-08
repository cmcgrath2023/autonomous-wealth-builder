# AWB Crypto Re-Enablement — Claude Code Executable Spec

**Principle:** The Research System earns the right to trade crypto by proving conviction quality in observe mode first. No technical-only entries. Every crypto trade requires a multi-source thesis with conviction ≥ 70\.

---

## 1\. Current State

Per CLAUDE.md:

```
Crypto buys: DISABLED (re-enable when market recovers)
Crypto SL: -5%, TP: +10%
```

The old crypto approach used Neural Trader technical signals (RSI, MACD, BB, EMA) on 15-minute bars — the same approach as equities. This doesn't work for crypto because crypto doesn't respect technical levels the way equities do. No institutional floor on RSI oversold. No mean reversion guarantee.

## 2\. What Changes

Crypto comes back **thesis-driven only**. No standalone technical entries.

### 2.1 Conviction Floor: 70 (vs 50 for equities)

```ts
// In thesis-generator.ts determineAuthorityAction():
const THRESHOLDS = {
  equity: { act: 65, suggest: 50, observe: 0 },
  crypto: { act: 70, suggest: 60, observe: 0 },  // higher bar
  forex:  { act: 65, suggest: 50, observe: 0 },
};
```

A crypto thesis must score 70+ to reach `act` status. This means at least 4-5 of the 7 conviction dimensions must be strong. A single technical signal will never reach 70 alone — it needs relationship leverage, pattern match, sector momentum, and signal quality all contributing.

### 2.2 Minimum 3 Independent Signal Sources

```ts
// In thesis-generator.ts, add crypto-specific gate:
if (isCryptoThesis(cluster)) {
  const uniqueSources = new Set(cluster.signals.map(s => s.source_type));
  if (uniqueSources.size < 3) {
    console.log(`[thesis] Crypto cluster ${cluster.ticker} rejected: only ${uniqueSources.size} sources (need 3+)`);
    return null;
  }
}
```

Valid crypto signal sources:

- `macro` — risk-on/risk-off regime shift, dollar index, yields  
- `catalyst` — ETF flows, regulatory news, halving cycle, institutional adoption  
- `on_chain` — exchange outflows, whale movements, funding rates  
- `momentum` — price/volume breakout with confirmation  
- `sector_rotation` — crypto dominance shifts (BTC→altcoins or reverse)  
- `correlation` — equity market correlation break (crypto decoupling \= signal)  
- `news` — major headlines from crypto-specific feeds

A thesis built on `macro + catalyst + momentum` \= valid (3 sources). A thesis built on `momentum` alone \= rejected.

### 2.3 Three-Phase Re-Enablement

```
Phase 1: OBSERVE (Days 1-30)
  - Signal scan writes crypto signals to research_signals
  - Thesis generator produces crypto theses with conviction scores
  - Authority action: 'observe' — logged, never executed
  - Track what WOULD have happened (paper P&L on observe-mode theses)
  - After 30 days: review hit rate, expected value, max drawdown

Phase 2: SUGGEST (Days 31-60, if Phase 1 positive)
  - Crypto theses with conviction ≥ 70 surface for manual approval
  - You see the thesis, the conviction breakdown, the bear case
  - You approve or reject each one in the dashboard
  - Track real P&L on approved trades

Phase 3: ACT (Day 61+, if Phase 2 profitable)
  - Crypto theses with conviction ≥ 70 auto-execute
  - Same Authority Matrix governance as equities
  - Circuit breaker: if crypto P&L drops below -$500, revert to SUGGEST
```

### 2.4 Phase Configuration

```ts
// In config table (SQLite) or research config:
// Key: 'crypto_trading_phase'
// Values: 'disabled' | 'observe' | 'suggest' | 'act'

// Start at 'observe', manually promote after review:
await stateStore.setConfig('crypto_trading_phase', 'observe');

// In thesis generator routing:
function getCryptoAuthorityAction(convictionScore: number): string {
  const phase = stateStore.getConfig('crypto_trading_phase') || 'disabled';

  if (phase === 'disabled') return 'observe'; // still generate theses, just log
  if (phase === 'observe') return 'observe';
  if (phase === 'suggest' && convictionScore >= 70) return 'suggest';
  if (phase === 'act' && convictionScore >= 70) return 'act';
  return 'observe';
}
```

---

## 3\. Crypto Signal Sources to Add

### 3.1 Crypto Universe

Start with what Alpaca already supports (no new broker needed):

```ts
const CRYPTO_UNIVERSE = [
  'BTC/USD', 'ETH/USD', 'SOL/USD',   // majors — highest liquidity
  'AVAX/USD', 'LINK/USD', 'DOT/USD',  // large-cap alts
  'DOGE/USD', 'MATIC/USD',            // momentum/meme with volume
];
```

### 3.2 Signal Scan Additions (in research-crons.ts)

```ts
// Add to signal_scan cron — runs 24/7 for crypto (not just market hours)
async function scanCryptoSignals(pgQuery: PgQueryFn): Promise<void> {
  // 1. BTC dominance trend
  //    Rising dominance = risk-off within crypto, favor BTC
  //    Falling dominance = altcoin season, favor alts
  //    Source: calculate from BTC market cap vs total crypto market cap

  // 2. Funding rates (via public APIs)
  //    Extremely positive funding = overleveraged longs, correction likely
  //    Extremely negative funding = overleveraged shorts, squeeze likely
  //    Write as research_signal with source_type: 'on_chain'

  // 3. Volume spike detection
  //    24h volume > 3x 20-day average = significant
  //    Write as research_signal with source_type: 'momentum'

  // 4. Correlation regime
  //    When BTC/SPY correlation breaks (normally ~0.5, drops below 0.2)
  //    Crypto is decoupling — strong independent signal
  //    Write as research_signal with source_type: 'correlation'

  // 5. Macro regime for crypto
  //    DXY (dollar index) dropping = bullish crypto
  //    Real yields dropping = bullish crypto
  //    Write as research_signal with source_type: 'macro'
}
```

### 3.3 Crypto-Specific Cron Schedule

```ts
// In research-crons.ts, add:
// Crypto scans run 24/7, every 4 hours (crypto markets never close)
cron.schedule('0 */4 * * *', async () => {
  await scanCryptoSignals(pgQuery);
  log('[cron] Crypto signal scan complete');
});

// Crypto thesis resolution — daily at midnight UTC (crypto doesn't have a "close")
cron.schedule('0 0 * * *', async () => {
  await resolveCryptoTheses(pgQuery);
  log('[cron] Crypto thesis resolution complete');
});
```

---

## 4\. Separate P\&L Tracking

### 4.1 Bayesian Belief Isolation

Crypto outcomes must NOT contaminate equity signal quality:

```ts
// In beliefs table (SQLite), crypto uses domain: 'crypto'
// Existing equity beliefs use domain: 'ticker'
// These are already separate — just ensure crypto trades write to 'crypto' domain

await stateStore.upsertBelief({
  domain: 'crypto',        // NOT 'ticker'
  subject: 'BTC/USD',
  // ... alpha, beta, posterior, observations
});
```

### 4.2 Trident Memory Tagging

```ts
// When recording crypto trades to Trident:
await brain.post('/v1/memories', {
  category: 'finance',
  title: `CRYPTO Trade WIN: BTC/USD +4.2%`,
  content: `...`,
  tags: ['crypto', 'BTC/USD', 'thesis_driven'],  // 'crypto' tag separates from equity
  source: 'research-system',
});

// When training SONA on crypto outcomes:
await brain.post('/v1/train', {
  input: `crypto_thesis: BTC momentum+macro+catalyst conviction=74`,
  output: 'good_thesis',
  metadata: { asset_class: 'crypto', return: 0.042 },  // asset_class tag
});
```

### 4.3 Signal Performance Isolation

The `signal_performance` table in Postgres already partitions by `sector`. Use `sector = 'crypto'` for all crypto signals. Hit rates computed separately.

```sql
-- Crypto signal performance (separate from equity):
SELECT source_type, hit_rate, total_signals
FROM signal_performance
WHERE sector = 'crypto'
ORDER BY hit_rate DESC;
```

### 4.4 Circuit Breaker

```ts
// Crypto-specific circuit breaker (in addition to existing equity breaker)
const CRYPTO_DAILY_LOSS_LIMIT = -500;  // dollars

async function checkCryptoCircuitBreaker(): Promise<boolean> {
  const todayPnl = await getCryptoPnlToday();  // sum closed_trades WHERE ticker LIKE '%/USD%' AND closed_at = today
  if (todayPnl <= CRYPTO_DAILY_LOSS_LIMIT) {
    console.log(`[circuit-breaker] Crypto daily loss $${todayPnl} exceeds limit — halting crypto`);
    await stateStore.setConfig('crypto_trading_phase', 'suggest');  // downgrade from act to suggest
    return true; // tripped
  }
  return false;
}
```

---

## 5\. Knowledge Graph: Crypto Relationships

Seed crypto-relevant relationships into `company_relationships`:

```ts
const CRYPTO_RELATIONSHIPS = [
  // BTC ecosystem
  { a: 'BTC/USD', b: 'MSTR', rel: 'proxy', strength: 0.85, evidence: 'MicroStrategy BTC treasury holdings' },
  { a: 'BTC/USD', b: 'COIN', rel: 'infrastructure', strength: 0.80, evidence: 'Coinbase exchange revenue tied to BTC volume' },
  { a: 'BTC/USD', b: 'MARA', rel: 'producer', strength: 0.90, evidence: 'Marathon Digital BTC mining' },
  { a: 'BTC/USD', b: 'RIOT', rel: 'producer', strength: 0.85, evidence: 'Riot Platforms BTC mining' },
  { a: 'BTC/USD', b: 'IBIT', rel: 'proxy', strength: 0.95, evidence: 'iShares BTC ETF' },

  // ETH ecosystem
  { a: 'ETH/USD', b: 'ETHE', rel: 'proxy', strength: 0.90, evidence: 'Grayscale ETH trust' },
  { a: 'ETH/USD', b: 'COIN', rel: 'infrastructure', strength: 0.75, evidence: 'Coinbase ETH staking + trading' },

  // Cross-crypto correlations
  { a: 'BTC/USD', b: 'ETH/USD', rel: 'sector_peer', strength: 0.70, evidence: 'High correlation, ETH follows BTC' },
  { a: 'BTC/USD', b: 'SOL/USD', rel: 'sector_peer', strength: 0.60, evidence: 'Alt follows BTC with higher beta' },
  { a: 'ETH/USD', b: 'SOL/USD', rel: 'competitor', strength: 0.65, evidence: 'L1 smart contract competition' },

  // Macro correlations
  { a: 'BTC/USD', b: 'GLD', rel: 'correlation', strength: 0.40, evidence: 'Digital gold narrative, partial correlation' },
  { a: 'BTC/USD', b: 'QQQ', rel: 'correlation', strength: 0.50, evidence: 'Risk-on asset correlation with tech' },
];
```

This means when a catalyst fires on BTC/USD, the blast radius query finds MSTR, COIN, MARA, RIOT, ETH/USD, SOL/USD — and can generate cross-asset theses. "BTC ETF inflows surging \+ BTC dominance rising \+ macro risk-on → BTC long, with MARA and RIOT as leveraged equity proxies."

---

## 6\. CLAUDE.md Updates

When crypto is re-enabled, update CLAUDE.md:

```
### Crypto Trading (Research System Gated)
- Crypto buys: ENABLED via Research System thesis only
- Conviction floor: 70 (vs 50 for equities)
- Minimum 3 independent signal sources per thesis
- Phase: [observe|suggest|act] — currently: observe
- Crypto SL: -5%, TP: +10% (unchanged)
- Circuit breaker: -$500 daily crypto loss → downgrade to suggest
- Crypto P&L tracked separately from equities (domain: 'crypto' in beliefs)
- BTC/USD, ETH/USD, SOL/USD, AVAX/USD, LINK/USD (5 pairs initially)
```

---

## 7\. Acceptance Criteria

### Phase 1 Setup (Claude Code builds this now)

- [ ] `crypto_trading_phase` config key added, set to `'observe'`  
- [ ] Crypto signal scan runs every 4 hours, 24/7  
- [ ] Crypto signals written to research\_signals with sector='crypto'  
- [ ] Thesis generator applies conviction floor of 70 for crypto  
- [ ] Thesis generator requires 3+ independent sources for crypto  
- [ ] Crypto theses route with authority\_action='observe' regardless of score  
- [ ] Crypto relationships seeded in company\_relationships (BTC→MSTR, etc.)  
- [ ] Bayesian beliefs use domain='crypto' for crypto tickers  
- [ ] Trident memories tagged with 'crypto' for isolation  
- [ ] Signal performance tracks crypto separately (sector='crypto')

### Phase 1 Evaluation (You review after 30 days)

- [ ] Count crypto theses generated with conviction ≥ 70  
- [ ] Paper-test: if those theses had been traded, what would the P\&L be?  
- [ ] Compare vs BTC buy-and-hold over same period  
- [ ] If positive expected value: promote to 'suggest'  
- [ ] If negative: analyze which signal sources are noise, adjust weights

### Phase 2 → Phase 3 Promotion

- [ ] Manual review of suggest-mode trades after 30 days  
- [ ] If profitable with acceptable drawdown: promote to 'act'  
- [ ] Circuit breaker tested and confirmed working  
- [ ] CLAUDE.md updated with current phase

---

## 8\. Implementation Order for Claude Code

1. Add `crypto_trading_phase` config key to SQLite (set to 'observe')  
2. Add crypto conviction floor (70) and 3-source minimum to thesis generator  
3. Add crypto signal scan to research-crons.ts (every 4 hours, 24/7)  
4. Seed crypto relationships into PG company\_relationships  
5. Add crypto circuit breaker  
6. Ensure Bayesian beliefs partition crypto under domain='crypto'  
7. Ensure Trident memory tagging includes 'crypto' tag  
8. Add overnight \+ EU-open catalyst crons (10pm, 4am, 6am) — benefits both forex and crypto  
9. Update CLAUDE.md crypto section


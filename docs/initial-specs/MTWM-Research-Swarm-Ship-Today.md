# MTWM Research Swarm + Nanobot Reintroduction
## Claude Code Execution Spec — SHIP TODAY (2026-04-10)

> This is not a future architecture. This wires into what's running RIGHT NOW:
> gateway-v2/src/index.ts (orchestrator), trade-engine.ts (NT + buy/sell loop),
> data-feed.ts, research-worker.ts, Trident LoRA (brain client), OpenClaw
> (Warren urgency → Fin execution → Ops monitoring), Discord comms.
>
> NeuralTrader is the technical authority. Nothing bypasses NT.scan().
> Research analysts FEED the universe and GATE the output. They don't replace NT.

---

## PRIORITY ORDER (all ship today)

### Wave 1 — DEFENSIVE (do these first, they stop bleeding)
1. **Risk Manager** — blocks bad trades before they happen
2. **Post-Mortem** — learns from today's -$6,411 AFJKU disaster, writes rules

### Wave 2 — OFFENSIVE (do these second, they find good trades)
3. **Catalyst Hunter** — finds catalyst-backed tickers, feeds universe
4. **Macro Analyst** — regime detection, sets position sizing multiplier

### Wave 3 — REFINEMENT (do these third if time permits)
5. **Exit Analyst** — tells Trident LoRA WHEN to sell (targets, trailing stops)
6. **Sector Rotator** — biases universe toward leading sectors

### Wave 4 — NANOBOT REINTRODUCTION
7. Wire all analysts into Nanobot cron schedule

---

## 1. Risk Manager

**File:** `gateway-v2/src/analysts/risk-manager.ts`

**Question it answers:** "Should this trade be blocked for portfolio safety reasons?"

**When it runs:** Every heartbeat, AFTER NT.scan() returns buy signals, BEFORE order execution.

**Consumer:** trade-engine.ts buy pipeline — inserts between NT verdict and Alpaca order.

```typescript
// gateway-v2/src/analysts/risk-manager.ts

import { Store } from '../store.js';

export interface RiskVerdict {
  ticker: string;
  allowed: boolean;
  reason: string;
  adjustedSizePct?: number;  // If allowed but downsized
}

export interface RiskConfig {
  maxPositionPct: number;       // Max % of portfolio in one ticker (default 8%)
  maxSectorPct: number;         // Max % of portfolio in one sector (default 20%)
  maxCorrelatedPct: number;     // Max % in correlated group (default 15%)
  minAvgVolume: number;         // Min 20-day avg volume (default 500,000)
  minMarketCap: number;         // Min market cap in millions (default 300)
  maxSpreadBps: number;         // Max bid-ask spread in bps (default 50)
  blockedSuffixes: string[];    // SPAC units, warrants ['U', 'W', 'WS', 'UN']
  blockedPatterns: RegExp[];    // Additional patterns to reject
  maxDailyBuys: number;         // Max new positions per day (default 8)
  maxOpenPositions: number;     // Max concurrent positions (default 12)
}

const DEFAULT_CONFIG: RiskConfig = {
  maxPositionPct: 8,
  maxSectorPct: 20,
  maxCorrelatedPct: 15,
  minAvgVolume: 500_000,
  minMarketCap: 300,
  maxSpread Bps: 50,
  blockedSuffixes: ['U', 'W', 'WS', 'UN', 'R', 'RT'],
  blockedPatterns: [/^[A-Z]{5,}$/, /\d/],  // 5+ char tickers often warrants; digits = weird instruments
  maxDailyBuys: 8,
  maxOpenPositions: 12,
};

export class RiskManager {
  private config: RiskConfig;
  private store: Store;
  private todayBuyCount = 0;

  constructor(store: Store, config?: Partial<RiskConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Called from trade-engine AFTER NT.scan() returns buy signals.
   * Returns filtered list — only tickers that pass risk checks.
   */
  async evaluate(
    candidates: { ticker: string; price: number; confidence: number }[],
    currentPositions: { ticker: string; marketValue: number; sector?: string }[],
    portfolioValue: number,
    alpacaHeaders: Record<string, string>,
  ): Promise<RiskVerdict[]> {
    const verdicts: RiskVerdict[] = [];
    const positionCount = currentPositions.length;

    for (const candidate of candidates) {
      const { ticker, price } = candidate;

      // ── Structural blocks ──────────────────────────────────
      // Suffix check (SPAC units, warrants, rights)
      for (const suffix of this.config.blockedSuffixes) {
        if (ticker.endsWith(suffix) && ticker.length > suffix.length + 1) {
          verdicts.push({ ticker, allowed: false, reason: `blocked_suffix:${suffix}` });
          continue;
        }
      }

      // Pattern check
      for (const pat of this.config.blockedPatterns) {
        if (pat.test(ticker)) {
          verdicts.push({ ticker, allowed: false, reason: `blocked_pattern:${pat.source}` });
          continue;
        }
      }

      // ── Capacity blocks ────────────────────────────────────
      if (positionCount >= this.config.maxOpenPositions) {
        verdicts.push({ ticker, allowed: false, reason: `max_positions:${positionCount}/${this.config.maxOpenPositions}` });
        continue;
      }
      if (this.todayBuyCount >= this.config.maxDailyBuys) {
        verdicts.push({ ticker, allowed: false, reason: `max_daily_buys:${this.todayBuyCount}/${this.config.maxDailyBuys}` });
        continue;
      }

      // ── Concentration check ────────────────────────────────
      // Would this position exceed single-position limit?
      const proposedSize = portfolioValue * (this.config.maxPositionPct / 100);
      // Already own it? Check combined exposure
      const existingPos = currentPositions.find(p => p.ticker === ticker);
      if (existingPos) {
        const combinedPct = ((existingPos.marketValue + proposedSize) / portfolioValue) * 100;
        if (combinedPct > this.config.maxPositionPct * 1.5) {
          verdicts.push({ ticker, allowed: false, reason: `concentration:${combinedPct.toFixed(1)}%` });
          continue;
        }
      }

      // ── Liquidity check (use Alpaca snapshot) ──────────────
      // This is the check that would have caught AFJKU
      try {
        const snapRes = await fetch(
          `https://data.alpaca.markets/v2/stocks/${ticker}/snapshot?feed=iex`,
          { headers: alpacaHeaders, signal: AbortSignal.timeout(3000) }
        );
        if (snapRes.ok) {
          const snap = await snapRes.json() as any;
          const dailyVolume = snap.dailyBar?.v || 0;
          if (dailyVolume < this.config.minAvgVolume) {
            verdicts.push({ ticker, allowed: false, reason: `low_volume:${dailyVolume}` });
            continue;
          }
          // Spread check
          const bid = snap.latestQuote?.bp || 0;
          const ask = snap.latestQuote?.ap || 0;
          if (bid > 0 && ask > 0) {
            const spreadBps = ((ask - bid) / bid) * 10000;
            if (spreadBps > this.config.maxSpreadBps) {
              verdicts.push({ ticker, allowed: false, reason: `wide_spread:${spreadBps.toFixed(0)}bps` });
              continue;
            }
          }
        }
      } catch { /* timeout = skip liquidity check, allow through */ }

      // ── Passed all checks ──────────────────────────────────
      verdicts.push({ ticker, allowed: true, reason: 'passed' });
    }

    return verdicts;
  }

  incrementBuyCount(): void { this.todayBuyCount++; }
  resetDaily(): void { this.todayBuyCount = 0; }
}
```

**Wiring into trade-engine.ts** — insert after NT.scan(), before order execution:

```typescript
// In trade-engine.ts, after the NT scan block:

// ─── STEP 4b: Risk Manager gate ────────────────────────────
const riskVerdicts = await this.riskManager.evaluate(
  ntBuys.map(s => ({ ticker: s.ticker, price: s.price, confidence: s.confidence })),
  positions,
  portfolioValue,
  headers,
);

const riskApproved = riskVerdicts.filter(v => v.allowed);
const riskBlocked = riskVerdicts.filter(v => !v.allowed);
if (riskBlocked.length > 0) {
  console.log(`  [RISK] Blocked: ${riskBlocked.map(v => `${v.ticker}:${v.reason}`).join(', ')}`);
}
console.log(`  [RISK] ${riskApproved.length} approved of ${ntBuys.length} NT buys`);

// Only proceed with risk-approved tickers
const finalCandidates = ntBuys.filter(s =>
  riskApproved.some(v => v.ticker === s.ticker)
);
```

---

## 2. Post-Mortem Analyst

**File:** `gateway-v2/src/analysts/post-mortem.ts`

**Question it answers:** "Why did today's losses happen? What rule would have stopped them?"

**When it runs:** Daily at 4:05pm ET via Nanobot cron. Also available on-demand.

**Consumer:** Writes rules to `risk_rules` table in store. Risk Manager reads them next morning.

```typescript
// gateway-v2/src/analysts/post-mortem.ts

import Anthropic from '@anthropic-ai/sdk';
import { Store } from '../store.js';

interface ClosedTrade {
  ticker: string;
  pnl: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  reason: string;
  entryTime: string;
  exitTime: string;
  holdDurationMinutes: number;
}

interface PostMortemRule {
  id: string;
  createdAt: string;
  source: 'post_mortem';
  ruleType: 'block_pattern' | 'adjust_gate' | 'adjust_sizing' | 'add_filter';
  description: string;
  // Machine-readable rule for Risk Manager to consume
  rule: {
    field: string;           // e.g. 'ticker_suffix', 'daily_volume', 'spread_bps', 'percent_change'
    operator: 'gt' | 'lt' | 'eq' | 'contains' | 'matches';
    value: string | number;
    action: 'block' | 'downsize_50' | 'require_catalyst';
  };
  evidence: string;          // The trade(s) that prompted this rule
  pnlImpact: number;         // How much this rule would have saved
}

export class PostMortemAnalyst {
  private client: Anthropic;
  private store: Store;

  constructor(store: Store) {
    this.store = store;
    this.client = new Anthropic();
  }

  async runDailyPostMortem(): Promise<PostMortemRule[]> {
    // Get today's closed trades
    const todayStr = new Date().toISOString().slice(0, 10);
    const closedTrades = this.store.getClosedTrades()
      .filter((t: any) => (t.closedAt || t.closed_at || '').startsWith(todayStr));

    if (closedTrades.length === 0) {
      console.log('[POST-MORTEM] No closed trades today. Nothing to analyze.');
      return [];
    }

    const losses = closedTrades.filter((t: any) => (t.pnl || 0) < 0);
    const totalLoss = losses.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);

    if (losses.length === 0) {
      console.log('[POST-MORTEM] All trades profitable today. No rules needed.');
      return [];
    }

    console.log(`[POST-MORTEM] Analyzing ${losses.length} losing trades (total: $${totalLoss.toFixed(2)})`);

    // Get existing rules to avoid duplicates
    const existingRules = this.store.getRiskRules?.() || [];

    const prompt = `You are the Post-Mortem Analyst for a momentum day-trading system.

Your job: analyze today's losing trades and produce SPECIFIC, MACHINE-READABLE rules
that would have prevented each loss. Rules must be concrete — not "be more careful"
but "block tickers with daily volume < 100,000" or "block tickers ending in U/W/WS".

TODAY'S LOSING TRADES:
${losses.map((t: any) => `
- ${t.ticker}: Lost $${Math.abs(t.pnl || 0).toFixed(2)}
  Entry: $${t.entryPrice || t.entry_price} → Exit: $${t.exitPrice || t.exit_price}
  Qty: ${t.qty}, Hold time: ${t.holdDurationMinutes || '?'}min
  Sell reason: ${t.reason || 'unknown'}
`).join('\n')}

EXISTING RULES (don't duplicate):
${existingRules.map((r: any) => `- ${r.description}`).join('\n') || 'None yet.'}

For EACH losing trade, produce a JSON rule object:
{
  "ruleType": "block_pattern" | "adjust_gate" | "adjust_sizing" | "add_filter",
  "description": "Human-readable description",
  "rule": {
    "field": "ticker_suffix" | "daily_volume" | "spread_bps" | "percent_change" | "market_cap" | "trade_count" | "ticker_length",
    "operator": "gt" | "lt" | "eq" | "contains" | "matches",
    "value": <number or string>,
    "action": "block" | "downsize_50" | "require_catalyst"
  },
  "evidence": "Which trade(s) this prevents",
  "pnlImpact": <how much $ this saves>
}

Return ONLY a JSON array of rule objects. No commentary. If a loss was just normal
market movement (small loss, high-volume liquid stock, reasonable hold time), say
"ruleType": "none" and explain why no rule is needed.`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      const rules: PostMortemRule[] = JSON.parse(
        text.replace(/```json|```/g, '').trim()
      ).filter((r: any) => r.ruleType !== 'none');

      // Persist rules to store
      for (const rule of rules) {
        rule.id = `pm-${todayStr}-${Math.random().toString(36).slice(2, 8)}`;
        rule.createdAt = new Date().toISOString();
        rule.source = 'post_mortem';
        this.store.addRiskRule?.(rule);
        console.log(`[POST-MORTEM] New rule: ${rule.description} (saves $${rule.pnlImpact})`);
      }

      // Feed Trident SONA with regret signal
      // This is the learning loop — Trident gets smarter from losses
      await this.feedTridentRegret(losses, rules);

      return rules;
    } catch (e: any) {
      console.error(`[POST-MORTEM] Analysis failed: ${e.message}`);
      return [];
    }
  }

  private async feedTridentRegret(losses: any[], rules: PostMortemRule[]): Promise<void> {
    // If Trident brain client is available, feed the regret signal
    try {
      const brainClient = (globalThis as any).__brainClient;
      if (brainClient?.sendRegret) {
        await brainClient.sendRegret({
          date: new Date().toISOString().slice(0, 10),
          totalLoss: losses.reduce((s: number, t: any) => s + Math.abs(t.pnl || 0), 0),
          tradeCount: losses.length,
          rulesGenerated: rules.length,
          worstTrade: losses.sort((a: any, b: any) => (a.pnl || 0) - (b.pnl || 0))[0]?.ticker,
        });
      }
    } catch { /* Trident not available, skip */ }
  }
}
```

---

## 3. Catalyst Hunter

**File:** `gateway-v2/src/analysts/catalyst-hunter.ts`

**Question it answers:** "What catalysts are live today that could drive momentum?"

**When it runs:** Pre-market (8:30am ET) via Nanobot + every 2 hours during market hours.

**Consumer:** Writes catalyst-tagged tickers to store → research-worker picks them up → feeds universe.

```typescript
// gateway-v2/src/analysts/catalyst-hunter.ts

import Anthropic from '@anthropic-ai/sdk';
import { Store } from '../store.js';

interface CatalystCandidate {
  symbol: string;
  catalyst: string;
  catalystType: 'earnings_beat' | 'fda_approval' | 'contract_win' | 'upgrade'
              | 'insider_buying' | 'sector_momentum' | 'ma_rumor' | 'guidance_raise'
              | 'short_squeeze' | 'institutional_accumulation';
  urgency: 'today' | 'this_week' | 'developing';
  confidence: number;  // 0-1
}

export class CatalystHunter {
  private client: Anthropic;
  private store: Store;

  constructor(store: Store) {
    this.store = store;
    this.client = new Anthropic();
  }

  async scan(): Promise<CatalystCandidate[]> {
    console.log('[CATALYST] Starting catalyst scan...');

    // Use web search via Anthropic API to find today's catalysts
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `You are a catalyst hunter for a momentum trading system. Today is ${new Date().toISOString().slice(0, 10)}.

Search for TODAY's market-moving catalysts across these categories:
1. Earnings beats/misses (pre-market or after-hours from yesterday)
2. FDA approvals/rejections
3. Major contract wins or partnership announcements
4. Analyst upgrades/downgrades from top firms
5. Insider buying clusters (Form 4 filings)
6. Short squeeze setups (high short interest + catalyst)

Search for: "stock market movers today catalysts", "earnings surprises today",
"FDA approvals today", "analyst upgrades today"

For EACH catalyst you find, provide:
- symbol: The ticker
- catalyst: One-line description
- catalystType: One of [earnings_beat, fda_approval, contract_win, upgrade, insider_buying, sector_momentum, ma_rumor, guidance_raise, short_squeeze, institutional_accumulation]
- urgency: "today" if it's playing out now, "this_week" if developing, "developing" if early
- confidence: 0-1 how strong the catalyst is

Return ONLY a JSON array. No tickers under $10. No SPACs. No warrants. No OTC.
Max 15 tickers. Quality over quantity — a missed catalyst is better than a false one.`
      }],
    });

    // Extract text from response (may have tool_use blocks from web search)
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    try {
      const candidates: CatalystCandidate[] = JSON.parse(
        text.replace(/```json|```/g, '').trim()
      );

      // Write to store as research stars
      for (const c of candidates) {
        this.store.upsertResearchStar?.({
          symbol: c.symbol,
          catalyst: `[${c.catalystType}] ${c.catalyst}`,
          confidence: c.confidence,
          source: 'catalyst_hunter',
          timestamp: new Date().toISOString(),
        });
      }

      console.log(`[CATALYST] Found ${candidates.length} catalyst candidates: ${candidates.map(c => `${c.symbol}(${c.catalystType})`).join(', ')}`);
      return candidates;
    } catch (e: any) {
      console.error(`[CATALYST] Parse failed: ${e.message}`);
      return [];
    }
  }
}
```

---

## 4. Macro Analyst

**File:** `gateway-v2/src/analysts/macro-analyst.ts`

**Question it answers:** "What's today's market regime and how should it affect position sizing?"

**When it runs:** Pre-market (8:15am ET) + after any VIX spike > 10% intraday.

**Consumer:** Sets `regimeMultiplier` on trade-engine — scales ALL position sizes.

```typescript
// gateway-v2/src/analysts/macro-analyst.ts

import Anthropic from '@anthropic-ai/sdk';

export type MarketRegime = 'risk_on' | 'risk_off' | 'choppy' | 'trending' | 'crisis';

export interface MacroVerdict {
  regime: MarketRegime;
  sizingMultiplier: number;    // 0.25 (crisis) to 1.5 (strong trend)
  reasoning: string;
  keyIndicators: {
    vix: number;
    dxy: number;
    spx_trend: 'up' | 'down' | 'flat';
    yield_10y: number;
    credit_spreads: 'tight' | 'normal' | 'wide';
  };
}

export class MacroAnalyst {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async assess(alpacaHeaders: Record<string, string>): Promise<MacroVerdict> {
    console.log('[MACRO] Assessing market regime...');

    // Fetch VIX, SPY, DXY proxies from Alpaca
    const indicators: string[] = [];
    try {
      const symbols = ['SPY', 'QQQ', 'TLT', 'GLD', 'UUP']; // SPX proxy, Nasdaq, bonds, gold, dollar
      const syms = symbols.join(',');
      const snapRes = await fetch(
        `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${syms}&feed=iex`,
        { headers: alpacaHeaders, signal: AbortSignal.timeout(5000) }
      );
      if (snapRes.ok) {
        const data = await snapRes.json() as any;
        for (const sym of symbols) {
          const s = data[sym];
          if (s) {
            const price = s.latestTrade?.p || 0;
            const prevClose = s.prevDailyBar?.c || price;
            const changePct = prevClose > 0 ? ((price - prevClose) / prevClose * 100) : 0;
            indicators.push(`${sym}: $${price.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`);
          }
        }
      }
    } catch (e: any) {
      indicators.push(`Snapshot fetch failed: ${e.message}`);
    }

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are a macro regime analyst. Based on today's indicators, classify the market regime.

TODAY'S INDICATORS:
${indicators.join('\n')}

Respond with ONLY a JSON object:
{
  "regime": "risk_on" | "risk_off" | "choppy" | "trending" | "crisis",
  "sizingMultiplier": <0.25 to 1.5>,
  "reasoning": "<2 sentences max>",
  "keyIndicators": {
    "vix": <estimated VIX level>,
    "dxy": <estimated DXY>,
    "spx_trend": "up" | "down" | "flat",
    "yield_10y": <estimated 10Y yield>,
    "credit_spreads": "tight" | "normal" | "wide"
  }
}

Sizing guide:
- crisis (VIX>30, broad selloff): 0.25x — minimize exposure
- risk_off (VIX>20, rotation to safety): 0.5x — defensive
- choppy (no clear direction, whipsaws): 0.6x — reduce size
- risk_on (VIX<18, breadth positive): 1.0x — normal
- trending (VIX<15, strong momentum, breadth expanding): 1.25x — lean in`
      }],
    });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      const verdict: MacroVerdict = JSON.parse(text.replace(/```json|```/g, '').trim());
      console.log(`[MACRO] Regime: ${verdict.regime}, sizing: ${verdict.sizingMultiplier}x — ${verdict.reasoning}`);
      return verdict;
    } catch {
      console.log('[MACRO] Parse failed, defaulting to risk_on 1.0x');
      return {
        regime: 'risk_on',
        sizingMultiplier: 1.0,
        reasoning: 'Could not assess, defaulting to normal.',
        keyIndicators: { vix: 18, dxy: 100, spx_trend: 'flat', yield_10y: 4.3, credit_spreads: 'normal' },
      };
    }
  }
}
```

---

## 5. Exit Analyst

**File:** `gateway-v2/src/analysts/exit-analyst.ts`

**Question it answers:** "For each held position, what's the target, trailing stop, and when does risk/reward flip negative?"

**When it runs:** Every heartbeat alongside Trident LoRA's hold/sell check.

**Consumer:** Overrides Trident's binary hold/sell with specific price targets + trailing stops.

```typescript
// gateway-v2/src/analysts/exit-analyst.ts

export interface ExitPlan {
  ticker: string;
  currentPrice: number;
  currentPnlPct: number;
  action: 'hold' | 'sell_now' | 'tighten_stop' | 'take_partial';
  target1: number | null;         // First profit target
  target2: number | null;         // Stretch target
  stopLoss: number;               // Hard stop
  trailingStopPct: number | null; // Dynamic trailing (only after +3%)
  reasoning: string;
  urgency: 'immediate' | 'today' | 'let_ride';
}

export class ExitAnalyst {
  /**
   * Pure rules-based exit logic. No LLM call — this runs on every heartbeat
   * and must be fast. Trident LoRA provides the "should I sell at all?" signal;
   * ExitAnalyst provides the "at what price and when?" parameters.
   */
  evaluate(positions: {
    ticker: string;
    entryPrice: number;
    currentPrice: number;
    qty: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
    holdDurationMinutes: number;
    tridentSignal?: 'hold' | 'sell';
  }[]): ExitPlan[] {
    return positions.map(pos => {
      const pct = pos.unrealizedPnlPct;
      const holdMins = pos.holdDurationMinutes;

      // ── Loss management ──────────────────────────────────
      if (pct <= -5) {
        return {
          ticker: pos.ticker,
          currentPrice: pos.currentPrice,
          currentPnlPct: pct,
          action: 'sell_now',
          target1: null, target2: null,
          stopLoss: pos.currentPrice,
          trailingStopPct: null,
          reasoning: `Down ${pct.toFixed(1)}% — hard stop triggered`,
          urgency: 'immediate',
        };
      }

      if (pct <= -3 && holdMins > 120) {
        return {
          ticker: pos.ticker,
          currentPrice: pos.currentPrice,
          currentPnlPct: pct,
          action: 'sell_now',
          target1: null, target2: null,
          stopLoss: pos.currentPrice,
          trailingStopPct: null,
          reasoning: `Down ${pct.toFixed(1)}% for 2+ hours — time-stop triggered`,
          urgency: 'immediate',
        };
      }

      // ── Profit management ────────────────────────────────
      if (pct >= 10) {
        return {
          ticker: pos.ticker,
          currentPrice: pos.currentPrice,
          currentPnlPct: pct,
          action: 'tighten_stop',
          target1: pos.entryPrice * 1.15,
          target2: pos.entryPrice * 1.20,
          stopLoss: pos.entryPrice * 1.05,     // Lock in 5% minimum
          trailingStopPct: 3,                   // 3% trailing from high
          reasoning: `Up ${pct.toFixed(1)}% — trailing 3% from high, floor at +5%`,
          urgency: 'let_ride',
        };
      }

      if (pct >= 5) {
        return {
          ticker: pos.ticker,
          currentPrice: pos.currentPrice,
          currentPnlPct: pct,
          action: 'tighten_stop',
          target1: pos.entryPrice * 1.10,
          target2: pos.entryPrice * 1.15,
          stopLoss: pos.entryPrice * 1.01,     // Lock in breakeven + 1%
          trailingStopPct: 4,
          reasoning: `Up ${pct.toFixed(1)}% — trailing 4%, floor at breakeven`,
          urgency: 'let_ride',
        };
      }

      // ── Neutral / small gain ─────────────────────────────
      if (pct >= 0) {
        return {
          ticker: pos.ticker,
          currentPrice: pos.currentPrice,
          currentPnlPct: pct,
          action: 'hold',
          target1: pos.entryPrice * 1.08,
          target2: pos.entryPrice * 1.12,
          stopLoss: pos.entryPrice * 0.95,     // Standard 5% stop
          trailingStopPct: null,
          reasoning: `Up ${pct.toFixed(1)}% — standard stop at -5%`,
          urgency: 'let_ride',
        };
      }

      // ── Small loss ───────────────────────────────────────
      // Trident says hold? Trust it for now.
      if (pos.tridentSignal === 'hold' && pct > -3) {
        return {
          ticker: pos.ticker,
          currentPrice: pos.currentPrice,
          currentPnlPct: pct,
          action: 'hold',
          target1: pos.entryPrice * 1.05,
          target2: null,
          stopLoss: pos.entryPrice * 0.95,
          trailingStopPct: null,
          reasoning: `Down ${pct.toFixed(1)}% — Trident says hold, stop at -5%`,
          urgency: 'today',
        };
      }

      // Default: hold with tight stop
      return {
        ticker: pos.ticker,
        currentPrice: pos.currentPrice,
        currentPnlPct: pct,
        action: 'hold',
        target1: pos.entryPrice * 1.05,
        target2: null,
        stopLoss: pos.entryPrice * 0.95,
        trailingStopPct: null,
        reasoning: `Down ${pct.toFixed(1)}% — holding with -5% stop`,
        urgency: 'today',
      };
    });
  }
}
```

---

## 6. Sector Rotator

**File:** `gateway-v2/src/analysts/sector-rotator.ts`

**Question it answers:** "Which sectors are leading this week? Bias universe toward them."

**When it runs:** Pre-market (8:20am ET) daily.

**Consumer:** Writes `sectorBias` weights to store → trade-engine uses them to prioritize universe.

```typescript
// gateway-v2/src/analysts/sector-rotator.ts

import Anthropic from '@anthropic-ai/sdk';

export interface SectorBias {
  sector: string;
  etf: string;
  weekReturn: number;
  rank: number;
  bias: 'overweight' | 'neutral' | 'underweight';
}

export class SectorRotator {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async analyze(alpacaHeaders: Record<string, string>): Promise<SectorBias[]> {
    console.log('[SECTOR] Analyzing sector rotation...');

    const sectorETFs = ['XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLC', 'XLY', 'XLP', 'XLU', 'XLRE', 'XLB'];

    try {
      const syms = sectorETFs.join(',');
      const barsRes = await fetch(
        `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${syms}&feed=iex`,
        { headers: alpacaHeaders, signal: AbortSignal.timeout(5000) }
      );

      if (!barsRes.ok) throw new Error(`Snapshot failed: ${barsRes.status}`);
      const data = await barsRes.json() as any;

      const sectors: SectorBias[] = sectorETFs.map((etf, i) => {
        const s = data[etf];
        const price = s?.latestTrade?.p || 0;
        const prevClose = s?.prevDailyBar?.c || price;
        const changePct = prevClose > 0 ? ((price - prevClose) / prevClose * 100) : 0;
        const sectorNames: Record<string, string> = {
          XLK: 'Technology', XLF: 'Financials', XLV: 'Healthcare', XLE: 'Energy',
          XLI: 'Industrials', XLC: 'Communications', XLY: 'Cons Discretionary',
          XLP: 'Cons Staples', XLU: 'Utilities', XLRE: 'Real Estate', XLB: 'Materials',
        };
        return {
          sector: sectorNames[etf] || etf,
          etf,
          weekReturn: changePct,  // Approximation — snapshot gives 1-day, good enough for daily rotator
          rank: 0,
          bias: 'neutral' as const,
        };
      });

      // Rank by performance
      sectors.sort((a, b) => b.weekReturn - a.weekReturn);
      sectors.forEach((s, i) => {
        s.rank = i + 1;
        if (i < 3) s.bias = 'overweight';
        else if (i > 7) s.bias = 'underweight';
        else s.bias = 'neutral';
      });

      const leaders = sectors.filter(s => s.bias === 'overweight');
      console.log(`[SECTOR] Leaders: ${leaders.map(s => `${s.sector}(${s.etf} ${s.weekReturn >= 0 ? '+' : ''}${s.weekReturn.toFixed(1)}%)`).join(', ')}`);

      return sectors;
    } catch (e: any) {
      console.error(`[SECTOR] Analysis failed: ${e.message}`);
      return [];
    }
  }
}
```

---

## 7. Nanobot Cron Schedule (reintroduction)

**File:** `gateway-v2/src/nanobot-schedule.ts`

These tasks wire into the existing NanobotScheduler that's being restored.

```typescript
// gateway-v2/src/nanobot-schedule.ts

export const RESEARCH_NANOBOT_TASKS = [
  // ── PRE-MARKET SEQUENCE (runs once before open) ──────────
  {
    name: 'macro-regime',
    cron: '15 8 * * 1-5',     // 8:15am ET, weekdays
    description: 'Macro regime assessment — sets position sizing multiplier for the day',
    handler: 'MacroAnalyst.assess',
    priority: 1,
  },
  {
    name: 'sector-rotation',
    cron: '20 8 * * 1-5',     // 8:20am ET, weekdays
    description: 'Sector rotation — biases universe toward leading sectors',
    handler: 'SectorRotator.analyze',
    priority: 2,
  },
  {
    name: 'catalyst-premarket',
    cron: '30 8 * * 1-5',     // 8:30am ET, weekdays
    description: 'Pre-market catalyst scan — populates research stars before open',
    handler: 'CatalystHunter.scan',
    priority: 1,
  },

  // ── INTRADAY (runs during market hours) ──────────────────
  {
    name: 'catalyst-midday',
    cron: '0 12 * * 1-5',     // 12pm ET
    description: 'Midday catalyst refresh — catches afternoon movers',
    handler: 'CatalystHunter.scan',
    priority: 3,
  },
  {
    name: 'catalyst-afternoon',
    cron: '0 14 * * 1-5',     // 2pm ET
    description: 'Afternoon catalyst check — power hour setup',
    handler: 'CatalystHunter.scan',
    priority: 3,
  },

  // ── POST-MARKET (runs after close) ───────────────────────
  {
    name: 'post-mortem',
    cron: '5 16 * * 1-5',     // 4:05pm ET, weekdays
    description: 'Daily post-mortem — analyzes losses, generates risk rules for tomorrow',
    handler: 'PostMortemAnalyst.runDailyPostMortem',
    priority: 1,
  },

  // ── OVERNIGHT / CONTINUOUS ───────────────────────────────
  {
    name: 'overnight-catalyst',
    cron: '0 22 * * 0-4',     // 10pm ET Sun-Thu (catches Asia/EU open)
    description: 'Overnight catalyst scan — earnings after-hours, Asia/EU moves',
    handler: 'CatalystHunter.scan',
    priority: 2,
  },
  {
    name: 'weekend-deep-dive',
    cron: '0 14 * * 0',       // Sunday 2pm ET
    description: 'Weekly deep analysis — sector, macro, position review, rule audit',
    handler: 'WeeklyDeepDive.run',  // Runs all analysts in sequence
    priority: 2,
  },
];
```

---

## 8. Wiring Into trade-engine.ts

The complete buy pipeline after all analysts are integrated:

```typescript
// In trade-engine.ts heartbeat:

// ─── UNIFIED BUY PIPELINE ──────────────────────────────────
// 1. Universe = dedup(Alpaca movers ∪ Research stars ∪ Catalyst Hunter picks)
// 2. Quality gate (price, volume, no SPACs, no blow-offs)
// 3. Fetch 15-min bars → NeuralTrader.scan() → buy signals
// 4. Risk Manager gate (liquidity, concentration, spread, capacity)
// 5. Macro multiplier applied to position sizing
// 6. Sector bias applied (overweight/underweight adjustment)
// 7. Bayesian → Brain history → Trident LoRA (existing gates)
// 8. Execute via Alpaca

// ─── SELL PIPELINE ──────────────────────────────────────────
// 1. Trident LoRA: hold or sell signal (existing)
// 2. Exit Analyst: specific targets, trailing stops, time-stops (NEW)
// 3. If Exit Analyst says sell_now → sell immediately
// 4. If Exit Analyst says tighten_stop → update stop-loss order on Alpaca
// 5. If loss > 5% → hard stop, no override
// 6. If loss > 3% AND hold > 2 hours → time stop, no override
```

---

## 9. File Layout (what Claude Code creates today)

```
gateway-v2/src/analysts/
├── risk-manager.ts          # Wave 1 — blocks bad trades
├── post-mortem.ts           # Wave 1 — learns from losses
├── catalyst-hunter.ts       # Wave 2 — finds catalyst-backed tickers
├── macro-analyst.ts         # Wave 2 — regime detection + sizing
├── exit-analyst.ts          # Wave 3 — targets + trailing stops
├── sector-rotator.ts        # Wave 3 — sector bias
└── index.ts                 # Barrel export

gateway-v2/src/
├── nanobot-schedule.ts      # Wave 4 — cron schedule for all analysts
```

---

## 10. Acceptance Criteria (how Chris knows it's working)

**By tonight:**
- `[RISK]` log lines appear in heartbeat showing blocked/approved counts
- `[POST-MORTEM]` runs at 4:05pm, generates rules from today's AFJKU disaster
- `[CATALYST]` pre-market scan runs tomorrow at 8:30am, populates research stars
- `[MACRO]` regime assessment runs tomorrow at 8:15am, sets sizing multiplier

**By tomorrow market open:**
- Universe shows candidates from BOTH movers AND catalyst hunter
- Log line: `[UNIVERSE] N candidates (X both, Y research-only, Z movers-only)`
- Risk Manager blocks any AFJKU-class ticker before it reaches order execution
- Exit Analyst provides targets for all 6 held positions
- Nanobot cron fires on schedule (visible in orchestrator logs)

**The test that proves it works:**
- Tomorrow, if a SPAC unit or low-liquidity garbage ticker appears in the Alpaca movers,
  the log shows `[RISK] Blocked: XXXU:blocked_suffix:U` and NO order is placed.
- That's the -$6,411 that doesn't happen.

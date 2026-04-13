/**
 * Risk Manager — Wave 1 analyst (defensive)
 *
 * Runs AFTER NeuralTrader.scan() returns buy signals and BEFORE any order
 * is placed with Alpaca. Blocks trades that fail structural/liquidity/
 * concentration/capacity checks. This is the gate that would have blocked
 * AFJKU (SPAC unit, low liquidity) before the -$6,411 hit the account.
 *
 * Consumes risk_rules from the state store — rules written by the
 * Post-Mortem analyst after each losing day become active filters here
 * on the next heartbeat. That's the learning loop.
 *
 * No LLM calls on the hot path. All checks are deterministic + Alpaca
 * snapshot fetches. Runs in ~100ms per candidate.
 */

import type { GatewayStateStore, RiskRuleRow } from '../../../gateway/src/state-store.js';

export interface RiskVerdict {
  ticker: string;
  allowed: boolean;
  reason: string;
  matchedRule?: string;       // id of risk_rule that blocked (if any)
  adjustedSizePct?: number;   // if allowed but downsized
}

export interface RiskConfig {
  // Defaults approved by Chris on 2026-04-10. Flag any change with a
  // comment + a reason. These are the guardrails, tune carefully.
  maxPositionUsd: number;     // Hard cap per-position in dollars
  maxOpenPositions: number;   // Max concurrent positions
  maxDailyBuys: number;       // Max new positions per day (0 = no cap)
  minDailyVolume: number;     // Min daily volume to consider (AFJKU prevention)
  maxSpreadBps: number;       // Max bid-ask spread in bps (1 bps = 0.01%)
  blockedSuffixes: string[];  // SPAC unit/warrant suffixes — blocks these tickers
  minPrice: number;           // Min stock price
  maxPrice: number;           // Max stock price
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionUsd: 2_500,      // Keep current per-position cap
  maxOpenPositions: 12,       // Chris: up from 10
  maxDailyBuys: 0,            // Chris: no cap — rebuying loser backfill must stay possible
  minDailyVolume: 10_000,     // LOW — only catches true illiquids. Early-session intraday
                               // volume is unreliable (LMT showed 26K at 11AM despite being
                               // a 2M/day stock). The SPAC suffix block is the real AFJKU gate.
  maxSpreadBps: 100,          // 1% — catches truly broken instruments. Normal pre-market
                               // spreads on large caps can be 50-100bps before depth fills in.
  // U / W / WS / UN only.
  blockedSuffixes: ['U', 'W', 'WS', 'UN'],
  minPrice: 10,
  maxPrice: 1000,             // RAISED from $500 — was blocking LMT ($620), NOC ($681).
                               // Large-cap defense stocks are legitimate; $1000 catches
                               // only genuinely extreme prices.
};

export interface RiskCandidate {
  ticker: string;
  price: number;
  confidence?: number;
}

export interface RiskPosition {
  ticker: string;
  marketValue: number;
  sector?: string;
}

export class RiskManager {
  private config: RiskConfig;
  private store: GatewayStateStore;
  private todayBuyCount = 0;
  private lastResetDate = '';

  constructor(store: GatewayStateStore, config?: Partial<RiskConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
  }

  /** Reset the per-day counter on a new trading day. */
  private resetIfNewDay(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastResetDate !== today) {
      this.todayBuyCount = 0;
      this.lastResetDate = today;
    }
  }

  /**
   * Evaluate a list of NT-approved buy candidates and return per-ticker verdicts.
   * Always returns one verdict per candidate; `allowed=false` means block.
   */
  async evaluate(
    candidates: RiskCandidate[],
    currentPositions: RiskPosition[],
    alpacaHeaders: Record<string, string>,
  ): Promise<RiskVerdict[]> {
    this.resetIfNewDay();
    const verdicts: RiskVerdict[] = [];
    const activeRules = this.store.getActiveRiskRules();
    const positionCount = currentPositions.length;

    // Fan out snapshot fetches in parallel — one per candidate
    const snapshots = await Promise.all(
      candidates.map(c => this.fetchSnapshot(c.ticker, alpacaHeaders).catch(() => null)),
    );

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const snap = snapshots[i];
      const verdict = this.evaluateOne(c, snap, currentPositions, positionCount, activeRules);
      verdicts.push(verdict);
    }

    return verdicts;
  }

  private evaluateOne(
    candidate: RiskCandidate,
    snapshot: any | null,
    currentPositions: RiskPosition[],
    positionCount: number,
    activeRules: RiskRuleRow[],
  ): RiskVerdict {
    const { ticker, price } = candidate;

    // ── Price floor/ceiling ─────────────────────────────────
    if (price < this.config.minPrice) {
      return { ticker, allowed: false, reason: `price $${price.toFixed(2)} < $${this.config.minPrice}` };
    }
    if (price > this.config.maxPrice) {
      return { ticker, allowed: false, reason: `price $${price.toFixed(2)} > $${this.config.maxPrice}` };
    }

    // ── Structural: blocked suffixes ────────────────────────
    for (const suffix of this.config.blockedSuffixes) {
      // Require ticker to be LONGER than the suffix so "U" doesn't block 1-char tickers
      if (ticker.endsWith(suffix) && ticker.length > suffix.length + 1) {
        return { ticker, allowed: false, reason: `blocked_suffix:${suffix}` };
      }
    }

    // ── Capacity ────────────────────────────────────────────
    if (positionCount >= this.config.maxOpenPositions) {
      return { ticker, allowed: false, reason: `max_positions:${positionCount}/${this.config.maxOpenPositions}` };
    }
    // maxDailyBuys = 0 disables the cap (per Chris's profile — rebuying is allowed)
    if (this.config.maxDailyBuys > 0 && this.todayBuyCount >= this.config.maxDailyBuys) {
      return { ticker, allowed: false, reason: `max_daily_buys:${this.todayBuyCount}/${this.config.maxDailyBuys}` };
    }

    // ── Concentration ───────────────────────────────────────
    const existing = currentPositions.find(p => p.ticker === ticker);
    if (existing && existing.marketValue + this.config.maxPositionUsd > this.config.maxPositionUsd * 1.5) {
      return { ticker, allowed: false, reason: `concentration:$${existing.marketValue.toFixed(0)}+proposed` };
    }

    // ── Volume / spread checks REMOVED 2026-04-13 ──────────
    // These blocked LMT ($620, 26K intraday vol), RTX (262bps spread),
    // GD, DVN, SLB, OXY — all legitimate stocks — because intraday volume
    // is always low early in the session and pre-market spreads are wide.
    // The SPAC suffix block + Trident LoRA are the real protection against
    // AFJKU-class garbage. Volume/spread were over-engineering that cost
    // us the entire Monday morning of the Iran oil play.
    //
    // Snapshot is still fetched for learned-rule evaluation below.

    // ── Dynamic rules (learned from Post-Mortem) ───────────
    for (const rule of activeRules) {
      const hit = this.matchRule(rule, candidate, snapshot);
      if (hit) {
        if (rule.action === 'block') {
          return { ticker, allowed: false, reason: `learned_rule:${rule.description}`, matchedRule: rule.id };
        }
        if (rule.action === 'downsize_50') {
          return { ticker, allowed: true, reason: 'passed (downsized by learned rule)', matchedRule: rule.id, adjustedSizePct: 50 };
        }
        // 'require_catalyst' currently not enforced here — Catalyst Hunter wiring handles it
      }
    }

    return { ticker, allowed: true, reason: 'passed' };
  }

  private matchRule(rule: RiskRuleRow, candidate: RiskCandidate, snapshot: any | null): boolean {
    let fieldValue: string | number | null = null;
    switch (rule.field) {
      case 'ticker_suffix':
        return candidate.ticker.endsWith(String(rule.value));
      case 'ticker_length':
        fieldValue = candidate.ticker.length;
        break;
      case 'percent_change':
        fieldValue = snapshot?.dailyBar?.c && snapshot?.prevDailyBar?.c
          ? ((snapshot.dailyBar.c - snapshot.prevDailyBar.c) / snapshot.prevDailyBar.c) * 100
          : null;
        break;
      case 'daily_volume':
        fieldValue = snapshot?.dailyBar?.v ?? snapshot?.prevDailyBar?.v ?? null;
        break;
      case 'trade_count':
        fieldValue = snapshot?.dailyBar?.n ?? null;
        break;
      case 'spread_bps': {
        const bid = snapshot?.latestQuote?.bp ?? 0;
        const ask = snapshot?.latestQuote?.ap ?? 0;
        fieldValue = bid > 0 && ask > 0 ? ((ask - bid) / bid) * 10_000 : null;
        break;
      }
      default:
        return false;
    }
    if (fieldValue === null) return false;
    const ruleVal = isNaN(Number(rule.value)) ? rule.value : Number(rule.value);
    switch (rule.operator) {
      case 'gt': return typeof fieldValue === 'number' && typeof ruleVal === 'number' && fieldValue > ruleVal;
      case 'lt': return typeof fieldValue === 'number' && typeof ruleVal === 'number' && fieldValue < ruleVal;
      case 'eq': return fieldValue == ruleVal;
      case 'contains': return String(fieldValue).includes(String(ruleVal));
      case 'matches': return new RegExp(String(ruleVal)).test(String(fieldValue));
      default: return false;
    }
  }

  private async fetchSnapshot(ticker: string, headers: Record<string, string>): Promise<any | null> {
    try {
      const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(ticker)}/snapshot?feed=iex`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  incrementBuyCount(): void {
    this.resetIfNewDay();
    this.todayBuyCount++;
  }

  getStats(): { todayBuyCount: number; activeRuleCount: number } {
    return {
      todayBuyCount: this.todayBuyCount,
      activeRuleCount: this.store.getActiveRiskRules().length,
    };
  }
}

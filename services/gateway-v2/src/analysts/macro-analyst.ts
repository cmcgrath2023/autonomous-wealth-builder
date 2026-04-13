/**
 * Macro Analyst — Wave 2 analyst (regime detection, NOT YET WIRED)
 *
 * Built 2026-04-10. Not yet live.
 *
 * Question it answers: "What's today's market regime and how should it
 * affect position sizing?"
 *
 * Output: a sizingMultiplier (0.25 to 1.5) that scales position sizes
 * across ALL trades until the next assessment. Crisis → 0.25x, trending
 * bull → 1.25x, normal → 1.0x.
 *
 * Consumer (when wired): trade-engine reads the latest multiplier from the
 * store and multiplies `perPosition` by it before sizing each buy. The
 * hook already exists as `macro_sizing_multiplier` in the config table —
 * default 1.0 means macro has no effect until the analyst actually runs.
 *
 * Runs two paths:
 *   1. LLM path (when ANTHROPIC_API_KEY is set): richer reasoning over
 *      Alpaca snapshots of SPY/QQQ/TLT/GLD/UUP.
 *   2. Deterministic fallback (always available): classifies regime from
 *      the same snapshots using fixed thresholds. Good enough for v1.
 *
 * Activation (when ready):
 *   - Schedule this in orchestrator (pre-market 8:15 AM ET, like Post-Mortem)
 *   - Wire trade-engine to read `macro_sizing_multiplier` from store before
 *     the `perPosition` calculation in the buy loop
 */

import Anthropic from '@anthropic-ai/sdk';
import type { GatewayStateStore } from '../../../gateway/src/state-store.js';

const MACRO_MODEL = 'claude-haiku-4-5-20251001';
const MACRO_PROBE_SYMBOLS = ['SPY', 'QQQ', 'TLT', 'GLD', 'UUP', 'UVXY'];

export type MarketRegime = 'risk_on' | 'risk_off' | 'choppy' | 'trending' | 'crisis';

export interface MacroVerdict {
  regime: MarketRegime;
  sizingMultiplier: number;    // 0.25 (crisis) to 1.5 (strong trend)
  reasoning: string;
  keyIndicators: {
    spxChangePct: number;
    qqqChangePct: number;
    tltChangePct: number;
    gldChangePct: number;
    uupChangePct: number;
    uvxyChangePct: number;
    spxTrend: 'up' | 'down' | 'flat';
    volatility: 'low' | 'normal' | 'elevated' | 'extreme';
  };
  source: 'llm' | 'deterministic';
  timestamp: string;
}

interface SnapshotResult {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
}

export class MacroAnalyst {
  private client: Anthropic | null;
  private store: GatewayStateStore;

  constructor(store: GatewayStateStore) {
    this.store = store;
    if (process.env.ANTHROPIC_API_KEY) {
      try { this.client = new Anthropic(); } catch { this.client = null; }
    } else {
      this.client = null;
    }
  }

  async assess(alpacaHeaders: Record<string, string>): Promise<MacroVerdict> {
    console.log('[MACRO] Assessing market regime...');

    const snapshots = await this.fetchSnapshots(alpacaHeaders);
    if (snapshots.length === 0) {
      console.log('[MACRO] No snapshots available, defaulting to neutral 1.0x');
      return this.neutralDefault();
    }

    const indicators = this.buildIndicators(snapshots);

    // LLM path — richer reasoning
    if (this.client) {
      try {
        const verdict = await this.assessWithLLM(snapshots, indicators);
        this.persistVerdict(verdict);
        return verdict;
      } catch (e: any) {
        console.error(`[MACRO] LLM path failed, using deterministic: ${e.message}`);
      }
    }

    // Deterministic fallback — fixed thresholds on snapshot data
    const verdict = this.assessDeterministic(indicators);
    this.persistVerdict(verdict);
    return verdict;
  }

  /** Latest verdict from the store (null if macro has never run). */
  getLatest(): MacroVerdict | null {
    try {
      const raw = this.store.get('macro_latest_verdict');
      if (!raw) return null;
      return JSON.parse(raw) as MacroVerdict;
    } catch {
      return null;
    }
  }

  /** The multiplier the trade-engine should apply to position sizing. */
  getCurrentMultiplier(): number {
    const latest = this.getLatest();
    if (!latest) return 1.0;
    // Stale check: if verdict is more than 24h old, fall back to neutral
    const ageMs = Date.now() - new Date(latest.timestamp).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) return 1.0;
    return latest.sizingMultiplier;
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private async fetchSnapshots(headers: Record<string, string>): Promise<SnapshotResult[]> {
    try {
      const syms = MACRO_PROBE_SYMBOLS.join(',');
      const res = await fetch(
        `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${syms}&feed=iex`,
        { headers, signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) return [];
      const data = await res.json() as any;
      const out: SnapshotResult[] = [];
      for (const sym of MACRO_PROBE_SYMBOLS) {
        const s = data[sym];
        if (!s) continue;
        const price = s.latestTrade?.p ?? 0;
        const prevClose = s.prevDailyBar?.c ?? price;
        const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
        out.push({ symbol: sym, price, prevClose, changePct });
      }
      return out;
    } catch {
      return [];
    }
  }

  private buildIndicators(snapshots: SnapshotResult[]): MacroVerdict['keyIndicators'] {
    const bySym = new Map(snapshots.map(s => [s.symbol, s]));
    const get = (sym: string) => bySym.get(sym)?.changePct ?? 0;
    const spxChange = get('SPY');
    const uvxyChange = get('UVXY');

    const spxTrend: 'up' | 'down' | 'flat' =
      spxChange > 0.3 ? 'up' : spxChange < -0.3 ? 'down' : 'flat';

    // UVXY is a 1.5x VIX proxy. Rough translation:
    //   UVXY +5% → VIX roughly +3% (volatility rising)
    //   UVXY +15% → VIX spike, watch for crisis
    const volatility: 'low' | 'normal' | 'elevated' | 'extreme' =
      uvxyChange > 15 ? 'extreme' :
      uvxyChange > 5 ? 'elevated' :
      uvxyChange < -5 ? 'low' : 'normal';

    return {
      spxChangePct: spxChange,
      qqqChangePct: get('QQQ'),
      tltChangePct: get('TLT'),
      gldChangePct: get('GLD'),
      uupChangePct: get('UUP'),
      uvxyChangePct: uvxyChange,
      spxTrend,
      volatility,
    };
  }

  private assessDeterministic(indicators: MacroVerdict['keyIndicators']): MacroVerdict {
    const { spxChangePct, qqqChangePct, tltChangePct, gldChangePct, volatility } = indicators;

    // Crisis: SPX down hard + volatility extreme + flight to safety (TLT+GLD up)
    if (spxChangePct < -2 && volatility === 'extreme' && (tltChangePct > 0.5 || gldChangePct > 1)) {
      return this.verdict('crisis', 0.25, 'Broad selloff + vol spike + safety bid — minimal exposure', indicators, 'deterministic');
    }

    // Risk off: SPX down + vol elevated OR flight to safety
    if (spxChangePct < -1 && (volatility === 'elevated' || volatility === 'extreme')) {
      return this.verdict('risk_off', 0.5, 'SPX down with rising volatility — defensive sizing', indicators, 'deterministic');
    }
    if (tltChangePct > 0.8 && gldChangePct > 0.8 && spxChangePct < 0) {
      return this.verdict('risk_off', 0.5, 'TLT + GLD both bid while SPX weak — classic risk-off rotation', indicators, 'deterministic');
    }

    // Trending bull: strong SPX + strong QQQ + low vol
    if (spxChangePct > 1 && qqqChangePct > 1 && volatility === 'low') {
      return this.verdict('trending', 1.25, 'Strong broad rally with vol compressed — lean in', indicators, 'deterministic');
    }

    // Risk on: positive SPX + normal vol
    if (spxChangePct > 0.3 && volatility !== 'elevated' && volatility !== 'extreme') {
      return this.verdict('risk_on', 1.0, 'Normal upward drift — standard sizing', indicators, 'deterministic');
    }

    // Choppy: no clear direction OR conflicting signals
    if (volatility === 'elevated' || Math.abs(spxChangePct) < 0.3) {
      return this.verdict('choppy', 0.6, 'No clear trend or vol elevated — reduced sizing', indicators, 'deterministic');
    }

    // Default catch-all: neutral
    return this.verdict('risk_on', 1.0, 'No strong signal — neutral sizing', indicators, 'deterministic');
  }

  private async assessWithLLM(snapshots: SnapshotResult[], indicators: MacroVerdict['keyIndicators']): Promise<MacroVerdict> {
    const indicatorLines = snapshots.map(s =>
      `${s.symbol}: ${s.price.toFixed(2)} (${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%)`
    ).join('\n');

    const prompt = `You are a macro regime analyst for a day-trading system. Classify today's market regime based on these indicators and recommend a position-sizing multiplier.

TODAY'S SNAPSHOTS (from Alpaca IEX):
${indicatorLines}

Reference:
- SPY = S&P 500 ETF (broad market)
- QQQ = Nasdaq-100 ETF (tech proxy)
- TLT = 20yr Treasury ETF (bond/safety proxy)
- GLD = Gold ETF (inflation/safety proxy)
- UUP = US Dollar Index ETF
- UVXY = 1.5x VIX futures ETF (volatility proxy)

Return ONLY a JSON object:
{
  "regime": "risk_on" | "risk_off" | "choppy" | "trending" | "crisis",
  "sizingMultiplier": <0.25 to 1.5>,
  "reasoning": "<2 sentences max>"
}

Sizing guide:
- crisis (SPY hard down + UVXY spike + safety bid): 0.25x
- risk_off (SPY down + UVXY rising): 0.5x
- choppy (no clear direction or whipsaw): 0.6x
- risk_on (SPY modest up + low vol): 1.0x
- trending (SPY strong up + QQQ strong up + UVXY collapsing): 1.25-1.5x`;

    const response = await this.client!.messages.create({
      model: MACRO_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no JSON in LLM response');
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return this.verdict(
      parsed.regime as MarketRegime,
      Number(parsed.sizingMultiplier) || 1.0,
      String(parsed.reasoning || ''),
      indicators,
      'llm',
    );
  }

  private verdict(
    regime: MarketRegime,
    sizingMultiplier: number,
    reasoning: string,
    keyIndicators: MacroVerdict['keyIndicators'],
    source: 'llm' | 'deterministic',
  ): MacroVerdict {
    // Clamp multiplier to sane range
    const clamped = Math.max(0.25, Math.min(1.5, sizingMultiplier));
    console.log(`[MACRO] Regime: ${regime}, sizing: ${clamped.toFixed(2)}x (${source}) — ${reasoning}`);
    return {
      regime,
      sizingMultiplier: clamped,
      reasoning,
      keyIndicators,
      source,
      timestamp: new Date().toISOString(),
    };
  }

  private neutralDefault(): MacroVerdict {
    return {
      regime: 'risk_on',
      sizingMultiplier: 1.0,
      reasoning: 'No snapshots available — defaulting to neutral 1.0x',
      keyIndicators: {
        spxChangePct: 0, qqqChangePct: 0, tltChangePct: 0, gldChangePct: 0,
        uupChangePct: 0, uvxyChangePct: 0, spxTrend: 'flat', volatility: 'normal',
      },
      source: 'deterministic',
      timestamp: new Date().toISOString(),
    };
  }

  private persistVerdict(verdict: MacroVerdict): void {
    try {
      this.store.set('macro_latest_verdict', JSON.stringify(verdict));
    } catch (e: any) {
      console.warn(`[MACRO] Failed to persist verdict: ${e.message}`);
    }
  }
}

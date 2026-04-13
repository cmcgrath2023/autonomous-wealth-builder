/**
 * Catalyst Hunter — Wave 2 analyst (offensive, wired live)
 *
 * Shipped 2026-04-10. Running against paper account.
 *
 * Question it answers: "What catalysts are live today that could drive
 * momentum? Which tickers should we be watching?"
 *
 * Two paths:
 *   1. LLM path (when ANTHROPIC_API_KEY set): calls Anthropic with the
 *      web_search tool, asks for today's earnings beats / FDA approvals /
 *      upgrades / M&A rumors / insider clusters. Returns ranked ticker list.
 *   2. Deterministic fallback: queries Alpaca's /v1beta1/news endpoint for
 *      recent news items, extracts symbols, filters for catalyst keywords
 *      in the headline (beat, upgrade, approval, raised guidance, etc.).
 *
 * Consumer: writes results directly to `research_stars` via
 * `store.saveResearchStar()`. Trade-engine's buy pipeline already reads
 * research stars as a universe feeder — Catalyst Hunter output automatically
 * flows into the Alpaca movers ∪ research-worker stars ∪ catalyst hunter
 * merge that feeds NeuralTrader.scan().
 *
 * Schedule: pre-market 8:30 AM ET + midday 12 PM ET + afternoon 2 PM ET.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { GatewayStateStore } from '../../../gateway/src/state-store.js';

const CATALYST_MODEL = 'claude-sonnet-4-6';

// Keywords that suggest a catalyst in a news headline. Ordered roughly by strength.
const CATALYST_KEYWORDS: Array<{ pattern: RegExp; type: string; weight: number }> = [
  // === Geopolitical / macro (added after Iran blockade blind spot 2026-04-12) ===
  { pattern: /\b(blockade|naval blockade|port blockade|military blockade)\b/i, type: 'geopolitical', weight: 0.98 },
  { pattern: /\b(iran|iranian|strait of hormuz)\b/i, type: 'geopolitical', weight: 0.95 },
  { pattern: /\b(sanctions|embargo|trade war|tariff.*(hike|increase|impose))\b/i, type: 'geopolitical', weight: 0.92 },
  { pattern: /\b(opec|opec\+|production cut|supply cut|output cut)\b/i, type: 'supply_shock', weight: 0.95 },
  { pattern: /\b(oil spike|oil surge|crude.*surge|barrel.*\$\d{2,3})\b/i, type: 'supply_shock', weight: 0.93 },
  { pattern: /\b(war|invasion|military action|escalation|conflict)\b/i, type: 'geopolitical', weight: 0.90 },
  { pattern: /\b(fed rate|rate hike|rate cut|interest rate|fomc)\b/i, type: 'fed_action', weight: 0.88 },
  // === Company-specific catalysts ===
  { pattern: /\bfda\s+(approval|approved|clearance|cleared|breakthrough)\b/i, type: 'fda_approval', weight: 0.95 },
  { pattern: /\b(earnings|q[1-4])\s+(beat|beats|crushed|smashed|surpass)/i, type: 'earnings_beat', weight: 0.90 },
  { pattern: /\b(upgrade|upgraded to|initiated.*(buy|outperform))/i, type: 'upgrade', weight: 0.85 },
  { pattern: /\b(guidance raised|raises guidance|raised outlook)/i, type: 'guidance_raise', weight: 0.88 },
  { pattern: /\b(acquisition|acquires|buyout|to acquire|merger|takeover)\b/i, type: 'ma_rumor', weight: 0.85 },
  { pattern: /\b(contract win|awarded contract|\$\d+[bmk]?\s*(contract|deal))/i, type: 'contract_win', weight: 0.80 },
  { pattern: /\b(insider buying|insider purchased|director bought)/i, type: 'insider_buying', weight: 0.75 },
  { pattern: /\b(short squeeze|short interest|high short)/i, type: 'short_squeeze', weight: 0.70 },
  { pattern: /\b(partnership|strategic partnership|collaboration)\b/i, type: 'partnership', weight: 0.65 },
  { pattern: /\b(record revenue|beats estimates|exceeds expectations)/i, type: 'earnings_beat', weight: 0.80 },
];

export interface CatalystCandidate {
  symbol: string;
  catalyst: string;       // One-line description
  catalystType: string;
  confidence: number;     // 0-1
  source: 'llm' | 'alpaca_news';
}

export interface CatalystResult {
  candidates: CatalystCandidate[];
  source: 'llm' | 'alpaca_news' | 'none';
  timestamp: string;
  error?: string;
}

export class CatalystHunter {
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

  async scan(alpacaHeaders: Record<string, string>): Promise<CatalystResult> {
    console.log('[CATALYST] Starting scan...');

    // Prefer LLM path if available
    if (this.client) {
      try {
        const candidates = await this.scanWithLLM();
        if (candidates.length > 0) {
          this.persistCandidates(candidates);
          return { candidates, source: 'llm', timestamp: new Date().toISOString() };
        }
        console.log('[CATALYST] LLM returned 0 candidates, trying Alpaca news fallback');
      } catch (e: any) {
        console.error(`[CATALYST] LLM path failed: ${e.message}. Falling back to Alpaca news.`);
      }
    }

    // Deterministic fallback: Alpaca news endpoint + keyword matching
    try {
      const candidates = await this.scanAlpacaNews(alpacaHeaders);
      this.persistCandidates(candidates);
      return { candidates, source: 'alpaca_news', timestamp: new Date().toISOString() };
    } catch (e: any) {
      console.error(`[CATALYST] Alpaca news path failed: ${e.message}`);
      return { candidates: [], source: 'none', timestamp: new Date().toISOString(), error: e.message };
    }
  }

  // ─── LLM path ────────────────────────────────────────────────────────

  private async scanWithLLM(): Promise<CatalystCandidate[]> {
    const today = new Date().toISOString().slice(0, 10);
    const prompt = `You are a catalyst hunter for a momentum day-trading system. Today is ${today}.

Search for TODAY's market-moving catalysts across these categories:
1. Earnings beats / misses (pre-market or after-hours from yesterday)
2. FDA approvals / rejections / breakthrough designations
3. Major contract wins or partnership announcements
4. Analyst upgrades or downgrades from top-tier firms
5. Insider buying clusters (Form 4 filings)
6. Short squeeze setups (high short interest + catalyst)
7. Guidance raises or lowered guidance

Use web search. Then return ONLY a JSON array of objects with this shape:
[
  {
    "symbol": "<ticker>",
    "catalyst": "<one-line description of the catalyst>",
    "catalystType": "earnings_beat" | "fda_approval" | "contract_win" | "upgrade" | "insider_buying" | "ma_rumor" | "guidance_raise" | "short_squeeze" | "partnership",
    "confidence": <0 to 1>
  }
]

Constraints:
- NO tickers under $10
- NO SPACs (anything ending in U, W, WS, UN)
- NO OTC / pink sheet stocks
- NO ADRs of Chinese companies unless there's clear US-listed volume
- Max 15 tickers
- Quality over quantity — a missed catalyst is better than a false one

Return ONLY the JSON array. No commentary.`;

    const response = await this.client!.messages.create({
      model: CATALYST_MODEL,
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    return this.parseLLMCandidates(text);
  }

  private parseLLMCandidates(text: string): CatalystCandidate[] {
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((c: any) => c && typeof c.symbol === 'string' && c.symbol.length >= 1 && c.symbol.length <= 5)
        .map((c: any) => ({
          symbol: c.symbol.toUpperCase(),
          catalyst: String(c.catalyst || '').slice(0, 200),
          catalystType: String(c.catalystType || 'unknown'),
          confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0.5)),
          source: 'llm' as const,
        }));
    } catch (e: any) {
      console.error(`[CATALYST] LLM parse failed: ${e.message}`);
      return [];
    }
  }

  // ─── Alpaca news + Yahoo Finance RSS ──────────────────────────────────

  // When a geopolitical headline has no symbols (common for macro events),
  // inject the sector ETFs that benefit from that catalyst type.
  // Added after Iran blockade blind spot — the biggest story of the weekend
  // had NO symbols attached in Alpaca's news API.
  private static readonly SECTOR_MAP: Record<string, string[]> = {
    geopolitical: ['XLE', 'XOM', 'CVX', 'LMT', 'RTX', 'NOC', 'GD', 'GLD'],
    supply_shock: ['XLE', 'XOM', 'CVX', 'COP', 'OXY', 'HAL', 'SLB', 'USO'],
    fed_action:   ['XLF', 'TLT', 'GLD', 'SPY', 'QQQ'],
  };

  private async scanAlpacaNews(headers: Record<string, string>): Promise<CatalystCandidate[]> {
    // Pull from BOTH Alpaca news AND Yahoo Finance RSS
    const items: Array<{ headline: string; symbols: string[] }> = [];

    // Source 1: Alpaca news (last 48h for weekend coverage)
    try {
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const url = `https://data.alpaca.markets/v1beta1/news?start=${encodeURIComponent(since)}&limit=50&sort=desc`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const data = await res.json() as any;
        for (const item of (data.news ?? [])) {
          items.push({
            headline: item.headline || item.summary || '',
            symbols: item.symbols || [],
          });
        }
        console.log(`[CATALYST] Alpaca news: ${items.length} items`);
      }
    } catch (e: any) {
      console.log(`[CATALYST] Alpaca news fetch failed: ${e.message}`);
    }

    // Source 2: Yahoo Finance RSS (general market + commodity news)
    for (const feed of [
      'https://finance.yahoo.com/news/rssindex',
      'https://finance.yahoo.com/rss/topstories',
    ]) {
      try {
        const res = await fetch(feed, {
          headers: { 'User-Agent': 'MTWM/1.0' },
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) {
          const text = await res.text();
          // Simple XML parsing — extract <title> and <description> tags
          const titles = text.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/gi) || [];
          for (const t of titles) {
            const headline = t.replace(/<\/?title>|<!\[CDATA\[|\]\]>/gi, '').trim();
            if (headline && headline.length > 10) {
              items.push({ headline, symbols: [] });  // Yahoo RSS doesn't have symbols
            }
          }
        }
      } catch { /* best-effort */ }
    }
    console.log(`[CATALYST] Total news items to scan: ${items.length}`);

    interface CandidateAcc { catalyst: string; catalystType: string; confidence: number }
    const bySymbol = new Map<string, CandidateAcc>();

    for (const item of items) {
      const headline = item.headline;
      if (!headline) continue;

      // Find the first matching catalyst keyword
      let matchedType: string | null = null;
      let matchedWeight = 0;
      for (const kw of CATALYST_KEYWORDS) {
        if (kw.pattern.test(headline)) {
          matchedType = kw.type;
          matchedWeight = kw.weight;
          break;
        }
      }
      if (!matchedType) continue;

      // Determine symbols: use article's symbols if present, otherwise inject
      // sector ETFs for macro/geopolitical events. This is what catches the
      // "Trump blockade" headline that had NO symbols attached.
      let symbols = item.symbols.filter((s: string) => s && s.length >= 1 && s.length <= 5);
      if (symbols.length === 0) {
        const sectorSymbols = CatalystHunter.SECTOR_MAP[matchedType];
        if (sectorSymbols) {
          symbols = sectorSymbols;
          console.log(`[CATALYST] Injecting sector symbols for "${matchedType}" headline: ${symbols.join(',')}`);
        }
      }
      if (symbols.length === 0) continue;

      // Record one candidate per symbol
      for (const sym of symbols) {
        if (/[UW]$|WS$|UN$/.test(sym)) continue;   // skip SPAC suffixes
        const existing = bySymbol.get(sym);
        if (!existing || existing.confidence < matchedWeight) {
          bySymbol.set(sym, {
            catalyst: `${matchedType}: ${headline.slice(0, 140)}`,
            catalystType: matchedType,
            confidence: matchedWeight,
          });
        }
      }
    }

    return [...bySymbol.entries()]
      .sort((a, b) => b[1].confidence - a[1].confidence)
      .slice(0, 15)
      .map(([symbol, c]) => ({
        symbol,
        catalyst: c.catalyst,
        catalystType: c.catalystType,
        confidence: c.confidence,
        source: 'alpaca_news' as const,
      }));
  }

  // ─── Persistence ─────────────────────────────────────────────────────

  private persistCandidates(candidates: CatalystCandidate[]): void {
    for (const c of candidates) {
      try {
        // Score = confidence mapped to the 0.85-0.99 research-star range so
        // catalyst-tagged picks rank alongside the best research-worker stars.
        const score = Math.min(0.99, 0.85 + c.confidence * 0.14);
        this.store.saveResearchStar(
          c.symbol,
          'catalyst',
          `[${c.catalystType}] ${c.catalyst}`,
          score,
        );
      } catch (e: any) {
        console.warn(`[CATALYST] persist failed for ${c.symbol}: ${e.message}`);
      }
    }
    if (candidates.length > 0) {
      console.log(`[CATALYST] Wrote ${candidates.length} candidates to research_stars: ${candidates.map(c => `${c.symbol}(${c.catalystType})`).join(', ')}`);
    } else {
      console.log('[CATALYST] No candidates found this scan.');
    }
  }
}

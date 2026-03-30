/**
 * Brain MCP Server Client — MTWM Trading Integration
 *
 * Connects to brain.oceanicai.io (RuVector PI MCP) for persistent memory.
 * Brain is the single source of truth for trade intelligence.
 *
 * Brain API requirements:
 *   POST /v1/memories — { content, category, title, tags, source? }
 *     category must be one of: finance, custom, pattern, solution, etc.
 *   GET  /v1/memories/search?q=...&limit=N — returns array of memories
 *     Response includes: id, category, title, content, tags (NO metadata)
 *   POST /v1/train — { input, output, metadata? } — SONA learning
 *   POST /v1/transfer — { source_domain, query } — cross-domain reasoning
 */

const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://brain.oceanicai.io';
const SOURCE = 'mtwm';

async function brainFetch(path: string, opts?: RequestInit): Promise<any> {
  try {
    const apiKey = process.env.BRAIN_API_KEY || '';
    const res = await fetch(`${BRAIN_URL}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        ...opts?.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[brain] ${opts?.method || 'GET'} ${path} → ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    return res.json();
  } catch (e: any) {
    console.error(`[brain] ${path} failed: ${e.message}`);
    return null;
  }
}

export class BrainClient {
  private connected = false;

  async checkHealth(): Promise<boolean> {
    const r = await brainFetch('/v1/health');
    this.connected = !!r?.status;
    return this.connected;
  }

  // ── Record trade outcomes ──────────────────────────────────────────

  async recordTradeClose(ticker: string, pnl: number, returnPct: number, reason: string, direction: string): Promise<void> {
    const success = pnl > 0;
    const result = success ? 'WIN' : 'LOSS';
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        category: 'finance',
        title: `Trade ${result}: ${ticker} ${direction} $${pnl.toFixed(2)}`,
        content: `TRADE CLOSED: ${ticker} ${direction} | P&L: $${pnl.toFixed(2)} (${(returnPct * 100).toFixed(1)}%) | Reason: ${reason} | ${result} | ${new Date().toISOString()}`,
        tags: ['trade', 'outcome', result.toLowerCase(), ticker.toLowerCase(), reason, direction],
        source: `${SOURCE}:trade-closed`,
      }),
    });
  }

  async recordBuy(ticker: string, qty: number, price: number, catalyst: string): Promise<void> {
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        category: 'finance',
        title: `Buy: ${qty} ${ticker} @$${price.toFixed(2)}`,
        content: `BOUGHT: ${qty} ${ticker} @$${price.toFixed(2)} | Catalyst: ${catalyst} | ${new Date().toISOString()}`,
        tags: ['trade', 'entry', 'buy', ticker.toLowerCase(), 'momentum'],
        source: `${SOURCE}:trade-opened`,
      }),
    });
  }

  // ── Query before buying ────────────────────────────────────────────
  //
  // Brain search returns content/title/tags but NOT metadata.
  // We parse win/loss from tags and content instead.

  async getTickerHistory(ticker: string): Promise<{ wins: number; losses: number; avgReturn: number; shouldAvoid: boolean }> {
    const results = await brainFetch(`/v1/memories/search?q=${encodeURIComponent(ticker + ' trade outcome')}&limit=30`);
    if (!results || !Array.isArray(results) || results.length === 0) {
      return { wins: 0, losses: 0, avgReturn: 0, shouldAvoid: false };
    }

    let wins = 0, losses = 0, totalReturn = 0, count = 0;
    for (const m of results) {
      // Only match trade outcomes for this specific ticker
      if (!m.tags?.includes(ticker.toLowerCase()) || !m.tags?.includes('outcome')) continue;

      if (m.tags.includes('win')) wins++;
      else if (m.tags.includes('loss')) losses++;
      count++;

      // Parse P&L percentage from content: "P&L: $X.XX (Y.Y%)"
      const pctMatch = m.content?.match(/\((-?[\d.]+)%\)/);
      if (pctMatch) totalReturn += parseFloat(pctMatch[1]) / 100;
    }

    const avgReturn = count > 0 ? totalReturn / count : 0;
    const winRate = count > 0 ? wins / count : 0.5;
    const shouldAvoid = count >= 5 && winRate < 0.35;

    return { wins, losses, avgReturn, shouldAvoid };
  }

  // ── Bulk fetch trade outcomes (for Bayesian reconstruction on startup) ──

  async getRecentTradeOutcomes(limit = 200): Promise<Array<{ ticker: string; success: boolean; returnPct: number; reason: string }>> {
    const results = await brainFetch(`/v1/memories/search?q=${encodeURIComponent('TRADE CLOSED')}&limit=${limit}`);
    if (!results || !Array.isArray(results)) return [];

    const outcomes: Array<{ ticker: string; success: boolean; returnPct: number; reason: string }> = [];
    for (const m of results) {
      if (!m.tags?.includes('outcome')) continue;

      // Parse ticker from tags (lowercase ticker tag that isn't a known keyword)
      const knownTags = new Set(['trade', 'outcome', 'win', 'loss', 'stop_loss', 'take_profit', 'eod_close', 'trailing_stop', 'circuit_breaker', 'rotation', 'long', 'short', 'momentum', 'entry', 'buy']);
      const ticker = m.tags.find((t: string) => !knownTags.has(t) && t.length >= 1 && t.length <= 10)?.toUpperCase();
      if (!ticker) continue;

      const success = m.tags.includes('win');
      let returnPct = 0;
      const pctMatch = m.content?.match(/\((-?[\d.]+)%\)/);
      if (pctMatch) returnPct = parseFloat(pctMatch[1]) / 100;

      const reason = m.tags.find((t: string) => ['stop_loss', 'take_profit', 'eod_close', 'trailing_stop', 'circuit_breaker', 'rotation'].includes(t)) || 'unknown';

      outcomes.push({ ticker, success, returnPct, reason });
    }
    return outcomes;
  }

  // ── Push beliefs to SONA training ──────────────────────────────────

  async syncBeliefsToSona(beliefs: Array<{ id: string; subject: string; posterior: number; observations: number; avgReturn: number }>): Promise<void> {
    for (const belief of beliefs.slice(0, 50)) {
      await brainFetch('/v1/train', {
        method: 'POST',
        body: JSON.stringify({
          input: `ticker:${belief.subject} posterior:${belief.posterior.toFixed(3)} obs:${belief.observations} avgReturn:${belief.avgReturn.toFixed(3)}`,
          output: belief.posterior > 0.6 ? 'prefer' : belief.posterior < 0.4 ? 'avoid' : 'neutral',
        }),
      });
    }
  }

  // ── Reasoning — ask Brain for trading advice ───────────────────────

  async shouldBuy(ticker: string, percentChange: number, context: string): Promise<{ should: boolean; reason: string }> {
    const r = await brainFetch('/v1/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source_domain: 'finance',
        query: `Should MTWM trading desk buy ${ticker} which is up ${percentChange.toFixed(1)}% today? ${context}. This is a momentum day-trading strategy — buy movers at open, sell before close.`,
      }),
    });

    if (!r?.response) return { should: true, reason: 'Brain unavailable — default allow' };

    const response = typeof r.response === 'string' ? r.response : JSON.stringify(r.response);
    const isNegative = /avoid|no|don't|skip|risky|overextended/i.test(response);
    return { should: !isNegative, reason: response.substring(0, 200) };
  }

  // ── Record daily summary ───────────────────────────────────────────

  async recordDailySummary(date: string, pnl: number, trades: number, winners: number, losers: number): Promise<void> {
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        category: 'finance',
        title: `Daily summary ${date}: $${pnl.toFixed(2)} (${winners}W/${losers}L)`,
        content: `DAILY SUMMARY ${date}: P&L $${pnl.toFixed(2)} | ${trades} trades (${winners}W/${losers}L) | ${winners > losers ? 'POSITIVE' : 'NEGATIVE'} day`,
        tags: ['daily', 'summary', pnl > 0 ? 'profit' : 'loss', date],
        source: `${SOURCE}:daily-summary`,
      }),
    });
  }

  // ── Record rules/patterns ──────────────────────────────────────────

  async recordRule(rule: string, ruleSource: string): Promise<void> {
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        category: 'finance',
        title: `Trading rule (${ruleSource})`,
        content: `TRADING RULE: ${rule}`,
        tags: ['rule', 'trading', ruleSource],
        source: `${SOURCE}:rule`,
      }),
    });
  }

  isConnected(): boolean { return this.connected; }
}

// Singleton
export const brain = new BrainClient();

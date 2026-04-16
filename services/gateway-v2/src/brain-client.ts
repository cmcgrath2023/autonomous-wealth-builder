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

const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://trident.cetaceanlabs.com';
const SOURCE = 'mtwm';

// Brain tags must be <= 30 chars
function sanitizeTags(tags: string[]): string[] {
  return tags.map(t => t.slice(0, 30).toLowerCase().replace(/[^a-z0-9_\-/]/g, '_'));
}

async function brainFetch(path: string, opts?: RequestInit): Promise<any> {
  try {
    const apiKey = process.env.BRAIN_API_KEY || '';
    // Auto-sanitize tags in POST bodies
    if (opts?.body && typeof opts.body === 'string') {
      try {
        const parsed = JSON.parse(opts.body);
        if (parsed.tags && Array.isArray(parsed.tags)) {
          parsed.tags = sanitizeTags(parsed.tags);
          opts = { ...opts, body: JSON.stringify(parsed) };
        }
      } catch {}
    }
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
    // Must be Trident specifically — brain.oceanicai.io is a different server that doesn't persist
    this.connected = !!(r?.status && (r?.service === 'trident' || r?.database === 'connected'));
    if (r && !this.connected) {
      console.error(`[brain] Health responded but NOT Trident (got: ${JSON.stringify(r).slice(0, 100)}). Check BRAIN_SERVER_URL.`);
    }
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
    // Search for the exact title format we write: "Trade WIN: TICKER" or "Trade LOSS: TICKER"
    const results = await brainFetch(`/v1/memories/search?q=${encodeURIComponent('Trade ' + ticker)}&limit=30`);
    if (!results || !Array.isArray(results) || results.length === 0) {
      return { wins: 0, losses: 0, avgReturn: 0, shouldAvoid: false };
    }

    let wins = 0, losses = 0, totalReturn = 0, count = 0;
    for (const m of results) {
      // Parse from TITLE (authoritative — always present in the response).
      // Title format: "Trade WIN: NVDA long $105.20" or "Trade LOSS: AFJKU long $-6411.87"
      // Trident search does NOT return tags reliably — so we match on the title string.
      const title = m.title || '';
      if (!title.includes('Trade ') || !title.toUpperCase().includes(ticker.toUpperCase())) continue;

      // Skip regret signals — those are post-exit tracking memories, not real trades.
      // They use "Reason: regret:..." in content and pnl=0.
      if (m.content?.includes('regret:')) continue;

      const isWin = title.includes('WIN');
      const isLoss = title.includes('LOSS');
      if (!isWin && !isLoss) continue;

      if (isWin) wins++;
      else losses++;
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
      // Parse from TITLE — Trident's search doesn't reliably return tags.
      // Title format: "Trade WIN: NVDA long $105.20" or "Trade LOSS: AFJKU long $-6411.87"
      const title = m.title || '';
      const titleMatch = title.match(/^Trade (WIN|LOSS): (\S+)\s+(long|short)/);
      if (!titleMatch) continue;
      // Skip regret signals — post-exit tracking memories, not real trades
      if (m.content?.includes('regret:')) continue;

      const success = titleMatch[1] === 'WIN';
      const ticker = titleMatch[2].toUpperCase();
      if (!ticker || ticker.length < 1 || ticker.length > 10) continue;

      let returnPct = 0;
      const pctMatch = m.content?.match(/\((-?[\d.]+)%\)/);
      if (pctMatch) returnPct = parseFloat(pctMatch[1]) / 100;

      // Parse reason from content: "Reason: stop_loss"
      const reasonMatch = m.content?.match(/Reason:\s*(\S+)/);
      const reason = reasonMatch ? reasonMatch[1] : 'unknown';

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

  // ── Reasoning — should we buy this ticker? ───────────────────────
  // Uses Brain memory search to find past trade outcomes + SONA training data.
  // NOT the /v1/transfer endpoint (that does domain transfer, not reasoning).

  async shouldBuy(ticker: string, percentChange: number, context: string): Promise<{ should: boolean; reason: string }> {
    // Use getTickerHistory which parses WIN/LOSS from TITLES (reliable)
    // instead of the old tag-based approach (tags are undefined in search results).
    // The old code was blocking NVDA (2W/0L) because it found "loss" in
    // research memory content, while approving BTFL (0W/2L) because tags
    // were undefined so it fell through to "no trade history."
    const history = await this.getTickerHistory(ticker);
    const total = history.wins + history.losses;

    if (total === 0) {
      // No trade history at all — allow (new ticker, thesis gate is the real filter)
      return { should: true, reason: `${ticker}: no trade history — allowing (thesis gate decides)` };
    }

    // Has history — use it
    if (history.shouldAvoid) {
      return { should: false, reason: `${ticker}: ${history.wins}W/${history.losses}L avg ${(history.avgReturn*100).toFixed(1)}% — AVOID (bad track record)` };
    }

    const winRate = total > 0 ? history.wins / total : 0.5;

    // Reject: 0 wins out of 2+ trades — known loser, don't touch
    if (history.wins === 0 && history.losses >= 2) {
      return { should: false, reason: `${ticker}: 0W/${history.losses}L — known loser, blocking` };
    }

    // Reject: <35% win rate with 2+ trades
    if (total >= 2 && winRate < 0.35) {
      return { should: false, reason: `${ticker}: ${history.wins}W/${history.losses}L (${(winRate*100).toFixed(0)}%) — reject (below 35%)` };
    }

    // Reject: <50% with 4+ trades
    if (total >= 4 && winRate < 0.50) {
      return { should: false, reason: `${ticker}: ${history.wins}W/${history.losses}L (${(winRate*100).toFixed(0)}%) — reject (below 50% with ${total} trades)` };
    }

    return { should: true, reason: `${ticker}: ${history.wins}W/${history.losses}L (${(winRate*100).toFixed(0)}%) avg ${(history.avgReturn*100).toFixed(1)}% — approved` };
  }

  // ── Reasoning — should we sell this position? ─────────────────

  async shouldSell(ticker: string, pnlPct: number, pnlDollars: number, holdTimeMinutes: number): Promise<{ should: boolean; reason: string }> {
    const history = await this.getTickerHistory(ticker);

    // If ticker has strong loss history, cut faster
    if (history.wins + history.losses >= 3 && history.avgReturn < -0.03) {
      if (pnlPct < 0) {
        return { should: true, reason: `${ticker}: losing (${(pnlPct*100).toFixed(1)}%) + bad history (avg ${(history.avgReturn*100).toFixed(1)}%) — sell` };
      }
    }

    // If ticker historically wins and we're down small, hold
    if (history.wins > history.losses && pnlPct > -0.03) {
      return { should: false, reason: `${ticker}: ${(pnlPct*100).toFixed(1)}% but ${history.wins}W/${history.losses}L — hold (historically wins)` };
    }

    // If held too long with no progress (>3 hours, still near breakeven), consider selling
    if (holdTimeMinutes > 180 && Math.abs(pnlPct) < 0.01) {
      return { should: true, reason: `${ticker}: flat after ${(holdTimeMinutes/60).toFixed(1)}h — sell (dead money)` };
    }

    // Default: hold
    return { should: false, reason: `${ticker}: ${(pnlPct*100).toFixed(1)}% — hold (no sell signal)` };
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

  // ── Record research cycle to Trident ────────────────────────────

  async recordResearchCycle(data: { date: string; starsCount: number; topStars: Array<{ symbol: string; sector: string; score: number }>; summary: string; newsHeadlines: string; errors: string[] }): Promise<void> {
    const topList = data.topStars.slice(0, 5).map(s => `${s.symbol}(${s.score.toFixed(2)})`).join(', ');
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        category: 'finance',
        title: `Research cycle: ${data.starsCount} stars — top: ${topList}`,
        content: `RESEARCH CYCLE ${data.date}\nStars: ${data.starsCount}\n\nTop picks:\n${data.summary}\n\nBullish headlines:\n${data.newsHeadlines || 'None'}\n\nErrors: ${data.errors.length > 0 ? data.errors.join('; ') : 'None'}`,
        tags: sanitizeTags(['research', 'cycle', 'stars', ...data.topStars.slice(0, 5).map(s => s.symbol.toLowerCase())]),
        source: `${SOURCE}:research-worker`,
      }),
    });
  }

  isConnected(): boolean { return this.connected; }
}

// Singleton
export const brain = new BrainClient();

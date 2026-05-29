/**
 * Brain MCP Server Client — MTWM Trading Integration
 *
 * Connects to brain.oceanicai.io (RuVector PI MCP) for persistent memory.
 * Brain is the single source of truth for trade intelligence.
 *
 * Brain API requirements:
 *   POST /v1/memories — { content, category, title, tags, source? }
 *     category must be one of: finance, custom, pattern, solution, etc.
 *   GET  /v1/memories/search?q=...&limit=N&domain=X — returns array of memories
 *     Response includes: id, category, title, content, tags (NO metadata)
 *     domain param scopes search: avoid, trade_outcome, buffett_core, etc.
 *   POST /v1/train — { input, output, metadata?, domain? } — SONA learning
 *   POST /v1/transfer — { source_domain, query } — cross-domain reasoning
 *   GET  /v1/sona/domains — list available domains
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
        domain: 'trade_outcome',
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

  async recordOwnerEntry(ticker: string, qty: number, price: number, side: 'long' | 'short' = 'long'): Promise<void> {
    const ts = new Date().toISOString();
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        domain: 'owner_action',
        category: 'finance',
        title: `Owner manual entry: ${ticker} ${side} ${qty} @$${price.toFixed(2)}`,
        content: `OWNER MANUAL ENTRY: ${ticker} ${side} | qty=${qty} | price=$${price.toFixed(2)} | Source: Alpaca fill reconciliation | ${ts}`,
        tags: ['trade', 'entry', 'owner_manual', ticker.toLowerCase(), side],
        source: `${SOURCE}:owner-manual-entry`,
      }),
    });
    await brainFetch('/v1/train', {
      method: 'POST',
      body: JSON.stringify({
        input: `Owner manual entry: ${ticker} ${side} qty=${qty} price=$${price.toFixed(2)}`,
        output: 'owner_selected_trade',
        domain: 'owner_action',
        metadata: { ticker, qty, price, side, source: 'owner_manual', timestamp: ts },
      }),
    });
  }

  // ── Query before buying ────────────────────────────────────────────
  //
  // Brain search returns content/title/tags but NOT metadata.
  // We parse win/loss from tags and content instead.

  async getTickerHistory(ticker: string): Promise<{ wins: number; losses: number; avgReturn: number; shouldAvoid: boolean }> {
    // Domain-scoped search: trade_outcome returns only WIN/LOSS records
    // Falls back to keyword search if domain is empty (migration in progress)
    let results = await brainFetch(`/v1/memories/search?q=${encodeURIComponent(ticker)}&domain=trade_outcome&limit=30`);
    if (!results || !Array.isArray(results) || results.length === 0) {
      results = await brainFetch(`/v1/memories/search?q=${encodeURIComponent('Trade ' + ticker)}&limit=30`);
    }
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

      // Skip raw regret signals (pnl=0, reason like "regret:sold_right")
      // BUT keep regret AMENDMENTS — those are corrected outcomes where
      // post-exit analysis showed the pick was RIGHT but exit was WRONG.
      // Amendments have content "TRADE AMENDED:" and title "Trade WIN:"
      // This means BIRD goes from 0W/2L to 1W/2L after the 600% regret
      // amendment lands — shouldBuy sees "mixed history" instead of "pure loser."
      if (m.content?.includes('regret:') && !m.content?.includes('TRADE AMENDED')) continue;

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
      // Skip raw regret signals but keep amendments (correct picks, wrong exits)
      if (m.content?.includes('regret:') && !m.content?.includes('TRADE AMENDED')) continue;

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
    // 1. Check SONA avoid domain — explicit "avoid" flags (owner preferences, blacklist)
    // Falls back to keyword search if domain=avoid is empty (migration in progress)
    try {
      let sonaResults = await brainFetch(`/v1/memories/search?q=${encodeURIComponent(ticker)}&domain=avoid&limit=5`);
      if (!Array.isArray(sonaResults) || sonaResults.length === 0) {
        // Fallback: unscoped keyword search until avoid domain is populated
        sonaResults = await brainFetch(`/v1/memories/search?q=${encodeURIComponent(ticker + ' avoid OR blacklist')}&limit=5`);
      }
      if (Array.isArray(sonaResults)) {
        for (const m of sonaResults) {
          const content = (m.content || m.title || '').toLowerCase();
          if (content.includes(ticker.toLowerCase()) && (content.includes('avoid') || content.includes('blacklist') || content.includes('do not buy'))) {
            return { should: false, reason: `${ticker}: SONA flag — ${(m.title || m.content || '').slice(0, 80)}` };
          }
        }
      }
    } catch {} // SONA unavailable — proceed without

    // 2. Check Buffett quality — domain-scoped, falls back to keyword
    let buffettTier = '';
    try {
      let buffettResults = await brainFetch(`/v1/memories/search?q=${encodeURIComponent(ticker)}&domain=buffett_core&limit=3`);
      if (!Array.isArray(buffettResults) || buffettResults.length === 0) {
        buffettResults = await brainFetch(`/v1/memories/search?q=${encodeURIComponent('BUFFETT ' + ticker)}&limit=3`);
      }
      if (Array.isArray(buffettResults)) {
        for (const m of buffettResults) {
          const content = (m.content || m.title || '').toUpperCase();
          if (content.includes(ticker.toUpperCase())) {
            if (content.includes('CORE HOLDING')) buffettTier = 'core';
            else if (content.includes('KEY INVESTMENT')) buffettTier = 'key';
            else if (content.includes('OWNER FAVOR') || content.includes('OWNER PREFER')) buffettTier = 'owner_favorite';
          }
        }
      }
    } catch {}

    // 3. Check trade history (WIN/LOSS counts from memory)
    const history = await this.getTickerHistory(ticker);
    const total = history.wins + history.losses;

    if (total === 0) {
      const qual = buffettTier ? ` [Buffett ${buffettTier}]` : '';
      return { should: true, reason: `${ticker}: no trade history${qual} — allowing` };
    }

    // Check for data corrections — old engine poisoned some tickers' history
    if (history.shouldAvoid || (history.wins === 0 && history.losses >= 2)) {
      try {
        const correctionResults = await brainFetch(`/v1/memories/search?q=${encodeURIComponent(ticker + ' CORRECTION')}&domain=trade_outcome&limit=3`);
        if (Array.isArray(correctionResults)) {
          for (const m of correctionResults) {
            const content = (m.content || m.title || '').toUpperCase();
            if (content.includes(ticker.toUpperCase()) && content.includes('CORRECTION')) {
              // Data is known-poisoned — allow through with warning
              return { should: true, reason: `${ticker}: ${history.wins}W/${history.losses}L — DATA CORRECTED (old engine noise), allowing${buffettTier ? ` [Buffett ${buffettTier}]` : ''}` };
            }
          }
        }
      } catch {}
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

    // Buffett-quality stocks get more lenient thresholds — these are proven businesses
    // that may have short-term losses but are fundamentally sound
    const isBuffett = !!buffettTier;
    const minWinRate2 = isBuffett ? 0.25 : 0.35;  // Buffett stocks: 25% vs normal 35%
    const minWinRate4 = isBuffett ? 0.35 : 0.50;  // Buffett stocks: 35% vs normal 50%

    // Reject: <35% win rate with 2+ trades (25% for Buffett)
    if (total >= 2 && winRate < minWinRate2) {
      return { should: false, reason: `${ticker}: ${history.wins}W/${history.losses}L (${(winRate*100).toFixed(0)}%) — reject (below ${(minWinRate2*100).toFixed(0)}%${isBuffett ? ' Buffett' : ''})` };
    }

    // Reject: <50% with 4+ trades (35% for Buffett)
    if (total >= 4 && winRate < minWinRate4) {
      return { should: false, reason: `${ticker}: ${history.wins}W/${history.losses}L (${(winRate*100).toFixed(0)}%) — reject (below ${(minWinRate4*100).toFixed(0)}% with ${total} trades${isBuffett ? ' Buffett' : ''})` };
    }

    const qual = buffettTier ? ` [Buffett ${buffettTier}]` : '';
    return { should: true, reason: `${ticker}: ${history.wins}W/${history.losses}L (${(winRate*100).toFixed(0)}%) avg ${(history.avgReturn*100).toFixed(1)}%${qual} — approved` };
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

  async recordLearningNote(note: {
    title: string;
    content: string;
    tags?: string[];
    category?: 'finance' | 'custom' | 'pattern' | 'solution';
    source?: string;
  }): Promise<boolean> {
    const result = await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        category: note.category || 'pattern',
        title: note.title,
        content: `LEARNING NOTE: ${note.content}\n\nRecorded: ${new Date().toISOString()}`,
        tags: sanitizeTags(['learning-note', ...(note.tags || [])]),
        source: note.source || `${SOURCE}:learning-note`,
      }),
    });
    return !!result;
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

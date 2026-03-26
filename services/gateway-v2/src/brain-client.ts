/**
 * Brain MCP Server Client — MTWM Trading Integration
 *
 * Connects to brain.oceanicai.io for persistent memory across restarts.
 * Replaces SQLite-based Bayesian persistence with SONA learning.
 *
 * Every trade outcome → Brain memory
 * Every buy decision → Brain query for ticker history
 * Bayesian beliefs → Brain SONA training
 */

const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://brain.oceanicai.io';
const SOURCE = 'mtwm:trading-desk';

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
    if (!res.ok) return null;
    return res.json();
  } catch {
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
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: `TRADE CLOSED: ${ticker} ${direction} | P&L: $${pnl.toFixed(2)} (${(returnPct * 100).toFixed(1)}%) | Reason: ${reason} | ${success ? 'WIN' : 'LOSS'}`,
        source: `${SOURCE}:trade-closed`,
        metadata: {
          domain: 'trading',
          type: 'trade_outcome',
          ticker,
          pnl,
          returnPct,
          reason,
          direction,
          success,
          timestamp: new Date().toISOString(),
        },
      }),
    });
  }

  async recordBuy(ticker: string, qty: number, price: number, catalyst: string): Promise<void> {
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: `BOUGHT: ${qty} ${ticker} @$${price.toFixed(2)} | Catalyst: ${catalyst}`,
        source: `${SOURCE}:trade-opened`,
        metadata: {
          domain: 'trading',
          type: 'trade_entry',
          ticker,
          qty,
          price,
          catalyst,
          timestamp: new Date().toISOString(),
        },
      }),
    });
  }

  // ── Query before buying ────────────────────────────────────────────

  async getTickerHistory(ticker: string): Promise<{ wins: number; losses: number; avgReturn: number; shouldAvoid: boolean }> {
    const results = await brainFetch(`/v1/memories/search?q=${encodeURIComponent(ticker + ' trade outcome')}&limit=20`);
    if (!results?.memories?.length) return { wins: 0, losses: 0, avgReturn: 0, shouldAvoid: false };

    let wins = 0, losses = 0, totalReturn = 0, count = 0;
    for (const m of results.memories) {
      if (m.metadata?.ticker === ticker && m.metadata?.type === 'trade_outcome') {
        if (m.metadata.success) wins++; else losses++;
        totalReturn += m.metadata.returnPct || 0;
        count++;
      }
    }

    const avgReturn = count > 0 ? totalReturn / count : 0;
    const winRate = count > 0 ? wins / count : 0.5;
    // Avoid tickers with 5+ trades and <35% win rate
    const shouldAvoid = count >= 5 && winRate < 0.35;

    return { wins, losses, avgReturn, shouldAvoid };
  }

  // ── Push Bayesian beliefs to SONA ──────────────────────────────────

  async syncBayesianToSona(beliefs: Array<{ id: string; subject: string; posterior: number; observations: number; avgReturn: number }>): Promise<void> {
    for (const belief of beliefs.slice(0, 50)) { // batch limit
      await brainFetch('/v1/train', {
        method: 'POST',
        body: JSON.stringify({
          input: `ticker:${belief.subject} posterior:${belief.posterior.toFixed(3)} obs:${belief.observations}`,
          output: belief.posterior > 0.6 ? 'prefer' : belief.posterior < 0.4 ? 'avoid' : 'neutral',
          metadata: {
            domain: 'bayesian_belief',
            beliefId: belief.id,
            subject: belief.subject,
            posterior: belief.posterior,
            observations: belief.observations,
            avgReturn: belief.avgReturn,
          },
        }),
      });
    }
  }

  // ── Reasoning — ask Brain for trading advice ───────────────────────

  async shouldBuy(ticker: string, percentChange: number, context: string): Promise<{ should: boolean; reason: string }> {
    const r = await brainFetch('/v1/transfer', {
      method: 'POST',
      body: JSON.stringify({
        prompt: `Should MTWM trading desk buy ${ticker} which is up ${percentChange.toFixed(1)}% today?`,
        context: `${context}\nThis is a momentum day-trading strategy. We buy movers at open and sell before close. Check our history with this ticker and similar movers.`,
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
        content: `DAILY SUMMARY ${date}: P&L $${pnl.toFixed(2)} | ${trades} trades (${winners}W/${losers}L) | ${winners > losers ? 'POSITIVE' : 'NEGATIVE'} day`,
        source: `${SOURCE}:daily-summary`,
        metadata: {
          domain: 'trading',
          type: 'daily_summary',
          date,
          pnl,
          trades,
          winners,
          losers,
        },
      }),
    });
  }

  // ── Record rules/patterns ──────────────────────────────────────────

  async recordRule(rule: string, source: string): Promise<void> {
    await brainFetch('/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: `TRADING RULE: ${rule}`,
        source: `${SOURCE}:rule`,
        metadata: { domain: 'trading', type: 'rule', ruleSource: source },
      }),
    });
  }

  isConnected(): boolean { return this.connected; }
}

// Singleton
export const brain = new BrainClient();

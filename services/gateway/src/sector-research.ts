/**
 * Sector Research Agent — Focused research on specific market sectors
 *
 * Uses FACT Cache to avoid redundant analysis and promotes instruments
 * to researchStars for the neural trader to act on.
 *
 * Sectors: Energy, Defense, Metals/Rare Earth, AI/Infrastructure, Crypto Macro
 */

import { MarketFACTCache } from '../../shared/src/fact-cache.js';

interface SectorDeps {
  factCache: MarketFACTCache;
  researchStars: Map<string, { symbol: string; sector: string; catalyst: string; score: number; timestamp: number }>;
  midstream: { getLatestQuote(ticker: string): { price: number; changePercent?: number } | null };
  bayesianIntel: { recordOutcome(id: string, ctx: any, success: boolean, value?: number): void };
  saveResearchReport: (report: any) => void;
}

interface SectorConfig {
  name: string;
  tickers: string[];
  catalystKeywords: string[];
  etfs?: string[];
}

const SECTORS: Record<string, SectorConfig> = {
  energy: {
    name: 'Energy',
    tickers: ['XOM', 'HAL', 'CVX', 'KOS', 'OXY', 'SLB', 'EOG', 'PXD', 'DVN', 'MPC'],
    etfs: ['USO', 'UNG', 'XLE'],
    catalystKeywords: ['oil', 'crude', 'iran', 'opec', 'strait', 'energy', 'pipeline', 'lng'],
  },
  defense: {
    name: 'Defense',
    tickers: ['RTX', 'LMT', 'NOC', 'GD', 'BA', 'LHX', 'HII', 'LDOS', 'BWXT'],
    etfs: ['ITA'],
    catalystKeywords: ['war', 'military', 'defense', 'iran', 'missile', 'conflict', 'pentagon'],
  },
  metals: {
    name: 'Metals & Rare Earth',
    tickers: ['FCX', 'AA', 'MP', 'NEM', 'GOLD', 'WPM', 'LTHM', 'LAC', 'ALB'],
    etfs: ['GLD', 'SLV', 'GDXJ', 'COPX', 'CPER'],
    catalystKeywords: ['gold', 'copper', 'aluminum', 'rare earth', 'mining', 'metal', 'silver'],
  },
  ai_infrastructure: {
    name: 'AI & Data Center',
    tickers: ['NVDA', 'VRT', 'NRG', 'EQIX', 'NET', 'SMCI', 'ARM', 'MRVL', 'AVGO', 'ANET'],
    etfs: ['SMH'],
    catalystKeywords: ['ai', 'data center', 'gpu', 'semiconductor', 'cloud', 'nvidia', 'chip'],
  },
  crypto_macro: {
    name: 'Crypto Macro',
    tickers: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD', 'DOT-USD'],
    etfs: [],
    catalystKeywords: ['bitcoin', 'crypto', 'ethereum', 'defi', 'regulation', 'sec', 'etf approval'],
  },
};

function analyzeSector(deps: SectorDeps, config: SectorConfig): {
  condition: string;
  movers: Array<{ ticker: string; price: number; change: number }>;
  topPicks: string[];
  narrative: string;
} {
  const movers: Array<{ ticker: string; price: number; change: number }> = [];
  const allTickers = [...config.tickers, ...(config.etfs || [])];

  for (const ticker of allTickers) {
    const quote = deps.midstream.getLatestQuote(ticker);
    if (quote && quote.price > 0) {
      movers.push({ ticker, price: quote.price, change: quote.changePercent || 0 });
    }
  }

  movers.sort((a, b) => b.change - a.change);

  const positiveCount = movers.filter(m => m.change > 0).length;
  const condition = positiveCount > movers.length * 0.6 ? 'bullish'
    : positiveCount < movers.length * 0.4 ? 'bearish' : 'mixed';

  // Top picks: highest gainers that are in the primary ticker list (not ETFs)
  const topPicks = movers
    .filter(m => config.tickers.includes(m.ticker) && m.change > 0)
    .slice(0, 4)
    .map(m => m.ticker);

  // If bearish, pick inverse/hedge plays
  if (condition === 'bearish' && topPicks.length === 0) {
    topPicks.push(...(config.etfs || []).slice(0, 2));
  }

  const topMoversStr = movers.slice(0, 3).map(m => `${m.ticker} ${m.change > 0 ? '+' : ''}${m.change.toFixed(1)}%`).join(', ');
  const narrative = `${config.name} sector is ${condition}. ${movers.length} instruments tracked. Top: ${topMoversStr || 'no data'}. ${topPicks.length > 0 ? `Favoring: ${topPicks.join(', ')}` : 'No strong picks.'}`;

  return { condition, movers, topPicks, narrative };
}

function createSectorAction(deps: SectorDeps, sectorKey: string, config: SectorConfig) {
  return async (): Promise<{ detail: string; result: string }> => {
    // Step 1: Analyze sector
    const analysis = analyzeSector(deps, config);

    // Step 2: Check FACT cache
    const cacheResult = deps.factCache.lookup(config.name, config.catalystKeywords[0] || 'general', analysis.condition);

    let strategy: string;
    let instruments: string[];
    let reasoning: string;

    if (cacheResult.hit && cacheResult.pattern) {
      // Cache hit — use proven strategy
      strategy = cacheResult.pattern.strategy;
      instruments = cacheResult.pattern.instruments;
      reasoning = `FACT ${cacheResult.tier}: ${cacheResult.pattern.reasoning} (${cacheResult.latencyMs}ms, used ${cacheResult.pattern.timesUsed}x, ${(cacheResult.pattern.successRate * 100).toFixed(0)}% success)`;
    } else {
      // Cache miss — build fresh strategy
      if (analysis.condition === 'bullish' && analysis.topPicks.length > 0) {
        instruments = analysis.topPicks;
        strategy = `BUY ${instruments.join(', ')} — ${config.name} sector bullish, momentum with catalyst backing.`;
        reasoning = `${analysis.narrative}. Fresh analysis — no cached strategy.`;
      } else if (analysis.condition === 'bearish') {
        instruments = config.etfs?.slice(0, 2) || [];
        strategy = `DEFENSIVE: ${instruments.length > 0 ? `Consider hedges via ${instruments.join(', ')}` : 'Reduce exposure'}. ${config.name} sector bearish.`;
        reasoning = analysis.narrative;
      } else {
        instruments = analysis.topPicks.length > 0 ? analysis.topPicks.slice(0, 2) : [];
        strategy = instruments.length > 0 ? `SELECTIVE: ${instruments.join(', ')} — mixed sector, only top movers.` : `WAIT — ${config.name} sector mixed, no clear plays.`;
        reasoning = analysis.narrative;
      }

      // Store in FACT cache
      deps.factCache.store(config.name, config.catalystKeywords[0] || 'general', analysis.condition, strategy, instruments, reasoning);
    }

    // Step 3: Promote instruments to researchStars
    for (const ticker of instruments) {
      const score = analysis.condition === 'bullish' ? 0.85 : analysis.condition === 'mixed' ? 0.72 : 0.55;
      deps.researchStars.set(ticker, {
        symbol: ticker,
        sector: config.name,
        catalyst: `NEWS: ${config.name} sector ${analysis.condition}. ${strategy.substring(0, 60)}`,
        score,
        timestamp: Date.now(),
      });
    }

    // Step 4: Record Bayesian outcome for previous strategy if exists
    if (cacheResult.hit && cacheResult.pattern) {
      // Check if previous instruments made money
      const prevInstruments = cacheResult.pattern.instruments;
      let wins = 0;
      for (const t of prevInstruments) {
        const quote = deps.midstream.getLatestQuote(t);
        if (quote && (quote.changePercent || 0) > 0) wins++;
      }
      const success = wins > prevInstruments.length / 2;
      deps.factCache.recordOutcome(config.name, config.catalystKeywords[0] || 'general', analysis.condition, success);
      deps.bayesianIntel.recordOutcome(
        `sector:${sectorKey}`,
        { domain: 'sector_research', subject: config.name, tags: [sectorKey, analysis.condition] },
        success,
        wins / Math.max(1, prevInstruments.length),
      );
    }

    // Step 5: Save research report
    deps.saveResearchReport({
      id: `sector-${sectorKey}-${Date.now()}`,
      agent: 'sector-research',
      type: `sector_${sectorKey}`,
      timestamp: new Date().toISOString(),
      summary: `${config.name}: ${analysis.condition}. ${strategy}`,
      findings: [
        analysis.narrative,
        `FACT cache: ${cacheResult.hit ? `${cacheResult.tier} hit (${cacheResult.latencyMs}ms)` : 'miss — fresh analysis'}`,
        ...analysis.movers.slice(0, 6).map(m => `${m.ticker}: $${m.price.toFixed(2)} (${m.change > 0 ? '+' : ''}${m.change.toFixed(1)}%)`),
      ],
      signals: instruments.map(t => ({
        symbol: t,
        direction: analysis.condition === 'bearish' ? 'short' : 'long',
        signal: analysis.condition === 'bullish' ? 'BUY' : analysis.condition === 'bearish' ? 'SELL' : 'WAIT',
        detail: `${config.name} ${analysis.condition}`,
      })),
      strategy: {
        action: strategy,
        rationale: reasoning,
        risk: analysis.condition === 'bearish' ? 'Sector in decline — position small or hedge.' : 'Sector momentum can reverse on macro events.',
      },
      meta: { sector: sectorKey, condition: analysis.condition, instrumentCount: instruments.length, cacheHit: cacheResult.hit },
    });

    return {
      detail: `${config.name}: ${analysis.condition} | ${strategy.substring(0, 100)} | FACT: ${cacheResult.hit ? cacheResult.tier : 'miss'}`,
      result: instruments.length > 0 ? 'success' : 'skipped',
    };
  };
}

/**
 * Create sector research actions for the autonomy engine.
 * Returns a map of action functions keyed by 'sector-research:energy', etc.
 */
export function createSectorResearchActions(deps: SectorDeps): Record<string, () => Promise<{ detail: string; result: string }>> {
  const actions: Record<string, () => Promise<{ detail: string; result: string }>> = {};

  for (const [key, config] of Object.entries(SECTORS)) {
    actions[`sector-research:${key}`] = createSectorAction(deps, key, config);
  }

  return actions;
}

export { SECTORS };

/**
 * Ferd — Research Manager (OpenClaw Pattern)
 *
 * Monitors research quality on a 120-second heartbeat.
 * Tracks sector performance, promotes/demotes sectors,
 * manages FACT cache, and aligns research with Liza's catalysts.
 */

import { GatewayStateStore, ClosedTradeRow } from '../../../gateway/src/state-store.js';
import { brain } from '../brain-client.js';

const LOOP_MS = 120_000;
const MIN_TRADES_FOR_EVAL = 3;
const PROMOTE_THRESHOLD = 0.6;   // Win rate above 60% = promote
const DEMOTE_THRESHOLD = 0.35;   // Win rate below 35% = demote

interface SectorPerf {
  sector: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  status: 'promoted' | 'demoted' | 'neutral';
}

interface FerdStatus {
  lastCycle: string;
  cycleCount: number;
  sectorPerformance: SectorPerf[];
  recommendations: string[];
  factPruned: number;
  catalystAlignment: string[];
}

export class Ferd {
  private store: GatewayStateStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;
  private lastStatus: FerdStatus | null = null;

  constructor(dbPath: string) {
    this.store = new GatewayStateStore(dbPath);
  }

  async start(): Promise<void> {
    console.log('[Ferd] Research Manager starting — 120s loop');
    await this.cycle();
    this.timer = setInterval(() => {
      this.cycle().catch((e) => console.error('[Ferd] Cycle error (non-fatal):', e));
    }, LOOP_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { this.store.close(); } catch {}
    console.log('[Ferd] Stopped');
  }

  getStatus(): FerdStatus | null {
    return this.lastStatus;
  }

  private async cycle(): Promise<void> {
    this.cycleCount++;
    const now = new Date().toISOString();

    try {
      // 1. Analyze sector performance from closed trades
      const sectorPerf = this.analyzeSectorPerformance();

      // 2. Monitor research star quality
      const starQuality = this.evaluateStarQuality(sectorPerf);

      // 3. Write sector recommendations
      const recommendations = this.buildRecommendations(sectorPerf);
      this.store.set('research_recommendations', JSON.stringify({
        sectors: recommendations, updatedAt: now, updatedBy: 'ferd',
      }));

      // 4. Manage FACT cache — prune failed strategies
      const factPruned = this.manageFACTCache(sectorPerf);

      // 5. Coordinate with Liza's catalyst detection
      const catalystAlignment = this.alignWithCatalysts(sectorPerf);

      // 6. Read Warren's directive — act on it
      const warrenDirective = this.store.get('ferd:directive') || '';
      if (warrenDirective === 'urgent_research_needed') {
        console.log('[Ferd] Warren demands more picks — running urgent scan');
        // Record to Brain that research was inadequate
        brain.recordRule('Ferd: Warren flagged insufficient research stars — need broader scanning', 'ferd:directive').catch(() => {});
      }

      // 7. Every 10 cycles, query Brain for research patterns that worked
      if (this.cycleCount % 10 === 0) {
        try {
          const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://brain.oceanicai.io';
          const brainKey = process.env.BRAIN_API_KEY || '';
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (brainKey) headers['Authorization'] = `Bearer ${brainKey}`;

          const res = await fetch(`${BRAIN_URL}/v1/memories/search?q=profitable+trade+research+winner&limit=5`, {
            headers, signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = await res.json() as any;
            const patterns = (data.memories || data.results || []).slice(0, 3);
            if (patterns.length > 0) {
              console.log(`[Ferd] Brain patterns: ${patterns.map((p: any) => p.content?.substring(0, 60)).join(' | ')}`);
            }
          }
        } catch {}
      }

      // 8. Write status
      this.lastStatus = {
        lastCycle: now, cycleCount: this.cycleCount,
        sectorPerformance: sectorPerf, recommendations,
        factPruned, catalystAlignment,
      };
      this.store.set('manager_ferd_status', JSON.stringify(this.lastStatus));

      if (this.cycleCount % 3 === 1) {
        const promoted = sectorPerf.filter((s) => s.status === 'promoted').map((s) => s.sector);
        const demoted = sectorPerf.filter((s) => s.status === 'demoted').map((s) => s.sector);
        console.log(
          `[Ferd] #${this.cycleCount} | ${sectorPerf.length} sectors | ` +
          `Promoted: ${promoted.join(', ') || 'none'} | ` +
          `Demoted: ${demoted.join(', ') || 'none'} | ` +
          `FACT pruned: ${factPruned} | Stars: ${starQuality}`,
        );
      }
    } catch (e: any) {
      console.error(`[Ferd] Cycle #${this.cycleCount} error:`, e.message);
    }
  }

  private analyzeSectorPerformance(): SectorPerf[] {
    const trades = this.store.getClosedTrades(200);
    const stars = this.store.getResearchStars();

    // Map tickers to sectors via research stars
    const tickerSector = new Map<string, string>();
    for (const star of stars) tickerSector.set(star.symbol, star.sector);

    // Also infer sector from past trades by checking recent stars
    const sectorMap = new Map<string, ClosedTradeRow[]>();
    for (const trade of trades) {
      const sector = tickerSector.get(trade.ticker) || this.inferSector(trade.ticker);
      if (!sectorMap.has(sector)) sectorMap.set(sector, []);
      sectorMap.get(sector)!.push(trade);
    }

    const results: SectorPerf[] = [];
    for (const [sector, sectorTrades] of sectorMap) {
      const wins = sectorTrades.filter((t) => t.pnl > 0).length;
      const losses = sectorTrades.filter((t) => t.pnl <= 0).length;
      const totalPnl = sectorTrades.reduce((s, t) => s + t.pnl, 0);
      const winRate = sectorTrades.length > 0 ? wins / sectorTrades.length : 0;

      let status: SectorPerf['status'] = 'neutral';
      if (sectorTrades.length >= MIN_TRADES_FOR_EVAL) {
        if (winRate >= PROMOTE_THRESHOLD) status = 'promoted';
        else if (winRate < DEMOTE_THRESHOLD) status = 'demoted';
      }

      results.push({
        sector, trades: sectorTrades.length, wins, losses,
        winRate, totalPnl, avgPnl: sectorTrades.length > 0 ? totalPnl / sectorTrades.length : 0,
        status,
      });
    }

    results.sort((a, b) => b.totalPnl - a.totalPnl);
    return results;
  }

  private inferSector(ticker: string): string {
    if (ticker.includes('-USD') || ticker.includes('/USD')) return 'crypto_macro';
    if (ticker.includes('/') || ticker.includes('_')) return 'forex';
    const sectorHints: Record<string, string[]> = {
      energy: ['XOM', 'HAL', 'CVX', 'KOS', 'OXY', 'SLB', 'USO', 'UNG', 'XLE'],
      defense: ['RTX', 'LMT', 'NOC', 'GD', 'BA'],
      metals: ['FCX', 'AA', 'MP', 'NEM', 'GLD', 'COPX', 'CPER'],
      ai_infrastructure: ['NVDA', 'VRT', 'NRG', 'EQIX', 'NET', 'SMCI'],
    };
    for (const [sector, tickers] of Object.entries(sectorHints)) {
      if (tickers.includes(ticker)) return sector;
    }
    return 'other';
  }

  private evaluateStarQuality(sectorPerf: SectorPerf[]): string {
    const stars = this.store.getResearchStars();
    if (stars.length === 0) return 'no stars';

    // Check how many current stars belong to promoted vs demoted sectors
    const promoted = new Set(sectorPerf.filter((s) => s.status === 'promoted').map((s) => s.sector));
    const demoted = new Set(sectorPerf.filter((s) => s.status === 'demoted').map((s) => s.sector));

    const good = stars.filter((s) => promoted.has(s.sector)).length;
    const bad = stars.filter((s) => demoted.has(s.sector)).length;
    return `${stars.length} stars (${good} in promoted, ${bad} in demoted sectors)`;
  }

  private buildRecommendations(sectorPerf: SectorPerf[]): string[] {
    const recs: string[] = [];
    for (const sp of sectorPerf) {
      if (sp.status === 'promoted') {
        recs.push(`FOCUS ${sp.sector}: ${(sp.winRate * 100).toFixed(0)}% win rate, $${sp.totalPnl.toFixed(2)} P&L`);
      } else if (sp.status === 'demoted') {
        recs.push(`AVOID ${sp.sector}: ${(sp.winRate * 100).toFixed(0)}% win rate, $${sp.totalPnl.toFixed(2)} P&L`);
      }
    }
    if (recs.length === 0) recs.push('Insufficient data for sector recommendations');
    return recs;
  }

  private manageFACTCache(sectorPerf: SectorPerf[]): number {
    let pruned = 0;
    try {
      const raw = this.store.get('fact_cache');
      if (!raw) return 0;
      const cache = JSON.parse(raw) as Array<{ sector: string; strategy: string; winRate: number }>;
      const demotedSectors = new Set(sectorPerf.filter((s) => s.status === 'demoted').map((s) => s.sector));

      const kept = cache.filter((entry) => {
        if (demotedSectors.has(entry.sector) && entry.winRate < DEMOTE_THRESHOLD) {
          pruned++;
          return false;
        }
        return true;
      });

      if (pruned > 0) {
        this.store.set('fact_cache', JSON.stringify(kept));
      }
    } catch {}
    return pruned;
  }

  private alignWithCatalysts(sectorPerf: SectorPerf[]): string[] {
    const aligned: string[] = [];
    try {
      const raw = this.store.get('active_catalysts');
      if (!raw) return aligned;
      const { catalysts } = JSON.parse(raw) as { catalysts: string[] };
      const promotedSectors = sectorPerf.filter((s) => s.status === 'promoted').map((s) => s.sector);

      // No hardcoded catalyst→ticker mapping — research worker discovers tickers dynamically
      // Ferd logs detected catalysts for context only
      for (const catalyst of catalysts) {
        aligned.push(`CATALYST: ${catalyst} detected`);
        if (promotedSectors.includes(catalyst)) {
          aligned.push(`${catalyst} (catalyst + performing)`);
        }
      }

      // Check Warren's urgency — if critical, also boost hedges
      const urgency = this.store.get('warren:urgency');
      if (urgency === 'critical') {
        aligned.push('CRITICAL: Warren urgency — research worker will prioritize defensive movers');
      }

      // Write alignment for other managers to read
      if (aligned.length > 0) {
        this.store.set('catalyst_sector_alignment', JSON.stringify({
          aligned, updatedAt: new Date().toISOString(), updatedBy: 'ferd',
        }));
      }
    } catch {}
    return aligned;
  }
}

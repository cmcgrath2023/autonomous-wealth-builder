/**
 * Market Intelligence FACT Cache — Fast Augmented Context Tools
 *
 * Adapted from Oceanic CRM's FACT Cache for market research.
 * Caches research analysis patterns by sector + catalyst + condition
 * so the same "oil surge + Iran conflict" pattern doesn't need to be
 * reanalyzed every heartbeat.
 *
 * Tiers:
 *   1. Exact: same sector + catalyst + condition → instant cached strategy
 *   2. Pattern: same sector + catalyst, any condition → adapt
 *   3. Miss: novel combination → return null, caller generates fresh
 *
 * Over time, the cache builds a library of proven market strategies
 * organized by sector × catalyst. Bayesian layer promotes winners.
 */

export interface MarketPattern {
  id: string;
  sector: string;          // energy, defense, metals, crypto, ai_infrastructure
  catalyst: string;        // oil_surge, iran_conflict, fed_decision, earnings_beat, etc.
  marketCondition: string; // bullish, bearish, mixed
  strategy: string;        // what to do: "Buy XOM, HAL. Long oil exposure."
  instruments: string[];   // tickers to trade
  reasoning: string;       // why this strategy works
  timesUsed: number;
  timesSucceeded: number;
  successRate: number;
  createdAt: string;
  lastUsedAt: string;
  ttlHours: number;        // 24h default — strategies refresh daily
}

export interface CacheLookupResult {
  hit: boolean;
  tier: 'exact' | 'pattern' | 'miss';
  pattern?: MarketPattern;
  latencyMs: number;
}

function buildKey(sector: string, catalyst: string, condition: string): string {
  return `${sector.toLowerCase().trim()}::${catalyst.toLowerCase().trim()}::${condition.toLowerCase().trim()}`;
}

function normalizeSector(s: string): string {
  const lower = s.toLowerCase().trim();
  if (/oil|energy|crude|petroleum|gas/i.test(lower)) return 'energy';
  if (/defense|military|weapons|aerospace/i.test(lower)) return 'defense';
  if (/metal|copper|aluminum|gold|silver|rare.?earth|mining/i.test(lower)) return 'metals';
  if (/crypto|bitcoin|ethereum|defi|web3/i.test(lower)) return 'crypto';
  if (/ai|data.?center|semiconductor|chip|gpu/i.test(lower)) return 'ai_infrastructure';
  if (/real.?estate|property|reit/i.test(lower)) return 'real_estate';
  return lower.substring(0, 30) || 'general';
}

function normalizeCatalyst(c: string): string {
  const lower = c.toLowerCase().trim();
  if (/iran|war|conflict|geopolitical|strait/i.test(lower)) return 'geopolitical_conflict';
  if (/oil.*surge|crude.*spike|oil.*\$\d/i.test(lower)) return 'oil_surge';
  if (/fed|fomc|rate.*decision|powell/i.test(lower)) return 'fed_decision';
  if (/earn|quarter|q[1-4]|beat|miss|guidance/i.test(lower)) return 'earnings';
  if (/ipo|debut|listing/i.test(lower)) return 'ipo';
  if (/supply.*chain|shortage|disrupt/i.test(lower)) return 'supply_disruption';
  if (/upgrade|downgrade|analyst/i.test(lower)) return 'analyst_rating';
  if (/inflation|cpi|ppi/i.test(lower)) return 'inflation';
  return lower.substring(0, 40) || 'general';
}

export class MarketFACTCache {
  private patterns = new Map<string, MarketPattern>();

  lookup(sector: string, catalyst: string, condition: string): CacheLookupResult {
    const start = Date.now();
    const ns = normalizeSector(sector);
    const nc = normalizeCatalyst(catalyst);

    // Tier 1: Exact match
    const exactKey = buildKey(ns, nc, condition);
    const exact = this.patterns.get(exactKey);
    if (exact && !this.isExpired(exact)) {
      exact.timesUsed++;
      exact.lastUsedAt = new Date().toISOString();
      return { hit: true, tier: 'exact', pattern: exact, latencyMs: Date.now() - start };
    }

    // Tier 2: Pattern match — same sector + catalyst, any condition
    for (const [, pattern] of this.patterns) {
      if (pattern.sector === ns && pattern.catalyst === nc && !this.isExpired(pattern)) {
        pattern.timesUsed++;
        pattern.lastUsedAt = new Date().toISOString();
        return { hit: true, tier: 'pattern', pattern, latencyMs: Date.now() - start };
      }
    }

    // Tier 2b: Same sector, any catalyst
    for (const [, pattern] of this.patterns) {
      if (pattern.sector === ns && !this.isExpired(pattern) && pattern.successRate > 0.5) {
        pattern.timesUsed++;
        pattern.lastUsedAt = new Date().toISOString();
        return { hit: true, tier: 'pattern', pattern, latencyMs: Date.now() - start };
      }
    }

    // Tier 3: Miss
    return { hit: false, tier: 'miss', latencyMs: Date.now() - start };
  }

  store(sector: string, catalyst: string, condition: string, strategy: string, instruments: string[], reasoning: string): MarketPattern {
    const ns = normalizeSector(sector);
    const nc = normalizeCatalyst(catalyst);
    const key = buildKey(ns, nc, condition);

    const pattern: MarketPattern = {
      id: key,
      sector: ns,
      catalyst: nc,
      marketCondition: condition,
      strategy,
      instruments,
      reasoning,
      timesUsed: 1,
      timesSucceeded: 0,
      successRate: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      ttlHours: 24,
    };

    this.patterns.set(key, pattern);
    return pattern;
  }

  recordOutcome(sector: string, catalyst: string, condition: string, success: boolean): void {
    const ns = normalizeSector(sector);
    const nc = normalizeCatalyst(catalyst);
    const key = buildKey(ns, nc, condition);
    const pattern = this.patterns.get(key);
    if (pattern) {
      if (success) pattern.timesSucceeded++;
      pattern.successRate = pattern.timesSucceeded / pattern.timesUsed;
    }
  }

  getTopStrategies(limit = 10): MarketPattern[] {
    return [...this.patterns.values()]
      .filter(p => p.timesUsed >= 2)
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, limit);
  }

  getStats(): { totalPatterns: number; avgSuccessRate: number; topSectors: string[] } {
    const all = [...this.patterns.values()];
    const used = all.filter(p => p.timesUsed > 1);
    const sectors = new Map<string, number>();
    for (const p of all) sectors.set(p.sector, (sectors.get(p.sector) || 0) + p.timesUsed);

    return {
      totalPatterns: all.length,
      avgSuccessRate: used.length > 0 ? used.reduce((s, p) => s + p.successRate, 0) / used.length : 0,
      topSectors: [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s),
    };
  }

  private isExpired(pattern: MarketPattern): boolean {
    return Date.now() - new Date(pattern.createdAt).getTime() > pattern.ttlHours * 3600000;
  }
}

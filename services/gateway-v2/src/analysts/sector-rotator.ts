/**
 * Sector Rotator — Wave 3 (refinement)
 *
 * Determines which sectors are leading and biases the buy universe toward
 * them. Uses Alpaca snapshots of sector ETFs to rank performance.
 *
 * Output: `SectorBias[]` written to store. Trade-engine reads the bias
 * and adjusts candidate scoring — overweight sector candidates get a score
 * boost, underweight get a penalty.
 *
 * No LLM call. Pure ETF performance ranking.
 */

export interface SectorBias {
  sector: string;
  etf: string;
  changePct: number;    // today's % change
  rank: number;         // 1 = strongest
  bias: 'overweight' | 'neutral' | 'underweight';
  weight: number;       // 0.5 (underweight) to 1.5 (overweight)
}

export interface SectorRotationResult {
  sectors: SectorBias[];
  leaders: string[];       // top 3 sector names
  laggards: string[];      // bottom 3 sector names
  timestamp: string;
}

const SECTOR_ETFS: Array<{ etf: string; sector: string }> = [
  { etf: 'XLK', sector: 'Technology' },
  { etf: 'SMH', sector: 'Semiconductors' },
  { etf: 'XLF', sector: 'Financials' },
  { etf: 'XLV', sector: 'Healthcare' },
  { etf: 'XBI', sector: 'Biotech' },
  { etf: 'XLE', sector: 'Energy' },
  { etf: 'XLI', sector: 'Industrials' },
  { etf: 'XLC', sector: 'Communications' },
  { etf: 'XLY', sector: 'Consumer Discretionary' },
  { etf: 'XLP', sector: 'Consumer Staples' },
  { etf: 'XLU', sector: 'Utilities' },
  { etf: 'XLRE', sector: 'Real Estate' },
  { etf: 'XLB', sector: 'Materials' },
  { etf: 'IYT', sector: 'Transportation' },
  { etf: 'ARKK', sector: 'Innovation/Growth' },
  { etf: 'GDX', sector: 'Gold Miners' },
];

export class SectorRotator {
  async analyze(alpacaHeaders: Record<string, string>): Promise<SectorRotationResult> {
    console.log('[SECTOR] Analyzing sector rotation...');

    const syms = SECTOR_ETFS.map(s => s.etf).join(',');
    let snapData: any = {};
    try {
      const res = await fetch(
        `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${syms}&feed=sip`,
        { headers: alpacaHeaders, signal: AbortSignal.timeout(8000) },
      );
      if (res.ok) snapData = await res.json();
    } catch (e: any) {
      console.log(`[SECTOR] Snapshot fetch failed: ${e.message}`);
      return { sectors: [], leaders: [], laggards: [], timestamp: new Date().toISOString() };
    }

    const sectors: SectorBias[] = [];
    for (const { etf, sector } of SECTOR_ETFS) {
      const s = snapData[etf];
      if (!s) continue;
      const price = s.latestTrade?.p ?? 0;
      const prevClose = s.prevDailyBar?.c ?? price;
      const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      sectors.push({
        sector,
        etf,
        changePct,
        rank: 0,
        bias: 'neutral',
        weight: 1.0,
      });
    }

    // Rank by performance
    sectors.sort((a, b) => b.changePct - a.changePct);
    sectors.forEach((s, i) => {
      s.rank = i + 1;
      const total = sectors.length;
      if (i < 3) {
        s.bias = 'overweight';
        s.weight = 1.3 + (3 - i) * 0.1; // top: 1.5, 2nd: 1.4, 3rd: 1.3
      } else if (i >= total - 3) {
        s.bias = 'underweight';
        s.weight = 0.7 - (i - (total - 3)) * 0.1; // bottom: 0.7, 2nd-bottom: 0.6, last: 0.5
      } else {
        s.bias = 'neutral';
        s.weight = 1.0;
      }
    });

    const leaders = sectors.filter(s => s.bias === 'overweight').map(s => s.sector);
    const laggards = sectors.filter(s => s.bias === 'underweight').map(s => s.sector);

    console.log(`[SECTOR] Leaders: ${leaders.join(', ')} | Laggards: ${laggards.join(', ')}`);

    return {
      sectors,
      leaders,
      laggards,
      timestamp: new Date().toISOString(),
    };
  }
}

import { EventEmitter } from 'events';
import type { InfraAsset, AICapexEvent, SupplyChainSignal } from './types.js';

export type { InfraAsset, AICapexEvent, SupplyChainSignal } from './types.js';

const DATACENTER_ASSETS: InfraAsset[] = [
  // Copper
  {
    symbol: 'HG',
    name: 'Copper Futures',
    type: 'futures',
    category: 'copper',
    thesis: 'Each data center requires 20-40 tons of copper for wiring, busbars, and cooling systems',
    correlation: ['NVDA', 'MSFT', 'META', 'GOOGL'],
  },
  {
    symbol: 'FCX',
    name: 'Freeport-McMoRan',
    type: 'stock',
    category: 'copper',
    thesis: 'Largest publicly traded copper producer; direct beneficiary of AI-driven copper demand',
    correlation: ['NVDA', 'MSFT', 'META', 'GOOGL'],
  },
  {
    symbol: 'SCCO',
    name: 'Southern Copper',
    type: 'stock',
    category: 'copper',
    thesis: 'Major copper miner with low-cost operations positioned for AI infrastructure buildout',
    correlation: ['NVDA', 'MSFT', 'META', 'GOOGL'],
  },
  {
    symbol: 'COPX',
    name: 'Global X Copper Miners ETF',
    type: 'etf',
    category: 'copper',
    thesis: 'Broad copper mining exposure capturing full supply chain for data center buildout',
    correlation: ['NVDA', 'MSFT', 'META', 'GOOGL'],
  },

  // Uranium
  {
    symbol: 'CCJ',
    name: 'Cameco Corporation',
    type: 'stock',
    category: 'uranium',
    thesis: 'Leading uranium producer benefiting from nuclear power renaissance for data centers',
    correlation: ['CCJ', 'CEG', 'TLN'],
  },
  {
    symbol: 'CEG',
    name: 'Constellation Energy',
    type: 'stock',
    category: 'uranium',
    thesis: 'Largest US nuclear fleet operator; signed deals to power hyperscale data centers',
    correlation: ['CCJ', 'CEG', 'TLN'],
  },
  {
    symbol: 'TLN',
    name: 'Talen Energy',
    type: 'stock',
    category: 'uranium',
    thesis: 'Nuclear plant operator with direct data center co-location strategy',
    correlation: ['CCJ', 'CEG', 'TLN'],
  },
  {
    symbol: 'D',
    name: 'Dominion Energy',
    type: 'stock',
    category: 'uranium',
    thesis: 'Nuclear utility in Virginia data center corridor serving hyperscaler demand',
    correlation: ['CCJ', 'CEG', 'TLN'],
  },
  {
    symbol: 'URA',
    name: 'Global X Uranium ETF',
    type: 'etf',
    category: 'uranium',
    thesis: 'Broad uranium exposure capturing nuclear fuel cycle for AI power demand',
    correlation: ['CCJ', 'CEG', 'TLN'],
  },

  // Natural Gas
  {
    symbol: 'NG',
    name: 'Natural Gas Futures',
    type: 'futures',
    category: 'natgas',
    thesis: 'Bridge fuel for data center power; gas turbines provide fast-deploy backup generation',
    correlation: ['LNG', 'EQT'],
  },
  {
    symbol: 'LNG',
    name: 'Cheniere Energy',
    type: 'stock',
    category: 'natgas',
    thesis: 'LNG exporter benefiting from global data center power demand growth',
    correlation: ['NG', 'EQT'],
  },
  {
    symbol: 'EQT',
    name: 'EQT Corporation',
    type: 'stock',
    category: 'natgas',
    thesis: 'Largest US natural gas producer positioned for data center baseload power',
    correlation: ['NG', 'LNG'],
  },

  // Rare Earth
  {
    symbol: 'MP',
    name: 'MP Materials',
    type: 'stock',
    category: 'rare_earth',
    thesis: 'Only scaled rare earth mine in the US; critical minerals for server magnets and components',
    correlation: ['REMX', 'ALB'],
  },
  {
    symbol: 'REMX',
    name: 'VanEck Rare Earth/Strategic Metals ETF',
    type: 'etf',
    category: 'rare_earth',
    thesis: 'Broad rare earth exposure for strategic minerals used in AI hardware manufacturing',
    correlation: ['MP', 'ALB'],
  },
  {
    symbol: 'ALB',
    name: 'Albemarle Corporation',
    type: 'stock',
    category: 'rare_earth',
    thesis: 'Lithium and specialty chemicals producer for battery backup and cooling systems',
    correlation: ['MP', 'REMX'],
  },

  // Power
  {
    symbol: 'VST',
    name: 'Vistra Corp',
    type: 'stock',
    category: 'power',
    thesis: 'Power generator with nuclear and gas assets in key data center markets',
    correlation: ['NEE', 'CEG'],
  },
  {
    symbol: 'NEE',
    name: 'NextEra Energy',
    type: 'stock',
    category: 'power',
    thesis: 'Largest renewable energy producer; clean power PPAs with hyperscalers',
    correlation: ['VST', 'CEG'],
  },
];

export { DATACENTER_ASSETS };

export class DataCenterInfra extends EventEmitter {
  private capexEvents: AICapexEvent[] = [];
  private signals: SupplyChainSignal[] = [];

  constructor() {
    super();
  }

  registerCapexEvent(event: AICapexEvent): SupplyChainSignal | null {
    this.capexEvents.push(event);
    this.emit('capex-event', event);

    if (event.amount > 10) {
      const signal = this.generateCapexSignal(event);
      this.signals.push(signal);
      this.emit('signal', signal);
      return signal;
    }

    return null;
  }

  generateCapexSignal(event: AICapexEvent): SupplyChainSignal {
    const focusLower = event.focus.toLowerCase();
    const isNuclear =
      focusLower.includes('nuclear') || focusLower.includes('power');
    const isDataCenter =
      focusLower.includes('data center') ||
      focusLower.includes('datacenter') ||
      focusLower.includes('infrastructure');

    if (isNuclear) {
      const uraniumAssets = DATACENTER_ASSETS.filter(
        (a) => a.category === 'uranium'
      ).map((a) => a.symbol);
      return {
        category: 'uranium',
        trigger: `${event.company} announced $${event.amount}B capex focused on ${event.focus}`,
        confidence: Math.min(0.8, event.amount / 100),
        assets: uraniumAssets,
        direction: 'long',
        rationale: `Major nuclear/power capex from ${event.company} signals increased uranium demand for data center power`,
        timestamp: new Date(),
      };
    }

    // Default to copper for data center / infrastructure keywords
    const copperAssets = DATACENTER_ASSETS.filter(
      (a) => a.category === 'copper'
    ).map((a) => a.symbol);
    return {
      category: 'copper',
      trigger: `${event.company} announced $${event.amount}B capex focused on ${event.focus}`,
      confidence: Math.min(0.8, event.amount / 100),
      assets: copperAssets,
      direction: 'long',
      rationale: `Large-scale data center buildout by ${event.company} drives copper demand for wiring and infrastructure`,
      timestamp: new Date(),
    };
  }

  evaluateCopperAICorrelation(
    aiStockChanges: Record<string, number>
  ): SupplyChainSignal | null {
    const correlationTickers = ['NVDA', 'MSFT', 'META', 'GOOGL'];
    const changes = correlationTickers
      .map((t) => aiStockChanges[t])
      .filter((v) => v !== undefined);

    if (changes.length === 0) return null;

    const avgChange = changes.reduce((sum, c) => sum + c, 0) / changes.length;

    if (avgChange > 2) {
      const copperAssets = DATACENTER_ASSETS.filter(
        (a) => a.category === 'copper'
      ).map((a) => a.symbol);
      const signal: SupplyChainSignal = {
        category: 'copper',
        trigger: `AI megacap average move +${avgChange.toFixed(1)}% signals accelerating infrastructure spend`,
        confidence: 0.7,
        assets: copperAssets,
        direction: 'long',
        rationale:
          'Strong AI stock performance correlates with increased data center buildout and copper demand',
        timestamp: new Date(),
      };
      this.signals.push(signal);
      this.emit('signal', signal);
      return signal;
    }

    return null;
  }

  evaluateNuclearDeals(): SupplyChainSignal | null {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentNuclearDeals = this.capexEvents.filter((e) => {
      const focusLower = e.focus.toLowerCase();
      return (
        (focusLower.includes('nuclear') || focusLower.includes('power')) &&
        e.announcementDate >= thirtyDaysAgo
      );
    });

    if (recentNuclearDeals.length === 0) return null;

    const totalAmount = recentNuclearDeals.reduce(
      (sum, e) => sum + e.amount,
      0
    );
    const companies = recentNuclearDeals.map((e) => e.company).join(', ');

    const uraniumAssets = DATACENTER_ASSETS.filter(
      (a) => a.category === 'uranium'
    ).map((a) => a.symbol);

    const signal: SupplyChainSignal = {
      category: 'uranium',
      trigger: `${recentNuclearDeals.length} nuclear deals totaling $${totalAmount.toFixed(1)}B in last 30 days`,
      confidence: 0.75,
      assets: uraniumAssets,
      direction: 'long',
      rationale: `Clustering of nuclear power deals from ${companies} indicates structural shift toward nuclear for AI data centers`,
      timestamp: new Date(),
    };
    this.signals.push(signal);
    this.emit('signal', signal);
    return signal;
  }

  onHeartbeat(aiStockChanges: Record<string, number>): SupplyChainSignal[] {
    const results: SupplyChainSignal[] = [];

    const copperSignal = this.evaluateCopperAICorrelation(aiStockChanges);
    if (copperSignal) results.push(copperSignal);

    const nuclearSignal = this.evaluateNuclearDeals();
    if (nuclearSignal) results.push(nuclearSignal);

    return results;
  }

  getAssetsByCategory(
    category: 'copper' | 'uranium' | 'natgas' | 'rare_earth' | 'power'
  ): InfraAsset[] {
    return DATACENTER_ASSETS.filter((a) => a.category === category);
  }

  getSectorAllocation(
    portfolioValue: number
  ): Record<string, { allocation: number; assets: InfraAsset[] }> {
    const maxAllocation = portfolioValue * 0.2; // 20% max total

    const splits: Record<
      string,
      { pct: number; assets: InfraAsset[] }
    > = {
      copper: { pct: 0.35, assets: this.getAssetsByCategory('copper') },
      uranium: { pct: 0.30, assets: this.getAssetsByCategory('uranium') },
      natgas: { pct: 0.20, assets: this.getAssetsByCategory('natgas') },
      rare_earth: { pct: 0.10, assets: this.getAssetsByCategory('rare_earth') },
      power: { pct: 0.05, assets: this.getAssetsByCategory('power') },
    };

    const result: Record<string, { allocation: number; assets: InfraAsset[] }> =
      {};
    for (const [category, { pct, assets }] of Object.entries(splits)) {
      result[category] = {
        allocation: maxAllocation * pct,
        assets,
      };
    }

    return result;
  }
}

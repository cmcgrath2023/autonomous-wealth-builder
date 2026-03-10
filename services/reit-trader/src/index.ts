import { EventEmitter } from 'events';
import type { REITAsset, REITQuote, REITSignal, PhaseAllocation } from './types.js';

export type { REITAsset, REITQuote, REITSignal, PhaseAllocation } from './types.js';

const REIT_UNIVERSE: REITAsset[] = [
  // Data Centers
  { symbol: 'EQIX', name: 'Equinix', sector: 'datacenter', dividendYield: 2.0, exDivDate: null, navPerShare: 850, priceToNAV: null },
  { symbol: 'DLR', name: 'Digital Realty', sector: 'datacenter', dividendYield: 3.5, exDivDate: null, navPerShare: 155, priceToNAV: null },
  // Industrial
  { symbol: 'PLD', name: 'Prologis', sector: 'industrial', dividendYield: 3.0, exDivDate: null, navPerShare: 130, priceToNAV: null },
  { symbol: 'STAG', name: 'STAG Industrial', sector: 'industrial', dividendYield: 4.0, exDivDate: null, navPerShare: 38, priceToNAV: null },
  // Residential
  { symbol: 'AVB', name: 'AvalonBay Communities', sector: 'residential', dividendYield: 3.5, exDivDate: null, navPerShare: 210, priceToNAV: null },
  { symbol: 'EQR', name: 'Equity Residential', sector: 'residential', dividendYield: 4.0, exDivDate: null, navPerShare: 70, priceToNAV: null },
  // Healthcare
  { symbol: 'WELL', name: 'Welltower', sector: 'healthcare', dividendYield: 2.5, exDivDate: null, navPerShare: 95, priceToNAV: null },
  { symbol: 'VTR', name: 'Ventas', sector: 'healthcare', dividendYield: 3.0, exDivDate: null, navPerShare: 50, priceToNAV: null },
];

const PHASE_ALLOCATIONS: PhaseAllocation[] = [
  { phase: 'building_capital', reitPct: 100, physicalPct: 0 },
  { phase: 'first_deal', reitPct: 70, physicalPct: 30 },
  { phase: 'portfolio_growth', reitPct: 40, physicalPct: 60 },
  { phase: 'financial_fortress', reitPct: 25, physicalPct: 75 },
];

export class REITTrader extends EventEmitter {
  private universe: REITAsset[];
  private quotes: Map<string, REITQuote>;
  private alpacaKey: string | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | null;

  constructor(opts: { alpacaKey?: string } = {}) {
    super();
    this.universe = [...REIT_UNIVERSE];
    this.quotes = new Map();
    this.alpacaKey = opts.alpacaKey;
    this.intervalHandle = null;
  }

  fetchQuotes(): void {
    const symbols = this.universe.map((r) => r.symbol);
    this.emit('delegate', {
      target: 'MidStream',
      action: 'fetchQuotes',
      provider: 'alpaca',
      symbols,
      apiKey: this.alpacaKey,
      callback: (incoming: REITQuote[]) => {
        for (const q of incoming) {
          this.quotes.set(q.symbol, q);
        }
        this.emit('quotes', incoming);
      },
    });
  }

  evaluateDividendCapture(): REITSignal[] {
    const signals: REITSignal[] = [];
    const now = new Date();

    for (const reit of this.universe) {
      if (!reit.exDivDate || reit.dividendYield <= 4) continue;

      const exDiv = new Date(reit.exDivDate);
      const daysUntilExDiv = (exDiv.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      if (daysUntilExDiv >= 2 && daysUntilExDiv <= 3) {
        const quote = this.quotes.get(reit.symbol);
        const entry = quote?.price ?? 0;
        if (entry === 0) continue;

        signals.push({
          symbol: reit.symbol,
          strategy: 'dividend_capture',
          direction: 'long',
          confidence: 0.7,
          entry,
          stopLoss: entry * 0.97,
          takeProfit: entry * 1.03,
          rationale: `${reit.symbol} ex-div in ${Math.round(daysUntilExDiv)} days with ${reit.dividendYield}% yield. Buy 2 days before, sell 1-2 days after ex-div.`,
          exDivDate: reit.exDivDate,
          timestamp: now,
        });
      }
    }

    if (signals.length > 0) {
      this.emit('signals', signals);
    }
    return signals;
  }

  evaluateSectorRotation(aiMomentum?: number): REITSignal[] {
    const signals: REITSignal[] = [];
    const now = new Date();

    let targetSector: REITAsset['sector'] | null = null;
    let rationale = '';

    if (aiMomentum !== undefined && aiMomentum > 2) {
      targetSector = 'datacenter';
      rationale = `AI momentum strong at ${aiMomentum.toFixed(1)}% — favoring data center REITs.`;
    } else if (aiMomentum !== undefined && aiMomentum < -1) {
      targetSector = 'healthcare';
      rationale = `Market uncertain (VIX > 20 implied) — rotating to defensive healthcare REITs.`;
    } else {
      targetSector = 'residential';
      rationale = `Neutral conditions — favoring residential REITs for housing demand exposure.`;
    }

    const sectorReits = this.universe.filter((r) => r.sector === targetSector);
    for (const reit of sectorReits) {
      const quote = this.quotes.get(reit.symbol);
      const entry = quote?.price ?? 0;
      if (entry === 0) continue;

      signals.push({
        symbol: reit.symbol,
        strategy: 'sector_rotation',
        direction: 'long',
        confidence: 0.65,
        entry,
        stopLoss: entry * 0.95,
        takeProfit: entry * 1.08,
        rationale,
        exDivDate: reit.exDivDate,
        timestamp: now,
      });
    }

    if (signals.length > 0) {
      this.emit('signals', signals);
    }
    return signals;
  }

  evaluateNAVDiscount(): REITSignal[] {
    const signals: REITSignal[] = [];
    const now = new Date();

    for (const reit of this.universe) {
      if (reit.navPerShare === null) continue;

      const quote = this.quotes.get(reit.symbol);
      if (!quote) continue;

      const discount = (reit.navPerShare - quote.price) / reit.navPerShare;
      if (discount > 0.10) {
        signals.push({
          symbol: reit.symbol,
          strategy: 'nav_discount',
          direction: 'long',
          confidence: 0.7,
          entry: quote.price,
          stopLoss: quote.price * 0.93,
          takeProfit: reit.navPerShare * 0.98,
          rationale: `${reit.symbol} trading at ${(discount * 100).toFixed(1)}% discount to NAV ($${reit.navPerShare}). Mean reversion to NAV is historically strong.`,
          exDivDate: reit.exDivDate,
          timestamp: now,
        });
      }
    }

    if (signals.length > 0) {
      this.emit('signals', signals);
    }
    return signals;
  }

  getCurrentPhase(tradingCapital: number): PhaseAllocation['phase'] {
    if (tradingCapital >= 200_000) return 'financial_fortress';
    if (tradingCapital >= 50_000) return 'portfolio_growth';
    if (tradingCapital >= 15_000) return 'first_deal';
    return 'building_capital';
  }

  getPhaseAllocation(tradingCapital: number): PhaseAllocation {
    const phase = this.getCurrentPhase(tradingCapital);
    return PHASE_ALLOCATIONS.find((p) => p.phase === phase)!;
  }

  onHeartbeat(aiMomentum?: number): void {
    this.fetchQuotes();

    const divSignals = this.evaluateDividendCapture();
    const rotationSignals = this.evaluateSectorRotation(aiMomentum);
    const navSignals = this.evaluateNAVDiscount();

    this.emit('heartbeat', {
      timestamp: new Date(),
      quotesTracked: this.quotes.size,
      signals: [...divSignals, ...rotationSignals, ...navSignals],
    });
  }

  start(intervalMs: number = 60_000): void {
    if (this.intervalHandle) return;
    this.onHeartbeat();
    this.intervalHandle = setInterval(() => this.onHeartbeat(), intervalMs);
    this.emit('started', { intervalMs });
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.emit('stopped', { timestamp: new Date() });
    }
  }
}

export default REITTrader;

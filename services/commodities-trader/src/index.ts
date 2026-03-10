import { EventEmitter } from 'events';
import {
  CommodityContract,
  CommodityQuote,
  CommoditySignal,
  SpreadPosition,
} from './types.js';

export const COMMODITY_CONTRACTS: Record<string, CommodityContract> = {
  LE: {
    symbol: 'LE',
    name: 'Live Cattle',
    exchange: 'CME',
    category: 'livestock',
    contractSize: 40000,
    tickSize: 0.025,
    tickValue: 10.0,
    margin: 2200,
    tradingHours: '08:30-13:05 CT',
  },
  HE: {
    symbol: 'HE',
    name: 'Lean Hogs',
    exchange: 'CME',
    category: 'livestock',
    contractSize: 40000,
    tickSize: 0.025,
    tickValue: 10.0,
    margin: 1500,
    tradingHours: '08:30-13:05 CT',
  },
  GF: {
    symbol: 'GF',
    name: 'Feeder Cattle',
    exchange: 'CME',
    category: 'livestock',
    contractSize: 50000,
    tickSize: 0.025,
    tickValue: 12.5,
    margin: 3000,
    tradingHours: '08:30-13:05 CT',
  },
  ZC: {
    symbol: 'ZC',
    name: 'Corn',
    exchange: 'CBOT',
    category: 'grains',
    contractSize: 5000,
    tickSize: 0.25,
    tickValue: 12.5,
    margin: 1200,
    tradingHours: '19:00-07:45, 08:30-13:20 CT',
  },
  ZS: {
    symbol: 'ZS',
    name: 'Soybeans',
    exchange: 'CBOT',
    category: 'grains',
    contractSize: 5000,
    tickSize: 0.25,
    tickValue: 12.5,
    margin: 2000,
    tradingHours: '19:00-07:45, 08:30-13:20 CT',
  },
  ZW: {
    symbol: 'ZW',
    name: 'Wheat',
    exchange: 'CBOT',
    category: 'grains',
    contractSize: 5000,
    tickSize: 0.25,
    tickValue: 12.5,
    margin: 1500,
    tradingHours: '19:00-07:45, 08:30-13:20 CT',
  },
  CL: {
    symbol: 'CL',
    name: 'Crude Oil',
    exchange: 'NYMEX',
    category: 'energy',
    contractSize: 1000,
    tickSize: 0.01,
    tickValue: 10.0,
    margin: 6000,
    tradingHours: '18:00-17:00 CT',
  },
  NG: {
    symbol: 'NG',
    name: 'Natural Gas',
    exchange: 'NYMEX',
    category: 'energy',
    contractSize: 10000,
    tickSize: 0.001,
    tickValue: 10.0,
    margin: 2500,
    tradingHours: '18:00-17:00 CT',
  },
  HG: {
    symbol: 'HG',
    name: 'Copper',
    exchange: 'COMEX',
    category: 'metals',
    contractSize: 25000,
    tickSize: 0.0005,
    tickValue: 12.5,
    margin: 4000,
    tradingHours: '18:00-17:00 CT',
  },
  GC: {
    symbol: 'GC',
    name: 'Gold',
    exchange: 'COMEX',
    category: 'metals',
    contractSize: 100,
    tickSize: 0.1,
    tickValue: 10.0,
    margin: 9000,
    tradingHours: '18:00-17:00 CT',
  },
  SI: {
    symbol: 'SI',
    name: 'Silver',
    exchange: 'COMEX',
    category: 'metals',
    contractSize: 5000,
    tickSize: 0.005,
    tickValue: 25.0,
    margin: 8000,
    tradingHours: '18:00-17:00 CT',
  },
};

// ETF proxies for Alpaca — map futures symbols to tradeable ETFs
const ETF_PROXY: Record<string, string> = {
  LE: 'COW',   // Live Cattle → iPath Livestock ETN
  HE: 'COW',   // Lean Hogs → iPath Livestock ETN
  GF: 'COW',   // Feeder Cattle → iPath Livestock ETN
  ZC: 'CORN',  // Corn → Teucrium Corn Fund
  ZS: 'SOYB',  // Soybeans → Teucrium Soybean Fund
  ZW: 'WEAT',  // Wheat → Teucrium Wheat Fund
  CL: 'USO',   // Crude Oil → United States Oil Fund
  NG: 'UNG',   // Natural Gas → United States Natural Gas Fund
  HG: 'CPER',  // Copper → United States Copper Index Fund
  GC: 'GLD',   // Gold → SPDR Gold Trust
  SI: 'SLV',   // Silver → iShares Silver Trust
};

export class CommoditiesTrader extends EventEmitter {
  private alpacaKey: string;
  private alpacaSecret: string;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private spreadPositions: SpreadPosition[] = [];
  private running = false;

  constructor({ apiKey, alpacaKey, alpacaSecret }: { apiKey?: string; alpacaKey?: string; alpacaSecret?: string }) {
    super();
    this.alpacaKey = alpacaKey || process.env.ALPACA_API_KEY || '';
    this.alpacaSecret = alpacaSecret || process.env.ALPACA_API_SECRET || '';
  }

  async fetchQuotes(symbols: string[]): Promise<CommodityQuote[]> {
    const quotes: CommodityQuote[] = [];

    // Get unique ETF proxies needed
    const etfSymbols = [...new Set(symbols.map(s => ETF_PROXY[s]).filter(Boolean))];
    const etfPrices = new Map<string, number>();

    // Batch fetch from Alpaca using multi-quote endpoint
    if (etfSymbols.length > 0) {
      try {
        const symbolsParam = etfSymbols.join(',');
        const res = await fetch(`https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=${symbolsParam}`, {
          headers: {
            'APCA-API-KEY-ID': this.alpacaKey,
            'APCA-API-SECRET-KEY': this.alpacaSecret,
          },
        });
        if (res.ok) {
          const data = await res.json() as any;
          const quotesData = data.quotes || {};
          for (const [sym, q] of Object.entries(quotesData) as [string, any][]) {
            const price = q.ap || q.bp || 0;
            if (price > 0) etfPrices.set(sym, price);
          }
        }
      } catch {
        // Batch endpoint may not work, fall back to individual
      }

      // Fallback: individual fetches for any missing
      for (const etf of etfSymbols) {
        if (etfPrices.has(etf)) continue;
        try {
          const res = await fetch(`https://data.alpaca.markets/v2/stocks/${etf}/bars/latest`, {
            headers: {
              'APCA-API-KEY-ID': this.alpacaKey,
              'APCA-API-SECRET-KEY': this.alpacaSecret,
            },
          });
          if (res.ok) {
            const data = await res.json() as any;
            if (data.bar?.c > 0) etfPrices.set(etf, data.bar.c);
          }
        } catch {
          this.emit('error', new Error(`Failed to fetch ETF proxy for ${etf}`));
        }
      }
    }

    // Map ETF prices back to futures symbols
    for (const symbol of symbols) {
      const proxy = ETF_PROXY[symbol];
      const price = proxy ? etfPrices.get(proxy) : undefined;
      if (price === undefined) continue;

      quotes.push({
        symbol,
        price,
        open: price,
        high: price,
        low: price,
        volume: 0,
        openInterest: 0,
        timestamp: Date.now(),
      });
    }

    return quotes;
  }

  async generateSignals(quotes: CommodityQuote[]): Promise<CommoditySignal[]> {
    const signals: CommoditySignal[] = [];

    for (const quote of quotes) {
      this.emit('analyzeRequest', {
        symbol: quote.symbol,
        price: quote.price,
        volume: quote.volume,
        openInterest: quote.openInterest,
        timestamp: quote.timestamp,
      });
    }

    return signals;
  }

  evaluateCattleCornSpread(
    cattleQuote: CommodityQuote,
    cornQuote: CommodityQuote
  ): CommoditySignal | null {
    if (!cattleQuote || !cornQuote || cornQuote.price === 0) {
      return null;
    }

    const ratio = cattleQuote.price / cornQuote.price;
    const historicalMeanLow = 25;
    const historicalMeanHigh = 30;
    const buyThreshold = 22;

    if (ratio < buyThreshold) {
      const signal: CommoditySignal = {
        symbol: 'LE',
        type: 'spread',
        direction: 'long',
        confidence: 0.7,
        entry: cattleQuote.price,
        stopLoss: cattleQuote.price * 0.95,
        takeProfit: cattleQuote.price * ((historicalMeanLow + historicalMeanHigh) / 2) / ratio,
        rationale: `Cattle/Corn ratio at ${ratio.toFixed(2)}, below buy threshold of ${buyThreshold}. Historical mean is ${historicalMeanLow}-${historicalMeanHigh}. Mean reversion expected.`,
        timestamp: Date.now(),
      };

      const spread: SpreadPosition = {
        id: `cattle-corn-${Date.now()}`,
        longLeg: 'LE',
        shortLeg: 'ZC',
        ratio,
        entrySpread: ratio,
        currentSpread: ratio,
        pnl: 0,
      };
      this.spreadPositions.push(spread);

      this.emit('signal', signal);
      return signal;
    }

    return null;
  }

  evaluateHogSeasonal(hogQuote: CommodityQuote): CommoditySignal | null {
    if (!hogQuote) {
      return null;
    }

    const now = new Date();
    const month = now.getMonth(); // 0-indexed: 8 = September

    // Buy hogs in September (month 8), sell in February
    if (month === 8) {
      const stopLoss = hogQuote.price * 0.95; // 5% stop
      const takeProfit = hogQuote.price * 1.12; // 12% target

      const signal: CommoditySignal = {
        symbol: 'HE',
        type: 'seasonal',
        direction: 'long',
        confidence: 0.65,
        entry: hogQuote.price,
        stopLoss,
        takeProfit,
        rationale:
          'Seasonal buy signal: Lean Hog prices historically rally from September through February due to reduced hog supply and increased holiday demand.',
        timestamp: Date.now(),
      };

      this.emit('signal', signal);
      return signal;
    }

    // Sell signal in February (month 1)
    if (month === 1) {
      const signal: CommoditySignal = {
        symbol: 'HE',
        type: 'seasonal',
        direction: 'short',
        confidence: 0.65,
        entry: hogQuote.price,
        stopLoss: hogQuote.price * 1.05,
        takeProfit: hogQuote.price * 0.88,
        rationale:
          'Seasonal sell signal: Lean Hog prices historically decline from February as supply increases post-winter.',
        timestamp: Date.now(),
      };

      this.emit('signal', signal);
      return signal;
    }

    return null;
  }

  async onHeartbeat(): Promise<void> {
    try {
      const allSymbols = Object.keys(COMMODITY_CONTRACTS);
      const quotes = await this.fetchQuotes(allSymbols);

      if (quotes.length === 0) {
        this.emit('heartbeat', { status: 'no_data', timestamp: Date.now() });
        return;
      }

      const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

      // Evaluate cattle/corn spread
      const cattleQuote = quoteMap.get('LE');
      const cornQuote = quoteMap.get('ZC');
      if (cattleQuote && cornQuote) {
        this.evaluateCattleCornSpread(cattleQuote, cornQuote);
      }

      // Evaluate hog seasonal
      const hogQuote = quoteMap.get('HE');
      if (hogQuote) {
        this.evaluateHogSeasonal(hogQuote);
      }

      // Update existing spread positions
      for (const spread of this.spreadPositions) {
        const longQuote = quoteMap.get(spread.longLeg);
        const shortQuote = quoteMap.get(spread.shortLeg);
        if (longQuote && shortQuote && shortQuote.price !== 0) {
          spread.currentSpread = longQuote.price / shortQuote.price;
          spread.pnl = spread.currentSpread - spread.entrySpread;
        }
      }

      // Generate signals via Neural Trader
      await this.generateSignals(quotes);

      this.emit('heartbeat', {
        status: 'ok',
        quotesReceived: quotes.length,
        activeSpreadPositions: this.spreadPositions.length,
        timestamp: Date.now(),
      });
    } catch (err) {
      this.emit('error', new Error(`Heartbeat failed: ${(err as Error).message}`));
    }
  }

  getPositionSizing(
    signal: CommoditySignal,
    portfolioValue: number
  ): { contracts: number; capitalRequired: number; riskAmount: number } {
    const maxAllocation = portfolioValue * 0.05; // max 5% per position
    const contract = COMMODITY_CONTRACTS[signal.symbol];

    if (!contract) {
      return { contracts: 0, capitalRequired: 0, riskAmount: 0 };
    }

    // Half-Kelly sizing
    const winProb = signal.confidence;
    const riskPerContract = Math.abs(signal.entry - signal.stopLoss) * contract.contractSize;
    const rewardPerContract = Math.abs(signal.takeProfit - signal.entry) * contract.contractSize;

    if (riskPerContract === 0 || rewardPerContract === 0) {
      return { contracts: 0, capitalRequired: 0, riskAmount: 0 };
    }

    const winLossRatio = rewardPerContract / riskPerContract;
    const fullKelly = winProb - (1 - winProb) / winLossRatio;
    const halfKelly = Math.max(0, fullKelly / 2);

    // Contracts based on half-Kelly fraction of portfolio
    const kellyCapital = portfolioValue * halfKelly;
    const contractsByKelly = Math.floor(kellyCapital / contract.margin);

    // Contracts limited by max 5% allocation
    const contractsByMaxAlloc = Math.floor(maxAllocation / contract.margin);

    // Margin-aware: ensure we have enough margin
    const contracts = Math.max(0, Math.min(contractsByKelly, contractsByMaxAlloc));
    const capitalRequired = contracts * contract.margin;
    const riskAmount = contracts * riskPerContract;

    return { contracts, capitalRequired, riskAmount };
  }

  start(intervalMs = 60_000): void {
    if (this.running) return;
    this.running = true;

    this.emit('started', { timestamp: Date.now() });
    this.onHeartbeat().catch(() => {});

    this.heartbeatInterval = setInterval(() => {
      this.onHeartbeat().catch(() => {});
    }, intervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.emit('stopped', { timestamp: Date.now() });
  }
}

export type {
  CommodityContract,
  CommodityQuote,
  CommoditySignal,
  SpreadPosition,
} from './types.js';

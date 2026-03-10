import { EventEmitter } from 'events';
import type { MetalAsset, MetalQuote, MetalSignal } from './types.js';

export type { MetalAsset, MetalQuote, MetalSignal } from './types.js';

const METAL_ASSETS: MetalAsset[] = [
  { symbol: 'GC', name: 'Gold Futures', type: 'futures', category: 'gold', margin: 9000 },
  { symbol: 'SI', name: 'Silver Futures', type: 'futures', category: 'silver', margin: 8000 },
  { symbol: 'GLD', name: 'Gold ETF', type: 'etf', category: 'gold', margin: 0 },
  { symbol: 'SLV', name: 'Silver ETF', type: 'etf', category: 'silver', margin: 0 },
  { symbol: 'MGC', name: 'Micro Gold Futures', type: 'futures', category: 'gold', margin: 1000 },
];

// ETF proxies for Alpaca — map futures symbols to tradeable ETFs
const ETF_PROXY: Record<string, string> = {
  GC: 'GLD',   // Gold futures → Gold ETF
  SI: 'SLV',   // Silver futures → Silver ETF
  MGC: 'GLD',  // Micro Gold → Gold ETF (same proxy)
  GLD: 'GLD',
  SLV: 'SLV',
};

export class MetalsTrader extends EventEmitter {
  private alpacaKey: string;
  private alpacaSecret: string;
  private quotes: Map<string, MetalQuote> = new Map();
  private priceHistory: Map<string, number[]> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private previousGoldCrossState: 'golden' | 'death' | null = null;

  constructor({ apiKey, alpacaKey, alpacaSecret }: { apiKey?: string; alpacaKey?: string; alpacaSecret?: string }) {
    super();
    this.alpacaKey = alpacaKey || process.env.ALPACA_API_KEY || '';
    this.alpacaSecret = alpacaSecret || process.env.ALPACA_API_SECRET || '';

    for (const asset of METAL_ASSETS) {
      this.priceHistory.set(asset.symbol, []);
    }
  }

  async fetchQuotes(): Promise<Map<string, MetalQuote>> {
    // Get unique ETF symbols to fetch
    const etfSymbols = [...new Set(METAL_ASSETS.map(a => ETF_PROXY[a.symbol]).filter(Boolean))];
    const etfPrices = new Map<string, { price: number; open: number; high: number; low: number; volume: number }>();

    // Fetch from Alpaca
    for (const etf of etfSymbols) {
      try {
        const res = await fetch(`https://data.alpaca.markets/v2/stocks/${etf}/quotes/latest`, {
          headers: {
            'APCA-API-KEY-ID': this.alpacaKey,
            'APCA-API-SECRET-KEY': this.alpacaSecret,
          },
        });
        if (res.ok) {
          const data = await res.json() as any;
          const price = data.quote?.ap || data.quote?.bp || 0; // ask price or bid price
          if (price > 0) {
            etfPrices.set(etf, { price, open: price, high: price, low: price, volume: 0 });
          }
        }
      } catch {
        // Alpaca may be unavailable
      }
    }

    // Also try bars for OHLCV data
    if (etfPrices.size === 0) {
      for (const etf of etfSymbols) {
        try {
          const res = await fetch(`https://data.alpaca.markets/v2/stocks/${etf}/bars/latest`, {
            headers: {
              'APCA-API-KEY-ID': this.alpacaKey,
              'APCA-API-SECRET-KEY': this.alpacaSecret,
            },
          });
          if (res.ok) {
            const data = await res.json() as any;
            const bar = data.bar;
            if (bar) {
              etfPrices.set(etf, { price: bar.c, open: bar.o, high: bar.h, low: bar.l, volume: bar.v || 0 });
            }
          }
        } catch {
          // fallback failed
        }
      }
    }

    for (const asset of METAL_ASSETS) {
      const proxy = ETF_PROXY[asset.symbol];
      const etfData = proxy ? etfPrices.get(proxy) : null;
      if (!etfData) continue;

      const price = etfData.price;
      const history = this.priceHistory.get(asset.symbol)!;
      history.push(price);
      if (history.length > 50) {
        history.shift();
      }

      const ema20 = history.length >= 20 ? this.calculateEMA(history, 20) : null;
      const ema50 = history.length >= 50 ? this.calculateEMA(history, 50) : null;
      const rsi = history.length >= 15 ? this.calculateRSI(history, 14) : null;
      const bollinger =
        history.length >= 20 ? this.calculateBollingerBands(history, 20) : null;

      const quote: MetalQuote = {
        symbol: asset.symbol,
        price,
        open: etfData.open,
        high: etfData.high,
        low: etfData.low,
        volume: etfData.volume,
        timestamp: new Date(),
        ema20,
        ema50,
        rsi,
        bollingerUpper: bollinger?.upper ?? null,
        bollingerLower: bollinger?.lower ?? null,
      };

      this.quotes.set(asset.symbol, quote);
    }

    return this.quotes;
  }

  calculateEMA(prices: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }

    return ema;
  }

  calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }

    avgGain /= period;
    avgLoss /= period;

    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  calculateBollingerBands(
    prices: number[],
    period: number,
  ): { upper: number; middle: number; lower: number } {
    const slice = prices.slice(-period);
    const middle = slice.reduce((sum, p) => sum + p, 0) / slice.length;
    const variance =
      slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / slice.length;
    const stdDev = Math.sqrt(variance);

    return {
      upper: middle + 2 * stdDev,
      middle,
      lower: middle - 2 * stdDev,
    };
  }

  evaluateGoldMomentum(): MetalSignal | null {
    const quote = this.quotes.get('GC');
    if (!quote || quote.ema20 == null || quote.ema50 == null) return null;

    const currentCrossState: 'golden' | 'death' =
      quote.ema20 > quote.ema50 ? 'golden' : 'death';

    if (currentCrossState === this.previousGoldCrossState) return null;

    this.previousGoldCrossState = currentCrossState;

    if (currentCrossState === 'golden') {
      return {
        symbol: 'GC',
        strategy: 'gold_momentum',
        direction: 'long',
        confidence: 0.7,
        entry: quote.price,
        stopLoss: quote.price * 0.97,
        takeProfit: quote.price * 1.05,
        rationale: 'EMA 20/50 golden cross detected on gold futures',
        timestamp: new Date(),
      };
    }

    return {
      symbol: 'GC',
      strategy: 'gold_momentum',
      direction: 'short',
      confidence: 0.7,
      entry: quote.price,
      stopLoss: quote.price * 1.03,
      takeProfit: quote.price * 0.95,
      rationale: 'EMA 20/50 death cross detected on gold futures — exit signal',
      timestamp: new Date(),
    };
  }

  evaluateSilverVolatility(): MetalSignal | null {
    const quote = this.quotes.get('SI');
    if (
      !quote ||
      quote.rsi == null ||
      quote.bollingerLower == null ||
      quote.bollingerUpper == null
    )
      return null;

    if (quote.rsi < 30 && quote.price <= quote.bollingerLower) {
      return {
        symbol: 'SI',
        strategy: 'silver_volatility',
        direction: 'long',
        confidence: 0.65,
        entry: quote.price,
        stopLoss: quote.price * 0.96,
        takeProfit: quote.price * 1.06,
        rationale:
          'Silver RSI oversold below 30 with price touching lower Bollinger Band',
        timestamp: new Date(),
      };
    }

    if (quote.rsi > 70 || quote.price >= quote.bollingerUpper) {
      return {
        symbol: 'SI',
        strategy: 'silver_volatility',
        direction: 'short',
        confidence: 0.65,
        entry: quote.price,
        stopLoss: quote.price * 1.04,
        takeProfit: quote.price * 0.94,
        rationale:
          'Silver RSI overbought above 70 or price at upper Bollinger Band — exit signal',
        timestamp: new Date(),
      };
    }

    return null;
  }

  evaluateVixHedge(
    vixLevel: number,
    spyChange: number,
  ): MetalSignal | null {
    const quote = this.quotes.get('GLD');
    if (!quote) return null;

    if (vixLevel > 25 || spyChange < -3) {
      const hedgePct = Math.min(0.1, Math.max(0.05, vixLevel / 250));
      return {
        symbol: 'GLD',
        strategy: 'vix_hedge',
        direction: 'long',
        confidence: 0.8,
        entry: quote.price,
        stopLoss: quote.price * 0.95,
        takeProfit: quote.price * 1.1,
        rationale: `VIX at ${vixLevel} / SPY change ${spyChange}% — hedging ${(hedgePct * 100).toFixed(1)}% of portfolio into gold`,
        timestamp: new Date(),
      };
    }

    return null;
  }

  async onHeartbeat(vixLevel?: number, spyChange?: number): Promise<void> {
    await this.fetchQuotes();

    const signals: MetalSignal[] = [];

    const goldSignal = this.evaluateGoldMomentum();
    if (goldSignal) signals.push(goldSignal);

    const silverSignal = this.evaluateSilverVolatility();
    if (silverSignal) signals.push(silverSignal);

    if (vixLevel != null && spyChange != null) {
      const vixSignal = this.evaluateVixHedge(vixLevel, spyChange);
      if (vixSignal) signals.push(vixSignal);
    }

    for (const signal of signals) {
      this.emit('signal', signal);
    }
  }

  start(intervalMs: number = 60_000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.onHeartbeat(), intervalMs);
    this.onHeartbeat();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getQuotes(): Map<string, MetalQuote> {
    return this.quotes;
  }
}

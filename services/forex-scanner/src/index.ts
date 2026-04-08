import { EventEmitter } from 'events';
import type { ForexPair, ForexQuote, ForexSignal } from './types.js';

export type { ForexPair, ForexQuote, ForexSignal, EconomicEvent } from './types.js';

const FOREX_PAIRS: ForexPair[] = [
  // Majors
  { symbol: 'EUR/USD', base: 'EUR', quote: 'USD', category: 'major', spread: 1.0, pipValue: 10 },
  { symbol: 'GBP/USD', base: 'GBP', quote: 'USD', category: 'major', spread: 1.5, pipValue: 10 },
  { symbol: 'USD/JPY', base: 'USD', quote: 'JPY', category: 'major', spread: 1.2, pipValue: 9.1 },
  // Carry
  { symbol: 'AUD/JPY', base: 'AUD', quote: 'JPY', category: 'carry', spread: 3.0, pipValue: 9.1 },
  { symbol: 'NZD/JPY', base: 'NZD', quote: 'JPY', category: 'carry', spread: 4.0, pipValue: 9.1 },
  // Cross
  { symbol: 'EUR/GBP', base: 'EUR', quote: 'GBP', category: 'cross', spread: 2.0, pipValue: 12.5 },
  { symbol: 'AUD/NZD', base: 'AUD', quote: 'NZD', category: 'cross', spread: 3.0, pipValue: 6.5 },
];

interface ForexScannerOptions {
  oandaApiKey?: string;
  oandaAccountId?: string;
  oandaMode?: 'live' | 'practice';
}

export class ForexScanner extends EventEmitter {
  private oandaApiKey: string | undefined;
  private oandaAccountId: string | undefined;
  private oandaBaseUrl: string;
  private quotes: Map<string, ForexQuote> = new Map();
  private priceHistory: Map<string, number[]> = new Map();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(options: ForexScannerOptions = {}) {
    super();
    this.oandaApiKey = options.oandaApiKey;
    this.oandaAccountId = options.oandaAccountId;
    // Practice accounts start with "101-", live with "001-"
    const isPractice = options.oandaMode === 'practice' || (options.oandaAccountId?.startsWith('101-') ?? false);
    this.oandaBaseUrl = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com';
  }

  async fetchQuotes(): Promise<ForexQuote[]> {
    if (!this.oandaApiKey || !this.oandaAccountId) {
      this.emit('error', new Error('No API key configured'));
      return [];
    }

    const instruments = FOREX_PAIRS.map((p) => p.symbol.replace('/', '_')).join(',');
    const url = `${this.oandaBaseUrl}/v3/accounts/${this.oandaAccountId}/pricing?instruments=${instruments}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.oandaApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errMsg = `OANDA API error: ${response.status} ${response.statusText}`;
      this.emit('error', new Error(errMsg));
      return [];
    }

    const data = (await response.json()) as {
      prices: Array<{
        instrument: string;
        asks: Array<{ price: string }>;
        bids: Array<{ price: string }>;
      }>;
    };

    const fetchedQuotes: ForexQuote[] = [];

    for (const price of data.prices) {
      const symbol = price.instrument.replace('_', '/');
      const bid = parseFloat(price.bids[0].price);
      const ask = parseFloat(price.asks[0].price);
      const mid = (bid + ask) / 2;

      const prevQuote = this.quotes.get(symbol);
      const prevMid = prevQuote?.mid ?? mid;
      const change = mid - prevMid;
      const changePercent = prevMid !== 0 ? (change / prevMid) * 100 : 0;

      const quote: ForexQuote = {
        symbol,
        bid,
        ask,
        mid,
        change,
        changePercent,
        volume: 0,
        timestamp: new Date(),
      };

      this.quotes.set(symbol, quote);
      fetchedQuotes.push(quote);

      // Track price history for moving average calculations
      const history = this.priceHistory.get(symbol) ?? [];
      history.push(mid);
      if (history.length > 100) {
        history.shift();
      }
      this.priceHistory.set(symbol, history);
    }

    this.emit('quotes', fetchedQuotes);
    return fetchedQuotes;
  }

  // Session times in ET (Eastern Time):
  // Tokyo:          7:00 PM - 1:00 AM ET (next day) = 00:00 - 06:00 UTC
  // Hong Kong:      8:30 PM - 3:00 AM ET (next day) = 01:30 - 08:00 UTC
  // London:         3:00 AM - 11:30 AM ET           = 08:00 - 16:30 UTC
  // Paris/Frankfurt: 3:00 AM - 11:30 AM ET          = 08:00 - 16:30 UTC
  // New York:       9:30 AM - 4:00 PM ET            = 14:30 - 21:00 UTC
  // London/NY overlap: 9:30 AM - 11:30 AM ET        = 14:30 - 16:30 UTC

  getActiveSession(): 'asian' | 'london' | 'newyork' | 'overlap' {
    const utcHour = new Date().getUTCHours();
    const utcMinutes = new Date().getUTCMinutes();
    const timeDecimal = utcHour + utcMinutes / 60;

    // London/NY overlap: 14:30-16:30 UTC (9:30 AM - 11:30 AM ET)
    if (timeDecimal >= 14.5 && timeDecimal < 16.5) {
      return 'overlap';
    }
    // NY session: 14:30-21:00 UTC (9:30 AM - 4:00 PM ET)
    if (timeDecimal >= 14.5 && timeDecimal < 21) {
      return 'newyork';
    }
    // London session: 08:00-16:30 UTC (3:00 AM - 11:30 AM ET)
    if (utcHour >= 8 && timeDecimal < 16.5) {
      return 'london';
    }
    // Asian session: 00:00-08:00 UTC (7:00 PM - 3:00 AM ET)
    if (utcHour >= 0 && utcHour < 8) {
      return 'asian';
    }

    return 'newyork';
  }

  isSessionOpen(session: string): boolean {
    const utcHour = new Date().getUTCHours();
    const utcMinutes = new Date().getUTCMinutes();
    const timeDecimal = utcHour + utcMinutes / 60;

    switch (session) {
      case 'asian':   // Tokyo 00:00-06:00 UTC, HK 01:30-08:00 UTC → combined 00:00-08:00
        return utcHour >= 0 && utcHour < 8;
      case 'london':  // 08:00-16:30 UTC (3 AM - 11:30 AM ET)
        return utcHour >= 8 && timeDecimal < 16.5;
      case 'newyork': // 14:30-21:00 UTC (9:30 AM - 4:00 PM ET)
        return timeDecimal >= 14.5 && timeDecimal < 21;
      case 'overlap': // 14:30-16:30 UTC (London + NY)
        return timeDecimal >= 14.5 && timeDecimal < 16.5;
      default:
        return false;
    }
  }

  /**
   * Technical analysis using the same indicators as NeuralTrader (RSI, MACD, EMA, BB, momentum).
   * Runs on ALL pairs during ANY active session — not just session opens.
   * Requires minimum 50 data points for reliable signals.
   */
  /** Get price history length for a symbol */
  getPriceHistoryLength(symbol: string): number {
    return this.priceHistory.get(symbol)?.length || 0;
  }

  /** Add a historical price point (for seeding from candles) */
  addPricePoint(symbol: string, price: number): void {
    const history = this.priceHistory.get(symbol) ?? [];
    history.push(price);
    if (history.length > 200) history.shift();
    this.priceHistory.set(symbol, history);
  }

  evaluateSessionMomentum(): ForexSignal[] {
    const signals: ForexSignal[] = [];
    const session = this.getActiveSession();
    const now = new Date();

    for (const pair of FOREX_PAIRS) {
      const quote = this.quotes.get(pair.symbol);
      const history = this.priceHistory.get(pair.symbol);

      if (!quote || !history || history.length < 50) continue;

      const closes = history.slice(-100);
      const current = closes[closes.length - 1];
      const prev = closes[closes.length - 2] || current;

      // RSI (14-period)
      let gains = 0, losses = 0;
      for (let i = closes.length - 14; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
      }
      const rs = losses === 0 ? 100 : gains / losses;
      const rsi = 100 - (100 / (1 + rs));

      // EMA-9 and EMA-21
      const calcEma = (data: number[], period: number) => {
        const k = 2 / (period + 1);
        let ema = data[0];
        for (let i = 1; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
        return ema;
      };
      const ema9 = calcEma(closes.slice(-20), 9);
      const ema21 = calcEma(closes.slice(-30), 21);

      // Momentum (5-bar and 20-bar)
      const mom5 = (current - closes[closes.length - 6]) / closes[closes.length - 6];
      const mom20 = closes.length >= 21 ? (current - closes[closes.length - 21]) / closes[closes.length - 21] : 0;

      // Bollinger Bands (20-period)
      const bb20 = closes.slice(-20);
      const bbMean = bb20.reduce((s, p) => s + p, 0) / bb20.length;
      const bbStd = Math.sqrt(bb20.reduce((s, p) => s + (p - bbMean) ** 2, 0) / bb20.length);
      const bbUpper = bbMean + 2 * bbStd;
      const bbLower = bbMean - 2 * bbStd;
      const bbPos = bbStd > 0 ? (current - bbLower) / (bbUpper - bbLower) : 0.5;

      // Score: each indicator votes
      let buyVotes = 0, sellVotes = 0;
      const reasons: string[] = [];

      // RSI
      if (rsi < 30) { buyVotes++; reasons.push(`RSI oversold (${rsi.toFixed(0)})`); }
      else if (rsi > 70) { sellVotes++; reasons.push(`RSI overbought (${rsi.toFixed(0)})`); }

      // EMA crossover
      if (ema9 > ema21 && current > ema9) { buyVotes++; reasons.push('EMA bullish'); }
      else if (ema9 < ema21 && current < ema9) { sellVotes++; reasons.push('EMA bearish'); }

      // Momentum
      if (mom5 > 0.001 && mom20 > 0) { buyVotes++; reasons.push(`Momentum up +${(mom5 * 100).toFixed(2)}%`); }
      else if (mom5 < -0.001 && mom20 < 0) { sellVotes++; reasons.push(`Momentum down ${(mom5 * 100).toFixed(2)}%`); }

      // Bollinger position
      if (bbPos < 0.15 && current > prev) { buyVotes++; reasons.push('BB bounce from lower'); }
      else if (bbPos > 0.85 && current < prev) { sellVotes++; reasons.push('BB rejection from upper'); }

      // Need minimum 3 indicators agreeing
      const totalVotes = Math.max(buyVotes, sellVotes);
      if (totalVotes < 3) continue;

      const direction: 'long' | 'short' = buyVotes > sellVotes ? 'long' : 'short';
      const confidence = totalVotes / 4; // max 4 indicators

      const isJpy = pair.symbol.includes('JPY');
      const pipMultiplier = isJpy ? 0.01 : 0.0001;
      // SL: 40 pips, TP: 80 pips = 2:1 R/R (TP always > SL)
      const stopDistance = 40 * pipMultiplier;
      const tpDistance = 80 * pipMultiplier;

      signals.push({
        symbol: pair.symbol,
        strategy: 'neural_momentum',
        direction,
        confidence,
        entry: quote.mid,
        stopLoss: direction === 'long' ? quote.mid - stopDistance : quote.mid + stopDistance,
        takeProfit: direction === 'long' ? quote.mid + tpDistance : quote.mid - tpDistance,
        rationale: `${direction.toUpperCase()} ${pair.symbol} — ${reasons.join(', ')} (${session} session, ${totalVotes}/4 indicators)`,
        timestamp: now,
      });
    }

    return signals;
  }

  /** Carry trades removed — was 3W/22L on AUD/JPY. Use neural momentum for all pairs. */
  evaluateCarryTrades(): ForexSignal[] {
    return []; // Disabled — no edge demonstrated
  }

  async onHeartbeat(): Promise<void> {
    await this.fetchQuotes();
    this.evaluateSessionMomentum();
    this.evaluateCarryTrades();
    this.emit('heartbeat', {
      session: this.getActiveSession(),
      quotesCount: this.quotes.size,
      timestamp: new Date(),
    });
  }

  start(intervalMs: number = 60_000): void {
    if (this.intervalHandle) {
      return;
    }

    this.onHeartbeat();
    this.intervalHandle = setInterval(() => this.onHeartbeat(), intervalMs);
    this.emit('started', { intervalMs });
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.emit('stopped');
    }
  }

  getQuotes(): ForexQuote[] {
    return Array.from(this.quotes.values());
  }

  getOpenTrades(): Promise<any[]> {
    if (!this.oandaApiKey || !this.oandaAccountId) return Promise.resolve([]);
    return fetch(`${this.oandaBaseUrl}/v3/accounts/${this.oandaAccountId}/openTrades`, {
      headers: { Authorization: `Bearer ${this.oandaApiKey}` },
    }).then(r => r.json()).then(d => d.trades || []).catch(() => []);
  }

  async placeOrder(instrument: string, units: number, stopLoss?: number, takeProfit?: number): Promise<any> {
    if (!this.oandaApiKey || !this.oandaAccountId) {
      throw new Error('OANDA not configured');
    }

    const orderBody: any = {
      order: {
        type: 'MARKET',
        instrument: instrument.replace('/', '_'),
        units: String(units), // positive = buy, negative = sell
        timeInForce: 'FOK',
      },
    };

    if (stopLoss) {
      const isJpy = instrument.includes('JPY');
      orderBody.order.stopLossOnFill = {
        price: stopLoss.toFixed(isJpy ? 3 : 5),
        timeInForce: 'GTC',
      };
    }

    if (takeProfit) {
      const isJpy = instrument.includes('JPY');
      orderBody.order.takeProfitOnFill = {
        price: takeProfit.toFixed(isJpy ? 3 : 5),
        timeInForce: 'GTC',
      };
    }

    const res = await fetch(`${this.oandaBaseUrl}/v3/accounts/${this.oandaAccountId}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.oandaApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderBody),
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg = data.errorMessage || JSON.stringify(data);
      this.emit('error', new Error(`Order failed: ${errMsg}`));
      throw new Error(errMsg);
    }

    this.emit('orderFilled', { instrument, units, data });
    return data;
  }

  async closePosition(instrument: string): Promise<any> {
    if (!this.oandaApiKey || !this.oandaAccountId) {
      throw new Error('OANDA not configured');
    }

    const normalized = instrument.replace('/', '_');

    // First check which direction the position is (long or short) to send the right close body
    const posRes = await fetch(
      `${this.oandaBaseUrl}/v3/accounts/${this.oandaAccountId}/positions/${normalized}`,
      { headers: { Authorization: `Bearer ${this.oandaApiKey}` } }
    );

    let closeBody: Record<string, string> = { longUnits: 'ALL' }; // default to long
    if (posRes.ok) {
      const posData = await posRes.json() as any;
      const longUnits = parseFloat(posData.position?.long?.units || '0');
      const shortUnits = parseFloat(posData.position?.short?.units || '0');
      if (Math.abs(shortUnits) > 0 && longUnits === 0) {
        closeBody = { shortUnits: 'ALL' };
      } else if (longUnits > 0 && Math.abs(shortUnits) > 0) {
        closeBody = { longUnits: 'ALL', shortUnits: 'ALL' };
      }
    }

    const res = await fetch(
      `${this.oandaBaseUrl}/v3/accounts/${this.oandaAccountId}/positions/${normalized}/close`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.oandaApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(closeBody),
      }
    );

    return res.json();
  }
}

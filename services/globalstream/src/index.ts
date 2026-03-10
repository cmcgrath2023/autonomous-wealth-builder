import EventEmitter from 'eventemitter3';
import type { GlobalStreamConfig, DataSourceType } from './types.js';

export interface MarketSession {
  id: string;
  name: string;
  exchange: string;
  timezone: string;
  openUTC: string;   // HH:MM format
  closeUTC: string;   // HH:MM format
  instruments: string[];
  dataSource: DataSourceType;
}

export interface GlobalQuote {
  symbol: string;
  session: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: Date;
}

export const MARKET_SESSIONS: MarketSession[] = [
  {
    id: 'sydney',
    name: 'Sydney',
    exchange: 'ASX',
    timezone: 'Australia/Sydney',
    openUTC: '00:00',
    closeUTC: '06:00',
    instruments: ['EWA', 'AAAU', 'AUD/USD', 'AUD/JPY', 'NZD/USD'],
    dataSource: 'yahoo',
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    exchange: 'TSE',
    timezone: 'Asia/Tokyo',
    openUTC: '00:00',
    closeUTC: '06:00',
    instruments: ['EWJ', 'DXJ', 'USD/JPY', 'EUR/JPY', 'GBP/JPY'],
    dataSource: 'yahoo',
  },
  {
    id: 'hongkong',
    name: 'Hong Kong',
    exchange: 'HKEX',
    timezone: 'Asia/Hong_Kong',
    openUTC: '01:30',
    closeUTC: '08:00',
    instruments: ['EWH', 'MCHI', 'FXI', 'USD/HKD', 'USD/CNH', 'AUD/CNH'],
    dataSource: 'yahoo',
  },
  {
    id: 'london',
    name: 'London',
    exchange: 'LSE',
    timezone: 'Europe/London',
    openUTC: '08:00',
    closeUTC: '16:30',
    instruments: ['EWU', 'HEDJ', 'GBP/USD', 'EUR/GBP', 'EUR/USD'],
    dataSource: 'yahoo',
  },
  {
    id: 'frankfurt',
    name: 'Frankfurt',
    exchange: 'XETRA',
    timezone: 'Europe/Berlin',
    openUTC: '08:00',
    closeUTC: '16:30',
    instruments: ['EWG', 'DAX', 'EUR/USD', 'EUR/CHF', 'EUR/GBP'],
    dataSource: 'yahoo',
  },
  {
    id: 'newyork',
    name: 'New York',
    exchange: 'NYSE/NASDAQ',
    timezone: 'America/New_York',
    openUTC: '14:30',
    closeUTC: '21:00',
    instruments: ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'USD/CAD', 'USD/MXN'],
    dataSource: 'alpaca',
  },
  {
    id: 'crypto',
    name: 'Crypto',
    exchange: '24/7',
    timezone: 'UTC',
    openUTC: '00:00',
    closeUTC: '23:59',
    instruments: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD'],
    dataSource: 'crypto',
  },
];

export class GlobalStream extends EventEmitter {
  private config: Partial<GlobalStreamConfig>;
  private quotes: Map<string, GlobalQuote> = new Map();
  private intervalId?: ReturnType<typeof setInterval>;
  private running = false;
  private pollIntervalMs: number;

  constructor(config?: { alpacaKey?: string; alpacaSecret?: string; ibkrEnabled?: boolean }) {
    super();
    this.config = {
      alpacaKey: config?.alpacaKey,
      alpacaSecret: config?.alpacaSecret,
      ibkrEnabled: config?.ibkrEnabled ?? false,
      yahooEnabled: true,
      heartbeatMs: 30_000,
    };
    this.pollIntervalMs = 60_000;
  }

  /**
   * Returns sessions whose trading window contains the current UTC time.
   * Handles the midnight crossover case where openUTC > closeUTC.
   */
  getActiveSessions(): MarketSession[] {
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    return MARKET_SESSIONS.filter((session) => {
      // Crypto is always active
      if (session.id === 'crypto') return true;

      const [openH, openM] = session.openUTC.split(':').map(Number);
      const [closeH, closeM] = session.closeUTC.split(':').map(Number);
      const openMinutes = openH * 60 + openM;
      const closeMinutes = closeH * 60 + closeM;

      if (openMinutes <= closeMinutes) {
        // Normal case: open and close on the same day
        return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
      }
      // Midnight crossover: open is in the evening, close is the next morning
      return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
    });
  }

  /**
   * Fetch quotes from Yahoo Finance for the given symbols.
   */
  async fetchYahooQuotes(symbols: string[]): Promise<GlobalQuote[]> {
    const results: GlobalQuote[] = [];

    for (const symbol of symbols) {
      try {
        // Convert forex pairs: EUR/USD -> EURUSD=X
        const yahooSymbol = symbol.includes('/')
          ? `${symbol.replace('/', '')}=X`
          : symbol;

        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) MTWM-GlobalStream/1.0',
          },
        });

        if (!response.ok) {
          console.warn(`[GlobalStream] Yahoo fetch failed for ${symbol}: ${response.status}`);
          continue;
        }

        const data = await response.json() as any;
        const result = data?.chart?.result?.[0];
        if (!result) continue;

        const meta = result.meta;
        const price = meta.regularMarketPrice ?? 0;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
        const change = price - prevClose;
        const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;
        const volume = meta.regularMarketVolume ?? 0;

        const quote: GlobalQuote = {
          symbol,
          session: this.findSessionForSymbol(symbol),
          price,
          change,
          changePercent,
          volume,
          timestamp: new Date(),
        };

        results.push(quote);
        this.quotes.set(symbol, quote);
      } catch (err) {
        console.error(`[GlobalStream] Yahoo error for ${symbol}:`, err);
      }
    }

    return results;
  }

  /**
   * Delegate Alpaca quote fetching to MidStream via 'delegate' event.
   * MidStream handles Alpaca API credentials and connection.
   */
  async fetchAlpacaQuotes(symbols: string[]): Promise<GlobalQuote[]> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[GlobalStream] Alpaca delegate timed out, returning empty');
        resolve([]);
      }, 10_000);

      this.emit('delegate', {
        source: 'alpaca',
        symbols,
        callback: (quotes: GlobalQuote[]) => {
          clearTimeout(timeout);
          for (const q of quotes) {
            this.quotes.set(q.symbol, q);
          }
          resolve(quotes);
        },
      });
    });
  }

  /**
   * Start the polling loop. Iterates active sessions, fetches quotes
   * per data source, and emits 'quote' and 'heartbeat' events.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('[GlobalStream] Starting international market data service');

    // Initial fetch
    await this.pollActiveSessions();

    // Periodic polling
    this.intervalId = setInterval(async () => {
      await this.pollActiveSessions();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the polling loop and clean up.
   */
  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    console.log('[GlobalStream] Stopped');
  }

  /**
   * Get a single quote by symbol.
   */
  getQuote(symbol: string): GlobalQuote | undefined {
    return this.quotes.get(symbol);
  }

  /**
   * Get all cached quotes.
   */
  getAllQuotes(): GlobalQuote[] {
    return Array.from(this.quotes.values());
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async pollActiveSessions(): Promise<void> {
    const active = this.getActiveSessions();
    console.log(`[GlobalStream] Polling ${active.length} active sessions: ${active.map(s => s.id).join(', ')}`);

    // Group instruments by data source
    const bySource = new Map<DataSourceType, string[]>();
    for (const session of active) {
      const existing = bySource.get(session.dataSource) ?? [];
      existing.push(...session.instruments);
      bySource.set(session.dataSource, [...new Set(existing)]);
    }

    // Fetch from each source
    const allQuotes: GlobalQuote[] = [];

    const yahooSymbols = bySource.get('yahoo') ?? [];
    const cryptoSymbols = bySource.get('crypto') ?? [];
    const alpacaSymbols = bySource.get('alpaca') ?? [];

    // Yahoo handles both yahoo and crypto-as-yahoo sources
    if (yahooSymbols.length > 0 || cryptoSymbols.length > 0) {
      const combined = [...yahooSymbols, ...cryptoSymbols];
      const quotes = await this.fetchYahooQuotes(combined);
      allQuotes.push(...quotes);
    }

    // Alpaca delegation
    if (alpacaSymbols.length > 0 && this.config.alpacaKey) {
      const quotes = await this.fetchAlpacaQuotes(alpacaSymbols);
      allQuotes.push(...quotes);
    }

    // Emit individual quote events
    for (const quote of allQuotes) {
      this.emit('quote', quote);
    }

    // Heartbeat
    this.emit('heartbeat', {
      timestamp: new Date(),
      activeSessions: active.map(s => s.id),
      quoteCount: allQuotes.length,
      totalCached: this.quotes.size,
    });
  }

  private findSessionForSymbol(symbol: string): string {
    for (const session of MARKET_SESSIONS) {
      if (session.instruments.includes(symbol)) {
        return session.id;
      }
    }
    return 'unknown';
  }
}

export type { GlobalStreamConfig, DataSourceType, SessionStatus } from './types.js';

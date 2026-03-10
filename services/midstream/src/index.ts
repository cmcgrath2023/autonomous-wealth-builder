import EventEmitter from 'eventemitter3';
import { MarketData, MarketFeed, NewsItem, SentimentData } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';

export interface MidStreamConfig {
  watchlist: string[];
  refreshIntervalMs: number;
  alpacaApiKey?: string;
  alpacaApiSecret?: string;
  alpacaBaseUrl?: string;
  newsApiKey?: string;
}

const DEFAULT_CONFIG: MidStreamConfig = {
  watchlist: [
    // High-volatility crypto (24/7 trading)
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD', 'DOGE-USD',
    // High-beta stocks (momentum plays)
    'TSLA', 'NVDA', 'AMD', 'COIN', 'MARA', 'RIOT', 'PLTR', 'SOFI',
    // Defense / DoD contractors
    'LMT', 'RTX', 'NOC', 'GD', 'BA', 'LHX',
    // Bear / inverse plays (profit from downturns)
    'SQQQ', 'SPXS', 'UVXY', 'SH', 'PSQ',
    // Commodities & Energy (gas, oil, agriculture)
    'USO', 'UNG', 'UGA', 'DBO', 'GSG', 'DBA',
    // Precious metals (silver, gold, miners)
    'SLV', 'GLD', 'SIVR', 'GDX', 'GDXJ',
    // Major indices
    'SPY', 'QQQ', 'IWM',
  ],
  refreshIntervalMs: 30_000,
  alpacaBaseUrl: 'https://paper-api.alpaca.markets',
};

export class MidStream extends EventEmitter {
  private config: MidStreamConfig;
  private latestQuotes: Map<string, MarketData> = new Map();
  private intervalId?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(config?: Partial<MidStreamConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`[MidStream] Starting market data feed for ${this.config.watchlist.length} symbols`);

    // Initial fetch
    await this.fetchQuotes();

    // Periodic refresh
    this.intervalId = setInterval(() => this.fetchQuotes(), this.config.refreshIntervalMs);
  }

  stop() {
    this.running = false;
    if (this.intervalId) clearInterval(this.intervalId);
    console.log('[MidStream] Stopped');
  }

  async fetchQuotes(): Promise<MarketData[]> {
    const { alpacaApiKey, alpacaApiSecret, alpacaBaseUrl } = this.config;

    if (alpacaApiKey && alpacaApiSecret) {
      return this.fetchLiveQuotes(alpacaApiKey, alpacaApiSecret, alpacaBaseUrl!);
    }
    console.warn('[MidStream] No Alpaca credentials configured — no market data available');
    return [];
  }

  private async fetchLiveQuotes(apiKey: string, apiSecret: string, baseUrl: string): Promise<MarketData[]> {
    const headers = {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
    };
    const dataUrl = 'https://data.alpaca.markets';
    const results: MarketData[] = [];

    try {
      // Fetch stock quotes in batches (URL length limit ~2000 chars)
      const stockTickers = this.config.watchlist.filter(t => !t.includes('-'));
      const BATCH_SIZE = 50;
      for (let i = 0; i < stockTickers.length; i += BATCH_SIZE) {
        const batch = stockTickers.slice(i, i + BATCH_SIZE);
        try {
          const stockResponse = await fetch(
            `${dataUrl}/v2/stocks/snapshots?symbols=${batch.join(',')}&feed=iex`,
            { headers },
          );
          if (stockResponse.ok) {
            const snapshots = await stockResponse.json() as Record<string, any>;
            for (const [ticker, snapshot] of Object.entries(snapshots)) {
              const quote = this.parseStockSnapshot(ticker, snapshot);
              this.latestQuotes.set(ticker, quote);
              results.push(quote);
              eventBus.emit('market:update', { ticker, price: quote.price });
            }
          } else {
            console.error(`[MidStream] Alpaca stocks batch ${i / BATCH_SIZE + 1} error: ${stockResponse.status}`);
          }
        } catch (err) {
          console.error(`[MidStream] Batch ${i / BATCH_SIZE + 1} fetch failed:`, err);
        }
      }

      // Fetch crypto quotes
      const cryptoTickers = this.config.watchlist.filter(t => t.includes('-'));
      if (cryptoTickers.length > 0) {
        // Alpaca crypto uses slash format: BTC/USD not BTC-USD
        const cryptoSymbols = cryptoTickers.map(t => t.replace('-', '/')).join(',');
        const cryptoResponse = await fetch(
          `${dataUrl}/v1beta3/crypto/us/snapshots?symbols=${cryptoSymbols}`,
          { headers },
        );
        if (cryptoResponse.ok) {
          const cryptoData = await cryptoResponse.json() as { snapshots?: Record<string, any> };
          const snapshots = cryptoData.snapshots || cryptoData;
          for (const [symbol, snapshot] of Object.entries(snapshots)) {
            // Convert back: BTC/USD → BTC-USD
            const ticker = symbol.replace('/', '-');
            const quote = this.parseCryptoSnapshot(ticker, snapshot);
            this.latestQuotes.set(ticker, quote);
            results.push(quote);
            eventBus.emit('market:update', { ticker, price: quote.price });
          }
        } else {
          console.error(`[MidStream] Alpaca crypto API error: ${cryptoResponse.status} ${cryptoResponse.statusText}`);
        }
      }

      this.emit('quotes', results);
      return results;
    } catch (error) {
      console.error('[MidStream] Error fetching live quotes:', error);
      return [];
    }
  }

  private parseStockSnapshot(ticker: string, snapshot: any): MarketData {
    return {
      ticker,
      price: snapshot.latestTrade?.p || 0,
      open: snapshot.dailyBar?.o || 0,
      high: snapshot.dailyBar?.h || 0,
      low: snapshot.dailyBar?.l || 0,
      volume: snapshot.dailyBar?.v || 0,
      change: (snapshot.latestTrade?.p || 0) - (snapshot.dailyBar?.o || 0),
      changePercent: snapshot.dailyBar?.o ? ((snapshot.latestTrade?.p - snapshot.dailyBar.o) / snapshot.dailyBar.o) * 100 : 0,
      timestamp: new Date(),
    };
  }

  private parseCryptoSnapshot(ticker: string, snapshot: any): MarketData {
    const price = snapshot.latestTrade?.p || snapshot.latestQuote?.ap || 0;
    const open = snapshot.dailyBar?.o || price;
    return {
      ticker,
      price,
      open,
      high: snapshot.dailyBar?.h || price,
      low: snapshot.dailyBar?.l || price,
      volume: snapshot.dailyBar?.v || 0,
      change: price - open,
      changePercent: open ? ((price - open) / open) * 100 : 0,
      timestamp: new Date(),
    };
  }

  getLatestQuote(ticker: string): MarketData | undefined {
    return this.latestQuotes.get(ticker);
  }

  getAllQuotes(): MarketData[] {
    return Array.from(this.latestQuotes.values());
  }

  addToWatchlist(ticker: string) {
    if (!this.config.watchlist.includes(ticker)) {
      this.config.watchlist.push(ticker);
    }
  }

  removeFromWatchlist(ticker: string) {
    this.config.watchlist = this.config.watchlist.filter(t => t !== ticker);
    this.latestQuotes.delete(ticker);
  }
}

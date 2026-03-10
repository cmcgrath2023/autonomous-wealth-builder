# MTWM EXPANSION — CLAUDE CODE TECHNICAL SPECIFICATION

## Execution Context

This specification is designed for Claude Code execution using ruflow (Claude-Flow) orchestration.
All services follow the existing MTWM architecture patterns found in `/services/`.

**Existing Stack:**
- Gateway: Express + EventEmitter3 on port 3001
- Storage: SQLite via RVF Engine
- Broker: Alpaca Markets
- Autonomy: OpenClaw heartbeat system
- Types: Shared types in `/services/shared/`

---

## PHASE 1: NEW SERVICES DIRECTORY STRUCTURE

```bash
# Execute in project root
mkdir -p services/globalstream/src
mkdir -p services/commodities-trader/src
mkdir -p services/metals-trader/src
mkdir -p services/forex-scanner/src
mkdir -p services/reit-trader/src
mkdir -p services/options-trader/src
mkdir -p services/datacenter-infra/src
```

---

## SERVICE 1: GlobalStream (International Market Data)

### File: `services/globalstream/src/index.ts`

```typescript
/**
 * GlobalStream — International Market Data Service
 * Extends MidStream pattern for global coverage
 */

import { EventEmitter } from 'events';

// Session definitions for 24/7 coverage
interface MarketSession {
  id: string;
  name: string;
  exchange: string;
  timezone: string;
  openUTC: string;   // HH:MM UTC
  closeUTC: string;  // HH:MM UTC
  instruments: string[];
  dataSource: 'ibkr' | 'yahoo' | 'alpaca' | 'crypto';
}

const MARKET_SESSIONS: MarketSession[] = [
  {
    id: 'sydney',
    name: 'Sydney',
    exchange: 'ASX',
    timezone: 'Australia/Sydney',
    openUTC: '00:00',
    closeUTC: '06:00',
    instruments: ['EWA', 'AUDUSD', 'FXA'],
    dataSource: 'yahoo'
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    exchange: 'TSE',
    timezone: 'Asia/Tokyo',
    openUTC: '00:00',
    closeUTC: '06:00',
    instruments: ['EWJ', 'USDJPY', 'NKY'],
    dataSource: 'yahoo'
  },
  {
    id: 'hongkong',
    name: 'Hong Kong',
    exchange: 'HKEX',
    timezone: 'Asia/Hong_Kong',
    openUTC: '01:30',
    closeUTC: '08:00',
    instruments: ['EWH', 'FXI', 'HKDUSD'],
    dataSource: 'yahoo'
  },
  {
    id: 'london',
    name: 'London',
    exchange: 'LSE',
    timezone: 'Europe/London',
    openUTC: '08:00',
    closeUTC: '16:30',
    instruments: ['EWU', 'GBPUSD', 'FTSE'],
    dataSource: 'yahoo'
  },
  {
    id: 'frankfurt',
    name: 'Frankfurt',
    exchange: 'XETRA',
    timezone: 'Europe/Berlin',
    openUTC: '08:00',
    closeUTC: '16:30',
    instruments: ['EWG', 'EURUSD', 'DAX'],
    dataSource: 'yahoo'
  },
  {
    id: 'newyork',
    name: 'New York',
    exchange: 'NYSE/NASDAQ',
    timezone: 'America/New_York',
    openUTC: '14:30',
    closeUTC: '21:00',
    instruments: ['SPY', 'QQQ', 'DIA'],
    dataSource: 'alpaca'
  },
  {
    id: 'crypto',
    name: 'Crypto',
    exchange: 'Global',
    timezone: 'UTC',
    openUTC: '00:00',
    closeUTC: '23:59',
    instruments: ['BTCUSD', 'ETHUSD', 'SOLUSD'],
    dataSource: 'crypto'
  }
];

interface GlobalQuote {
  symbol: string;
  session: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: Date;
}

export class GlobalStream extends EventEmitter {
  private activeSessions: Set<string> = new Set();
  private quotes: Map<string, GlobalQuote> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: number = 60000; // 1 minute default

  constructor(private config: { 
    alpacaKey?: string;
    alpacaSecret?: string;
    ibkrEnabled?: boolean;
  }) {
    super();
  }

  /**
   * Determine which sessions are currently active
   */
  getActiveSessions(): MarketSession[] {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    const currentTime = utcHour * 60 + utcMinute;

    return MARKET_SESSIONS.filter(session => {
      const [openH, openM] = session.openUTC.split(':').map(Number);
      const [closeH, closeM] = session.closeUTC.split(':').map(Number);
      const openTime = openH * 60 + openM;
      const closeTime = closeH * 60 + closeM;

      // Handle sessions that cross midnight
      if (closeTime < openTime) {
        return currentTime >= openTime || currentTime <= closeTime;
      }
      return currentTime >= openTime && currentTime <= closeTime;
    });
  }

  /**
   * Fetch quotes from Yahoo Finance (free tier)
   */
  private async fetchYahooQuotes(symbols: string[]): Promise<GlobalQuote[]> {
    const quotes: GlobalQuote[] = [];
    
    for (const symbol of symbols) {
      try {
        // Yahoo Finance API endpoint
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'MTWM/1.0' }
        });
        
        if (response.ok) {
          const data = await response.json();
          const result = data.chart?.result?.[0];
          if (result) {
            const meta = result.meta;
            quotes.push({
              symbol,
              session: 'yahoo',
              price: meta.regularMarketPrice,
              change: meta.regularMarketPrice - meta.previousClose,
              changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
              volume: meta.regularMarketVolume || 0,
              timestamp: new Date()
            });
          }
        }
      } catch (error) {
        this.emit('error', { symbol, error });
      }
    }
    
    return quotes;
  }

  /**
   * Fetch quotes from Alpaca (existing integration)
   */
  private async fetchAlpacaQuotes(symbols: string[]): Promise<GlobalQuote[]> {
    // Delegate to existing MidStream service
    this.emit('delegate', { service: 'midstream', symbols });
    return []; // MidStream handles Alpaca
  }

  /**
   * Start the global market data stream
   */
  async start(): Promise<void> {
    this.pollInterval = setInterval(async () => {
      const activeSessions = this.getActiveSessions();
      
      for (const session of activeSessions) {
        let quotes: GlobalQuote[] = [];
        
        switch (session.dataSource) {
          case 'yahoo':
            quotes = await this.fetchYahooQuotes(session.instruments);
            break;
          case 'alpaca':
            quotes = await this.fetchAlpacaQuotes(session.instruments);
            break;
          case 'crypto':
            // Use Alpaca crypto or dedicated crypto feed
            quotes = await this.fetchAlpacaQuotes(session.instruments);
            break;
        }

        for (const quote of quotes) {
          quote.session = session.id;
          this.quotes.set(quote.symbol, quote);
          this.emit('quote', quote);
        }
      }

      this.emit('heartbeat', {
        activeSessions: activeSessions.map(s => s.id),
        quoteCount: this.quotes.size,
        timestamp: new Date()
      });
    }, this.heartbeatInterval);

    this.emit('started', { sessions: MARKET_SESSIONS.length });
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.emit('stopped');
  }

  getQuote(symbol: string): GlobalQuote | undefined {
    return this.quotes.get(symbol);
  }

  getAllQuotes(): GlobalQuote[] {
    return Array.from(this.quotes.values());
  }
}

export { MARKET_SESSIONS, MarketSession, GlobalQuote };
```

### File: `services/globalstream/src/types.ts`

```typescript
export interface GlobalStreamConfig {
  alpacaKey: string;
  alpacaSecret: string;
  ibkrEnabled: boolean;
  yahooEnabled: boolean;
  heartbeatMs: number;
}

export interface SessionStatus {
  id: string;
  name: string;
  isOpen: boolean;
  nextOpen: Date;
  nextClose: Date;
  instruments: string[];
}

export type DataSourceType = 'alpaca' | 'ibkr' | 'yahoo' | 'crypto';
```

---

## SERVICE 2: CommoditiesTrader (Agricultural + Energy)

### File: `services/commodities-trader/src/index.ts`

```typescript
/**
 * CommoditiesTrader — Agricultural, Livestock, Energy Commodities
 * Integrates with Neural Trader patterns for signal generation
 */

import { EventEmitter } from 'events';

interface CommodityContract {
  symbol: string;
  name: string;
  exchange: 'CME' | 'CBOT' | 'COMEX' | 'ICE' | 'NYMEX';
  category: 'livestock' | 'grains' | 'softs' | 'energy' | 'metals';
  contractSize: string;
  tickSize: number;
  tickValue: number;
  margin: number;
  tradingHours: string;
}

const COMMODITY_CONTRACTS: CommodityContract[] = [
  // Livestock
  { symbol: 'LE', name: 'Live Cattle', exchange: 'CME', category: 'livestock',
    contractSize: '40,000 lbs', tickSize: 0.00025, tickValue: 10, margin: 2200,
    tradingHours: '8:30-13:05 CT' },
  { symbol: 'HE', name: 'Lean Hogs', exchange: 'CME', category: 'livestock',
    contractSize: '40,000 lbs', tickSize: 0.00025, tickValue: 10, margin: 1500,
    tradingHours: '8:30-13:05 CT' },
  { symbol: 'GF', name: 'Feeder Cattle', exchange: 'CME', category: 'livestock',
    contractSize: '50,000 lbs', tickSize: 0.00025, tickValue: 12.50, margin: 3000,
    tradingHours: '8:30-13:05 CT' },
  
  // Grains
  { symbol: 'ZC', name: 'Corn', exchange: 'CBOT', category: 'grains',
    contractSize: '5,000 bu', tickSize: 0.25, tickValue: 12.50, margin: 1200,
    tradingHours: '19:00-07:45, 08:30-13:20 CT' },
  { symbol: 'ZS', name: 'Soybeans', exchange: 'CBOT', category: 'grains',
    contractSize: '5,000 bu', tickSize: 0.25, tickValue: 12.50, margin: 2000,
    tradingHours: '19:00-07:45, 08:30-13:20 CT' },
  { symbol: 'ZW', name: 'Wheat', exchange: 'CBOT', category: 'grains',
    contractSize: '5,000 bu', tickSize: 0.25, tickValue: 12.50, margin: 1500,
    tradingHours: '19:00-07:45, 08:30-13:20 CT' },
  
  // Energy
  { symbol: 'CL', name: 'Crude Oil', exchange: 'NYMEX', category: 'energy',
    contractSize: '1,000 bbl', tickSize: 0.01, tickValue: 10, margin: 6000,
    tradingHours: '18:00-17:00 CT' },
  { symbol: 'NG', name: 'Natural Gas', exchange: 'NYMEX', category: 'energy',
    contractSize: '10,000 MMBtu', tickSize: 0.001, tickValue: 10, margin: 2500,
    tradingHours: '18:00-17:00 CT' },
  
  // Metals (for DataCenter thesis)
  { symbol: 'HG', name: 'Copper', exchange: 'COMEX', category: 'metals',
    contractSize: '25,000 lbs', tickSize: 0.0005, tickValue: 12.50, margin: 4000,
    tradingHours: '18:00-17:00 CT' },
  { symbol: 'GC', name: 'Gold', exchange: 'COMEX', category: 'metals',
    contractSize: '100 oz', tickSize: 0.10, tickValue: 10, margin: 9000,
    tradingHours: '18:00-17:00 CT' },
  { symbol: 'SI', name: 'Silver', exchange: 'COMEX', category: 'metals',
    contractSize: '5,000 oz', tickSize: 0.005, tickValue: 25, margin: 8000,
    tradingHours: '18:00-17:00 CT' },
];

interface CommodityQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  openInterest: number;
  timestamp: Date;
}

interface CommoditySignal {
  symbol: string;
  type: 'momentum' | 'seasonal' | 'spread' | 'weather' | 'supply';
  direction: 'long' | 'short';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rationale: string;
  timestamp: Date;
}

interface SpreadPosition {
  id: string;
  longLeg: string;
  shortLeg: string;
  ratio: number;
  entrySpread: number;
  currentSpread: number;
  pnl: number;
}

export class CommoditiesTrader extends EventEmitter {
  private quotes: Map<string, CommodityQuote> = new Map();
  private signals: CommoditySignal[] = [];
  private spreads: Map<string, SpreadPosition> = new Map();
  private apiKey: string;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(config: { apiKey: string }) {
    super();
    this.apiKey = config.apiKey;
  }

  /**
   * Fetch commodity prices from Commodities-API
   */
  async fetchQuotes(symbols: string[]): Promise<CommodityQuote[]> {
    const quotes: CommodityQuote[] = [];
    
    try {
      // Using commodities-api.com
      const symbolList = symbols.join(',');
      const response = await fetch(
        `https://commodities-api.com/api/latest?access_key=${this.apiKey}&symbols=${symbolList}`
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.rates) {
          for (const [symbol, rate] of Object.entries(data.rates)) {
            const contract = COMMODITY_CONTRACTS.find(c => c.symbol === symbol);
            if (contract) {
              quotes.push({
                symbol,
                price: rate as number,
                open: 0, // Would need historical endpoint
                high: 0,
                low: 0,
                volume: 0,
                openInterest: 0,
                timestamp: new Date()
              });
            }
          }
        }
      }
    } catch (error) {
      this.emit('error', { type: 'fetch', error });
    }
    
    return quotes;
  }

  /**
   * Generate signals using Neural Trader patterns
   * Extends existing RSI/MACD/BB logic for commodities
   */
  generateSignals(quotes: CommodityQuote[]): CommoditySignal[] {
    const signals: CommoditySignal[] = [];
    
    for (const quote of quotes) {
      const contract = COMMODITY_CONTRACTS.find(c => c.symbol === quote.symbol);
      if (!contract) continue;

      // Emit to Neural Trader for technical analysis
      this.emit('analyzeRequest', {
        symbol: quote.symbol,
        price: quote.price,
        category: contract.category
      });
    }
    
    return signals;
  }

  /**
   * Cattle-Corn Spread Strategy
   * Long cattle when corn spikes (margin compression play)
   */
  async evaluateCattleCornSpread(): Promise<SpreadPosition | null> {
    const cattle = this.quotes.get('LE');
    const corn = this.quotes.get('ZC');
    
    if (!cattle || !corn) return null;

    // Cattle-corn ratio: price of cattle / price of corn
    // Historical average ~25-30, below 20 = cattle cheap relative to feed
    const ratio = cattle.price / corn.price;
    
    if (ratio < 22) {
      // Corn expensive relative to cattle = cattle margins compressed
      // But this is a BUYING opportunity for cattle (reversion)
      const spread: SpreadPosition = {
        id: `cattle-corn-${Date.now()}`,
        longLeg: 'LE',
        shortLeg: 'ZC',
        ratio: 1, // 1:1 simplified
        entrySpread: ratio,
        currentSpread: ratio,
        pnl: 0
      };
      
      this.emit('spreadSignal', {
        type: 'cattle-corn',
        direction: 'long-cattle',
        ratio,
        confidence: 0.7,
        rationale: 'Cattle cheap relative to feed costs, expect margin expansion'
      });
      
      return spread;
    }
    
    return null;
  }

  /**
   * Seasonal Hog Strategy
   * Buy September, sell February (winter demand cycle)
   */
  evaluateHogSeasonal(): CommoditySignal | null {
    const now = new Date();
    const month = now.getMonth(); // 0-indexed
    
    // September entry window (month 8)
    if (month === 8) {
      const hogs = this.quotes.get('HE');
      if (hogs) {
        return {
          symbol: 'HE',
          type: 'seasonal',
          direction: 'long',
          confidence: 0.65,
          entry: hogs.price,
          stopLoss: hogs.price * 0.95,
          takeProfit: hogs.price * 1.12,
          rationale: 'Seasonal winter demand cycle, target February exit',
          timestamp: new Date()
        };
      }
    }
    
    return null;
  }

  /**
   * OpenClaw Integration: Heartbeat handler
   */
  async onHeartbeat(): Promise<void> {
    // 1. Fetch latest quotes
    const symbols = COMMODITY_CONTRACTS.map(c => c.symbol);
    const quotes = await this.fetchQuotes(symbols);
    
    for (const quote of quotes) {
      this.quotes.set(quote.symbol, quote);
    }
    
    // 2. Evaluate spread strategies
    await this.evaluateCattleCornSpread();
    
    // 3. Evaluate seasonal strategies
    const seasonalSignal = this.evaluateHogSeasonal();
    if (seasonalSignal) {
      this.signals.push(seasonalSignal);
      this.emit('signal', seasonalSignal);
    }
    
    // 4. Emit heartbeat status
    this.emit('heartbeat', {
      quoteCount: this.quotes.size,
      signalCount: this.signals.length,
      spreadCount: this.spreads.size,
      timestamp: new Date()
    });
  }

  /**
   * Authority Matrix Integration
   */
  getPositionSizing(signal: CommoditySignal, portfolioValue: number): number {
    const contract = COMMODITY_CONTRACTS.find(c => c.symbol === signal.symbol);
    if (!contract) return 0;

    // Max 5% per commodity position
    const maxAllocation = portfolioValue * 0.05;
    
    // Kelly-adjusted based on confidence
    const kellyFraction = 0.5; // Half-Kelly
    const adjustedSize = maxAllocation * signal.confidence * kellyFraction;
    
    // Check margin requirements
    const contracts = Math.floor(adjustedSize / contract.margin);
    
    return Math.max(1, contracts);
  }

  start(): void {
    this.pollInterval = setInterval(() => this.onHeartbeat(), 60000);
    this.emit('started');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.emit('stopped');
  }
}

export { COMMODITY_CONTRACTS, CommodityContract, CommodityQuote, CommoditySignal };
```

---

## SERVICE 3: DataCenterInfra (AI Supply Chain Plays)

### File: `services/datacenter-infra/src/index.ts`

```typescript
/**
 * DataCenterInfra — AI Supply Chain Thesis Trading
 * Copper, Uranium, Natural Gas, Rare Earths
 */

import { EventEmitter } from 'events';

interface InfraAsset {
  symbol: string;
  name: string;
  type: 'futures' | 'stock' | 'etf';
  category: 'copper' | 'uranium' | 'natgas' | 'rare_earth' | 'power';
  thesis: string;
  correlation: string[]; // Correlated AI/tech stocks
}

const DATACENTER_ASSETS: InfraAsset[] = [
  // Copper - Data center wiring
  { symbol: 'HG', name: 'Copper Futures', type: 'futures', category: 'copper',
    thesis: 'AI data centers use 27 tonnes copper per MW',
    correlation: ['NVDA', 'MSFT', 'META', 'GOOGL'] },
  { symbol: 'FCX', name: 'Freeport-McMoRan', type: 'stock', category: 'copper',
    thesis: 'Largest US copper producer',
    correlation: ['HG', 'COPX'] },
  { symbol: 'SCCO', name: 'Southern Copper', type: 'stock', category: 'copper',
    thesis: 'Peru exposure, high margins',
    correlation: ['HG', 'COPX'] },
  { symbol: 'COPX', name: 'Copper Miners ETF', type: 'etf', category: 'copper',
    thesis: 'Diversified copper exposure',
    correlation: ['HG', 'FCX', 'SCCO'] },

  // Uranium - Nuclear power for data centers
  { symbol: 'CCJ', name: 'Cameco', type: 'stock', category: 'uranium',
    thesis: 'Largest Western uranium producer',
    correlation: ['CEG', 'URA'] },
  { symbol: 'CEG', name: 'Constellation Energy', type: 'stock', category: 'uranium',
    thesis: 'Meta 1.1GW deal, 21 reactors',
    correlation: ['CCJ', 'TLN', 'META'] },
  { symbol: 'TLN', name: 'Talen Energy', type: 'stock', category: 'uranium',
    thesis: 'Nuclear + data center co-location',
    correlation: ['CEG', 'CCJ'] },
  { symbol: 'D', name: 'Dominion Energy', type: 'stock', category: 'uranium',
    thesis: 'SMR development with Amazon',
    correlation: ['CEG', 'AMZN'] },
  { symbol: 'URA', name: 'Uranium Mining ETF', type: 'etf', category: 'uranium',
    thesis: 'Diversified uranium exposure',
    correlation: ['CCJ', 'CEG'] },

  // Natural Gas - Bridge fuel for AI power
  { symbol: 'NG', name: 'Natural Gas Futures', type: 'futures', category: 'natgas',
    thesis: '+6 bcf/day demand by 2030 from data centers',
    correlation: ['LNG', 'EQT'] },
  { symbol: 'LNG', name: 'Cheniere Energy', type: 'stock', category: 'natgas',
    thesis: 'LNG export infrastructure',
    correlation: ['NG', 'EQT'] },
  { symbol: 'EQT', name: 'EQT Corporation', type: 'stock', category: 'natgas',
    thesis: 'Appalachian producer',
    correlation: ['NG', 'LNG'] },

  // Rare Earths - Semiconductor supply
  { symbol: 'MP', name: 'MP Materials', type: 'stock', category: 'rare_earth',
    thesis: 'Only operating US rare earth mine',
    correlation: ['REMX', 'NVDA'] },
  { symbol: 'REMX', name: 'Rare Earth ETF', type: 'etf', category: 'rare_earth',
    thesis: 'Diversified rare earth exposure',
    correlation: ['MP', 'ALB'] },
  { symbol: 'ALB', name: 'Albemarle', type: 'stock', category: 'rare_earth',
    thesis: 'Lithium for battery storage',
    correlation: ['REMX', 'LAC'] },

  // Power/Utilities
  { symbol: 'VST', name: 'Vistra', type: 'stock', category: 'power',
    thesis: 'Texas data center power exposure',
    correlation: ['CEG', 'TLN'] },
  { symbol: 'NEE', name: 'NextEra Energy', type: 'stock', category: 'power',
    thesis: 'Renewable energy for data centers',
    correlation: ['VST', 'SO'] },
];

interface AICapexEvent {
  company: string;
  amount: number; // USD billions
  announcementDate: Date;
  focus: string;
  impactedAssets: string[];
}

interface SupplyChainSignal {
  category: 'copper' | 'uranium' | 'natgas' | 'rare_earth' | 'power';
  trigger: string;
  confidence: number;
  assets: string[];
  direction: 'long' | 'short';
  rationale: string;
  timestamp: Date;
}

export class DataCenterInfra extends EventEmitter {
  private assets: Map<string, { price: number; change: number }> = new Map();
  private aiCapexEvents: AICapexEvent[] = [];
  private signals: SupplyChainSignal[] = [];

  constructor() {
    super();
  }

  /**
   * Track AI capex announcements
   * These drive demand for infrastructure assets
   */
  registerCapexEvent(event: AICapexEvent): void {
    this.aiCapexEvents.push(event);
    
    // Generate signals based on capex
    const signal = this.generateCapexSignal(event);
    if (signal) {
      this.signals.push(signal);
      this.emit('signal', signal);
    }
  }

  /**
   * Generate supply chain signal from AI capex announcement
   */
  private generateCapexSignal(event: AICapexEvent): SupplyChainSignal | null {
    // Large capex announcements (>$10B) are bullish for infrastructure
    if (event.amount < 10) return null;

    // Determine which category benefits most
    let category: SupplyChainSignal['category'] = 'copper';
    let assets: string[] = [];

    if (event.focus.toLowerCase().includes('nuclear') || 
        event.focus.toLowerCase().includes('power')) {
      category = 'uranium';
      assets = ['CCJ', 'CEG', 'TLN', 'URA'];
    } else if (event.focus.toLowerCase().includes('data center')) {
      category = 'copper';
      assets = ['HG', 'FCX', 'SCCO', 'COPX'];
    }

    return {
      category,
      trigger: `${event.company} announced $${event.amount}B capex`,
      confidence: Math.min(0.8, event.amount / 100), // Scale with size
      assets,
      direction: 'long',
      rationale: `Large AI infrastructure spend drives ${category} demand`,
      timestamp: new Date()
    };
  }

  /**
   * Copper-AI Correlation Strategy
   * Track NVDA/MSFT/META and trade copper accordingly
   */
  async evaluateCopperAICorrelation(): Promise<SupplyChainSignal | null> {
    // Get AI stock performance
    const aiStocks = ['NVDA', 'MSFT', 'META', 'GOOGL'];
    let aiMomentum = 0;
    
    for (const stock of aiStocks) {
      const data = this.assets.get(stock);
      if (data) {
        aiMomentum += data.change;
      }
    }
    
    aiMomentum /= aiStocks.length;

    // Strong AI momentum (>2% average gain) = bullish copper
    if (aiMomentum > 2) {
      return {
        category: 'copper',
        trigger: `AI stocks average +${aiMomentum.toFixed(1)}% momentum`,
        confidence: 0.7,
        assets: ['HG', 'FCX', 'COPX'],
        direction: 'long',
        rationale: 'AI capex buildout drives copper demand',
        timestamp: new Date()
      };
    }
    
    return null;
  }

  /**
   * Nuclear Deal Monitoring
   * Meta/Amazon/Google nuclear deals = uranium bullish
   */
  async evaluateNuclearDeals(): Promise<SupplyChainSignal | null> {
    // Check for recent nuclear deal announcements
    const recentDeals = this.aiCapexEvents.filter(e => {
      const daysSince = (Date.now() - e.announcementDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince < 30 && e.focus.toLowerCase().includes('nuclear');
    });

    if (recentDeals.length > 0) {
      const totalCapex = recentDeals.reduce((sum, e) => sum + e.amount, 0);
      
      return {
        category: 'uranium',
        trigger: `${recentDeals.length} nuclear deals totaling $${totalCapex}B`,
        confidence: 0.75,
        assets: ['CCJ', 'CEG', 'TLN', 'URA'],
        direction: 'long',
        rationale: 'Tech company nuclear deals = uranium supply squeeze',
        timestamp: new Date()
      };
    }
    
    return null;
  }

  /**
   * OpenClaw Heartbeat Handler
   */
  async onHeartbeat(): Promise<void> {
    // Evaluate all supply chain signals
    const copperSignal = await this.evaluateCopperAICorrelation();
    if (copperSignal) {
      this.emit('signal', copperSignal);
    }

    const nuclearSignal = await this.evaluateNuclearDeals();
    if (nuclearSignal) {
      this.emit('signal', nuclearSignal);
    }

    this.emit('heartbeat', {
      assetCount: this.assets.size,
      capexEventCount: this.aiCapexEvents.length,
      signalCount: this.signals.length,
      timestamp: new Date()
    });
  }

  /**
   * Get assets by category for position building
   */
  getAssetsByCategory(category: InfraAsset['category']): InfraAsset[] {
    return DATACENTER_ASSETS.filter(a => a.category === category);
  }

  /**
   * Calculate sector allocation
   */
  getSectorAllocation(portfolioValue: number): Map<string, number> {
    const allocation = new Map<string, number>();
    
    // Max 20% total in datacenter infra
    const maxAllocation = portfolioValue * 0.20;
    
    // Distribute across categories
    allocation.set('copper', maxAllocation * 0.35);    // 7% of portfolio
    allocation.set('uranium', maxAllocation * 0.30);   // 6% of portfolio
    allocation.set('natgas', maxAllocation * 0.20);    // 4% of portfolio
    allocation.set('rare_earth', maxAllocation * 0.10); // 2% of portfolio
    allocation.set('power', maxAllocation * 0.05);     // 1% of portfolio
    
    return allocation;
  }
}

export { DATACENTER_ASSETS, InfraAsset, AICapexEvent, SupplyChainSignal };
```

---

## SERVICE 4: OpenClaw Integration Update

### File: `services/gateway/src/openclaw-expansion.ts`

```typescript
/**
 * OpenClaw Expansion — New Service Integration
 * Adds commodities, global markets, datacenter infra to autonomy engine
 */

import { EventEmitter } from 'events';
import { GlobalStream } from '../../globalstream/src';
import { CommoditiesTrader } from '../../commodities-trader/src';
import { DataCenterInfra } from '../../datacenter-infra/src';

interface OpenClawAgent {
  id: string;
  name: string;
  service: EventEmitter;
  autonomyLevel: 'observe' | 'suggest' | 'act';
  heartbeatInterval: number;
  enabled: boolean;
  lastHeartbeat: Date | null;
}

interface OpenClawConfig {
  defaultHeartbeat: number;
  nightModeStart: string; // HH:MM
  nightModeEnd: string;
  nightModeHeartbeat: number;
}

export class OpenClawExpansion extends EventEmitter {
  private agents: Map<string, OpenClawAgent> = new Map();
  private config: OpenClawConfig;
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: OpenClawConfig) {
    super();
    this.config = config;
  }

  /**
   * Register new expansion services
   */
  registerExpansionServices(services: {
    globalStream: GlobalStream;
    commoditiesTrader: CommoditiesTrader;
    dataCenterInfra: DataCenterInfra;
  }): void {
    // GlobalStream Agent
    this.agents.set('globalstream', {
      id: 'globalstream',
      name: 'Global Market Scanner',
      service: services.globalStream,
      autonomyLevel: 'observe', // Start in observe mode
      heartbeatInterval: 60000, // 1 minute
      enabled: true,
      lastHeartbeat: null
    });

    // Commodities Agent
    this.agents.set('commodities', {
      id: 'commodities',
      name: 'Commodities Trader',
      service: services.commoditiesTrader,
      autonomyLevel: 'suggest', // Generate signals, queue for approval
      heartbeatInterval: 300000, // 5 minutes
      enabled: true,
      lastHeartbeat: null
    });

    // DataCenter Infra Agent
    this.agents.set('datacenter-infra', {
      id: 'datacenter-infra',
      name: 'AI Supply Chain Monitor',
      service: services.dataCenterInfra,
      autonomyLevel: 'observe',
      heartbeatInterval: 900000, // 15 minutes
      enabled: true,
      lastHeartbeat: null
    });

    // Wire up event handlers
    this.wireEventHandlers(services);
  }

  /**
   * Wire event handlers between services
   */
  private wireEventHandlers(services: {
    globalStream: GlobalStream;
    commoditiesTrader: CommoditiesTrader;
    dataCenterInfra: DataCenterInfra;
  }): void {
    // GlobalStream -> Neural Trader delegation
    services.globalStream.on('quote', (quote) => {
      this.emit('quote', { source: 'globalstream', ...quote });
    });

    // Commodities signals -> Authority Matrix
    services.commoditiesTrader.on('signal', (signal) => {
      const agent = this.agents.get('commodities');
      if (agent?.autonomyLevel === 'suggest') {
        this.emit('pendingApproval', {
          agentId: 'commodities',
          type: 'commodity_signal',
          payload: signal
        });
      } else if (agent?.autonomyLevel === 'act') {
        this.emit('executeSignal', {
          agentId: 'commodities',
          signal
        });
      }
    });

    // Spread signals
    services.commoditiesTrader.on('spreadSignal', (spread) => {
      this.emit('pendingApproval', {
        agentId: 'commodities',
        type: 'spread_trade',
        payload: spread
      });
    });

    // DataCenter Infra signals
    services.dataCenterInfra.on('signal', (signal) => {
      this.emit('infraSignal', {
        agentId: 'datacenter-infra',
        signal
      });
    });

    // Heartbeat aggregation
    for (const [id, agent] of this.agents) {
      agent.service.on('heartbeat', (status) => {
        agent.lastHeartbeat = new Date();
        this.emit('agentHeartbeat', {
          agentId: id,
          agentName: agent.name,
          status
        });
      });
    }
  }

  /**
   * Start all expansion agents
   */
  startAll(): void {
    for (const [id, agent] of this.agents) {
      if (!agent.enabled) continue;

      // Start the service
      if ('start' in agent.service && typeof agent.service.start === 'function') {
        (agent.service as any).start();
      }

      // Set up heartbeat timer
      const timer = setInterval(() => {
        if ('onHeartbeat' in agent.service && typeof (agent.service as any).onHeartbeat === 'function') {
          (agent.service as any).onHeartbeat();
        }
      }, this.getHeartbeatInterval(agent));

      this.heartbeatTimers.set(id, timer);
    }

    this.emit('started', {
      agents: Array.from(this.agents.keys()),
      timestamp: new Date()
    });
  }

  /**
   * Get heartbeat interval (respects night mode)
   */
  private getHeartbeatInterval(agent: OpenClawAgent): number {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = hours * 60 + minutes;

    const [nightStartH, nightStartM] = this.config.nightModeStart.split(':').map(Number);
    const [nightEndH, nightEndM] = this.config.nightModeEnd.split(':').map(Number);
    const nightStart = nightStartH * 60 + nightStartM;
    const nightEnd = nightEndH * 60 + nightEndM;

    // Check if in night mode
    const isNightMode = nightStart > nightEnd
      ? (currentTime >= nightStart || currentTime <= nightEnd)
      : (currentTime >= nightStart && currentTime <= nightEnd);

    return isNightMode ? this.config.nightModeHeartbeat : agent.heartbeatInterval;
  }

  /**
   * Set autonomy level for an agent
   */
  setAutonomyLevel(agentId: string, level: 'observe' | 'suggest' | 'act'): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.autonomyLevel = level;
    this.emit('autonomyChanged', { agentId, level });
    return true;
  }

  /**
   * Get status of all expansion agents
   */
  getStatus(): { agents: OpenClawAgent[] } {
    return {
      agents: Array.from(this.agents.values())
    };
  }

  /**
   * Stop all agents
   */
  stopAll(): void {
    for (const [id, timer] of this.heartbeatTimers) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    for (const [id, agent] of this.agents) {
      if ('stop' in agent.service && typeof agent.service.stop === 'function') {
        (agent.service as any).stop();
      }
    }

    this.emit('stopped');
  }
}

export { OpenClawAgent, OpenClawConfig };
```

---

## SERVICE 5: Gateway Integration

### File: `services/gateway/src/routes/expansion.ts`

```typescript
/**
 * Gateway Routes for Expansion Services
 */

import { Router } from 'express';
import { GlobalStream } from '../../../globalstream/src';
import { CommoditiesTrader } from '../../../commodities-trader/src';
import { DataCenterInfra } from '../../../datacenter-infra/src';
import { OpenClawExpansion } from '../openclaw-expansion';

export function createExpansionRoutes(
  openClaw: OpenClawExpansion,
  globalStream: GlobalStream,
  commodities: CommoditiesTrader,
  dataCenterInfra: DataCenterInfra
): Router {
  const router = Router();

  // Global Stream endpoints
  router.get('/global/sessions', (req, res) => {
    const sessions = globalStream.getActiveSessions();
    res.json({ sessions });
  });

  router.get('/global/quotes', (req, res) => {
    const quotes = globalStream.getAllQuotes();
    res.json({ quotes });
  });

  router.get('/global/quote/:symbol', (req, res) => {
    const quote = globalStream.getQuote(req.params.symbol);
    if (quote) {
      res.json({ quote });
    } else {
      res.status(404).json({ error: 'Quote not found' });
    }
  });

  // Commodities endpoints
  router.get('/commodities/contracts', (req, res) => {
    res.json({ contracts: COMMODITY_CONTRACTS });
  });

  router.post('/commodities/spread/evaluate', async (req, res) => {
    const spread = await commodities.evaluateCattleCornSpread();
    res.json({ spread });
  });

  router.post('/commodities/seasonal/evaluate', (req, res) => {
    const signal = commodities.evaluateHogSeasonal();
    res.json({ signal });
  });

  // DataCenter Infra endpoints
  router.get('/infra/assets', (req, res) => {
    res.json({ assets: DATACENTER_ASSETS });
  });

  router.get('/infra/assets/:category', (req, res) => {
    const category = req.params.category as any;
    const assets = dataCenterInfra.getAssetsByCategory(category);
    res.json({ assets });
  });

  router.post('/infra/capex-event', (req, res) => {
    const event = req.body;
    dataCenterInfra.registerCapexEvent(event);
    res.json({ registered: true });
  });

  router.get('/infra/allocation/:portfolioValue', (req, res) => {
    const portfolioValue = parseFloat(req.params.portfolioValue);
    const allocation = dataCenterInfra.getSectorAllocation(portfolioValue);
    res.json({ allocation: Object.fromEntries(allocation) });
  });

  // OpenClaw expansion control
  router.get('/openclaw/expansion/status', (req, res) => {
    const status = openClaw.getStatus();
    res.json(status);
  });

  router.post('/openclaw/expansion/autonomy/:agentId', (req, res) => {
    const { agentId } = req.params;
    const { level } = req.body;
    const success = openClaw.setAutonomyLevel(agentId, level);
    res.json({ success });
  });

  return router;
}
```

---

## RUFLOW BUILD PHASES

### Phase 1: Service Scaffolding

```yaml
# ruflow-phase-1.yaml
name: MTWM Expansion Phase 1
description: Create service directories and base files

tasks:
  - name: Create directories
    command: |
      mkdir -p services/globalstream/src
      mkdir -p services/commodities-trader/src
      mkdir -p services/metals-trader/src
      mkdir -p services/forex-scanner/src
      mkdir -p services/reit-trader/src
      mkdir -p services/datacenter-infra/src

  - name: Initialize package.json files
    command: |
      for dir in globalstream commodities-trader metals-trader forex-scanner reit-trader datacenter-infra; do
        cd services/$dir
        npm init -y
        npm install --save-dev typescript @types/node
        cd ../..
      done

  - name: Create tsconfig for each service
    command: |
      for dir in globalstream commodities-trader metals-trader forex-scanner reit-trader datacenter-infra; do
        cat > services/$dir/tsconfig.json << 'EOF'
      {
        "compilerOptions": {
          "target": "ES2022",
          "module": "NodeNext",
          "moduleResolution": "NodeNext",
          "outDir": "./dist",
          "rootDir": "./src",
          "strict": true,
          "esModuleInterop": true,
          "skipLibCheck": true
        },
        "include": ["src/**/*"]
      }
      EOF
      done

acceptance:
  - All directories exist under services/
  - Each service has package.json and tsconfig.json
  - TypeScript compiles without errors
```

### Phase 2: Core Service Implementation

```yaml
# ruflow-phase-2.yaml
name: MTWM Expansion Phase 2
description: Implement core service logic

tasks:
  - name: Implement GlobalStream
    files:
      - services/globalstream/src/index.ts
      - services/globalstream/src/types.ts
    acceptance:
      - getActiveSessions() returns correct sessions for current UTC time
      - fetchYahooQuotes() returns valid quote objects
      - start()/stop() manage polling correctly

  - name: Implement CommoditiesTrader
    files:
      - services/commodities-trader/src/index.ts
      - services/commodities-trader/src/types.ts
      - services/commodities-trader/src/spreads.ts
    acceptance:
      - evaluateCattleCornSpread() generates correct spread signals
      - evaluateHogSeasonal() respects month-based timing
      - getPositionSizing() respects 5% max allocation

  - name: Implement DataCenterInfra
    files:
      - services/datacenter-infra/src/index.ts
      - services/datacenter-infra/src/types.ts
    acceptance:
      - registerCapexEvent() generates supply chain signals
      - evaluateCopperAICorrelation() tracks AI stock momentum
      - getSectorAllocation() totals to 20% max

agents:
  - Neural Trader: Review signal generation patterns
  - MinCut: Validate position sizing calculations
  - SAFLA: Ensure drift detection extends to new services
```

### Phase 3: OpenClaw Integration

```yaml
# ruflow-phase-3.yaml
name: MTWM Expansion Phase 3
description: Integrate with OpenClaw autonomy engine

tasks:
  - name: Create OpenClaw expansion module
    files:
      - services/gateway/src/openclaw-expansion.ts
    acceptance:
      - All new services register as OpenClaw agents
      - Heartbeat system respects night mode
      - Autonomy levels (observe/suggest/act) work correctly

  - name: Create gateway routes
    files:
      - services/gateway/src/routes/expansion.ts
    acceptance:
      - All endpoints return correct data
      - POST endpoints validate input
      - Error handling returns appropriate status codes

  - name: Update gateway server
    files:
      - services/gateway/src/server.ts
    changes:
      - Import expansion services
      - Initialize GlobalStream, CommoditiesTrader, DataCenterInfra
      - Create OpenClawExpansion and register services
      - Add expansion routes

acceptance_criteria:
  - Gateway starts without errors
  - GET /api/expansion/global/sessions returns active sessions
  - GET /api/expansion/commodities/contracts returns contract list
  - GET /api/expansion/infra/assets returns datacenter assets
  - POST /api/expansion/openclaw/autonomy/:agentId changes agent level
```

### Phase 4: UI Integration

```yaml
# ruflow-phase-4.yaml
name: MTWM Expansion Phase 4
description: Add UI pages for new services

tasks:
  - name: Create Commodities page
    files:
      - mtwm-ui/app/commodities/page.tsx
    components:
      - Contract list with live prices
      - Spread position monitor
      - Seasonal signal calendar

  - name: Create Global Markets page
    files:
      - mtwm-ui/app/global/page.tsx
    components:
      - 3D globe with active sessions
      - Session timeline visualization
      - Quote ticker for all markets

  - name: Create Infrastructure page
    files:
      - mtwm-ui/app/infrastructure/page.tsx
    components:
      - Sector allocation chart
      - AI capex event feed
      - Supply chain signal list

  - name: Update navigation
    files:
      - mtwm-ui/components/layout/Sidebar.tsx
    changes:
      - Add Commodities link
      - Add Global link
      - Add Infrastructure link

acceptance_criteria:
  - All new pages load without errors
  - Real-time data updates via API
  - Navigation works correctly
```

---

## AUTHORITY MATRIX EXPANSION

### File: `services/authority-matrix/src/expansion-rules.ts`

```typescript
/**
 * Authority Matrix Expansion Rules
 * Extends governance for commodities, forex, options
 */

interface AuthorityRule {
  assetClass: string;
  action: string;
  thresholds: {
    autonomous: number;
    notify: number;
    approve: number;
  };
  conditions?: string[];
}

export const EXPANSION_RULES: AuthorityRule[] = [
  // Commodity Futures
  {
    assetClass: 'commodity_futures',
    action: 'single_trade',
    thresholds: {
      autonomous: 5000,
      notify: 25000,
      approve: Infinity
    },
    conditions: ['market_hours_only', 'position_limit_check']
  },
  {
    assetClass: 'commodity_futures',
    action: 'spread_trade',
    thresholds: {
      autonomous: 10000,
      notify: 50000,
      approve: Infinity
    }
  },
  {
    assetClass: 'commodity_futures',
    action: 'physical_delivery',
    thresholds: {
      autonomous: 0, // Never autonomous
      notify: 0,
      approve: 0 // Always require approval
    }
  },

  // Forex
  {
    assetClass: 'forex',
    action: 'single_trade',
    thresholds: {
      autonomous: 10000,
      notify: 50000,
      approve: Infinity
    }
  },
  {
    assetClass: 'forex',
    action: 'carry_trade',
    thresholds: {
      autonomous: 5000,
      notify: 25000,
      approve: Infinity
    }
  },

  // Options
  {
    assetClass: 'options',
    action: 'covered_call',
    thresholds: {
      autonomous: 5000,
      notify: 25000,
      approve: Infinity
    }
  },
  {
    assetClass: 'options',
    action: 'cash_secured_put',
    thresholds: {
      autonomous: 5000,
      notify: 25000,
      approve: Infinity
    }
  },
  {
    assetClass: 'options',
    action: 'naked_short',
    thresholds: {
      autonomous: 0, // Never autonomous
      notify: 0,
      approve: 0 // Always require approval
    }
  },

  // Sector Exposure
  {
    assetClass: 'sector',
    action: 'commodity_allocation',
    thresholds: {
      autonomous: 0.15, // 15% of portfolio
      notify: 0.20,
      approve: 0.25
    }
  },
  {
    assetClass: 'sector',
    action: 'datacenter_infra_allocation',
    thresholds: {
      autonomous: 0.20, // 20% of portfolio
      notify: 0.25,
      approve: 0.30
    }
  }
];

export function checkAuthority(
  assetClass: string,
  action: string,
  value: number,
  portfolioValue: number
): 'autonomous' | 'notify' | 'approve' {
  const rule = EXPANSION_RULES.find(
    r => r.assetClass === assetClass && r.action === action
  );

  if (!rule) return 'approve'; // Default to requiring approval

  // Handle percentage-based rules
  if (rule.thresholds.autonomous < 1) {
    const percent = value / portfolioValue;
    if (percent <= rule.thresholds.autonomous) return 'autonomous';
    if (percent <= rule.thresholds.notify) return 'notify';
    return 'approve';
  }

  // Handle absolute value rules
  if (value <= rule.thresholds.autonomous) return 'autonomous';
  if (value <= rule.thresholds.notify) return 'notify';
  return 'approve';
}
```

---

## ENVIRONMENT VARIABLES

```bash
# .env.expansion
# Add to existing .env

# GlobalStream
YAHOO_FINANCE_ENABLED=true
IBKR_ENABLED=false
IBKR_HOST=
IBKR_PORT=

# Commodities
COMMODITIES_API_KEY=your_commodities_api_key
CME_DATA_ENABLED=true

# Forex
OANDA_API_KEY=
OANDA_ACCOUNT_ID=

# Options
OPTIONS_BROKER=alpaca  # or ibkr

# OpenClaw Expansion
OPENCLAW_NIGHT_MODE_START=22:00
OPENCLAW_NIGHT_MODE_END=06:00
OPENCLAW_NIGHT_HEARTBEAT=300000
```

---

## EXECUTION COMMAND

```bash
# Run with ruflow
npx ruflow execute ./ruflow-phase-1.yaml
npx ruflow execute ./ruflow-phase-2.yaml
npx ruflow execute ./ruflow-phase-3.yaml
npx ruflow execute ./ruflow-phase-4.yaml

# Or execute all phases
npx ruflow execute-all ./ruflow-expansion/
```

---

## SUCCESS CRITERIA

1. **GlobalStream** returns quotes from active sessions 24/7
2. **CommoditiesTrader** generates cattle-corn spread signals
3. **DataCenterInfra** tracks AI capex → supply chain correlation
4. **OpenClaw** manages all new agents with heartbeat system
5. **Authority Matrix** enforces commodity/forex/options thresholds
6. **Gateway** exposes all endpoints correctly
7. **UI** displays new pages with real-time data

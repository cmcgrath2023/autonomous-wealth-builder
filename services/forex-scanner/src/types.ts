export interface ForexPair {
  symbol: string;
  base: string;
  quote: string;
  category: 'major' | 'carry' | 'cross';
  spread: number;
  pipValue: number;
}

export interface ForexQuote {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: Date;
}

export interface ForexSignal {
  symbol: string;
  strategy: 'session_momentum' | 'carry_trade' | 'news_play';
  direction: 'long' | 'short';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rationale: string;
  timestamp: Date;
}

export interface EconomicEvent {
  name: string;
  datetime: Date;
  currency: string;
  impact: 'high' | 'medium' | 'low';
  forecast: string;
  actual: string | null;
}

export interface TradeSignal {
  id: string;
  ticker: string;
  direction: 'buy' | 'sell' | 'short' | 'hold';
  confidence: number; // 0-1
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  indicators: Record<string, number>;
  pattern: string;
  timestamp: Date;
  source: 'neural_trader' | 'momentum' | 'mean_reversion' | 'sentiment';
}

export interface Position {
  ticker: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  sector: string;
  category: 'equity' | 'crypto' | 'alternative';
}

export interface Portfolio {
  positions: Position[];
  cash: number;
  totalValue: number;
  dayPnl: number;
  dayPnlPercent: number;
  sectorExposure: Record<string, number>;
}

export interface RiskMetrics {
  portfolioDrawdown: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sectorConcentration: Record<string, number>;
  correlationMatrix: Record<string, Record<string, number>>;
  kellyFraction: number;
  var95: number; // Value at Risk 95%
}

export interface AuthorityDecision {
  id: string;
  action: 'trade' | 'rebalance' | 'property_loi' | 'alt_entry' | 'strategy_change';
  amount: number;
  description: string;
  module: string;
  authority: 'autonomous' | 'notify' | 'require_approval';
  status: 'pending' | 'approved' | 'rejected' | 'auto_executed' | 'expired';
  createdAt: Date;
  resolvedAt?: Date;
  rvfId?: string;
  witnessHash?: string;
}

export interface MarketData {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  change: number;
  changePercent: number;
  timestamp: Date;
}

export interface MarketFeed {
  type: 'quote' | 'trade' | 'bar' | 'news' | 'sentiment';
  data: MarketData | NewsItem | SentimentData;
  timestamp: Date;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  tickers: string[];
  sentiment: number; // -1 to 1
  timestamp: Date;
}

export interface SentimentData {
  ticker: string;
  score: number; // -1 to 1
  volume: number; // mention count
  sources: string[];
  timestamp: Date;
}

export interface PropertyDeal {
  id: string;
  address: string;
  city: string;
  state: string;
  askingPrice: number;
  estimatedValue: number;
  capRate: number;
  cashFlow: number;
  score: number; // 0-10
  status: 'pipeline' | 'analyzing' | 'loi' | 'due_diligence' | 'closed' | 'passed';
  rvfId?: string;
}

export interface WitnessRecord {
  hash: string;
  previousHash: string;
  timestamp: Date;
  action: string;
  actor: string;
  module: string;
  payload: string; // JSON stringified
  signature?: string;
}

export interface SAFLAMetrics {
  strategyDrift: number; // 0-1, >0.3 triggers alert
  learningRate: number;
  feedbackLoopHealth: number; // 0-1
  autonomousDecisionAccuracy: number;
  interventionRate: number; // owner interventions per day
  lastCalibration: Date;
}

export interface CommodityContract {
  symbol: string;
  name: string;
  exchange: 'CME' | 'CBOT' | 'COMEX' | 'ICE' | 'NYMEX';
  category: 'livestock' | 'grains' | 'softs' | 'energy' | 'metals';
  contractSize: number;
  tickSize: number;
  tickValue: number;
  margin: number;
  tradingHours: string;
}

export interface CommodityQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  openInterest: number;
  timestamp: number;
}

export interface CommoditySignal {
  symbol: string;
  type: 'momentum' | 'seasonal' | 'spread' | 'weather' | 'supply';
  direction: 'long' | 'short';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rationale: string;
  timestamp: number;
}

export interface SpreadPosition {
  id: string;
  longLeg: string;
  shortLeg: string;
  ratio: number;
  entrySpread: number;
  currentSpread: number;
  pnl: number;
}

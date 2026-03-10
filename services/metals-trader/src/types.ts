export interface MetalAsset {
  symbol: string;
  name: string;
  type: 'futures' | 'etf' | 'stock';
  category: 'gold' | 'silver' | 'platinum' | 'palladium';
  margin: number;
}

export interface MetalQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: Date;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
}

export interface MetalSignal {
  symbol: string;
  strategy: 'gold_momentum' | 'silver_volatility' | 'vix_hedge';
  direction: 'long' | 'short';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rationale: string;
  timestamp: Date;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface OptionContract {
  symbol: string;
  underlying: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  greeks: Greeks;
}

export interface OptionSignal {
  underlying: string;
  strategy:
    | 'cash_secured_put'
    | 'covered_call'
    | 'protective_put'
    | 'collar'
    | 'long_call'
    | 'long_put'
    | 'vertical_spread';
  direction: 'long' | 'short';
  confidence: number;
  contracts: OptionContract[];
  maxLoss: number;
  maxGain: number;
  breakeven: number;
  rationale: string;
  timestamp: Date;
}

export interface IVRank {
  symbol: string;
  currentIV: number;
  ivRank: number;
  ivPercentile: number;
  high52w: number;
  low52w: number;
}

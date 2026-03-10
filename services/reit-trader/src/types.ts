export interface REITAsset {
  symbol: string;
  name: string;
  sector: 'datacenter' | 'industrial' | 'residential' | 'healthcare';
  dividendYield: number;
  exDivDate: string | null;
  navPerShare: number | null;
  priceToNAV: number | null;
}

export interface REITQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number | null;
  timestamp: Date;
}

export interface REITSignal {
  symbol: string;
  strategy: 'dividend_capture' | 'sector_rotation' | 'nav_discount';
  direction: 'long' | 'short';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rationale: string;
  exDivDate: string | null;
  timestamp: Date;
}

export interface PhaseAllocation {
  phase: 'building_capital' | 'first_deal' | 'portfolio_growth' | 'financial_fortress';
  reitPct: number;
  physicalPct: number;
}

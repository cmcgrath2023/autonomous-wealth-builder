export interface Asset {
  id: string;
  name: string;
  ticker?: string;
  value: number;
  change: number;
  changePercent: number;
  category: 'equity' | 'real_estate' | 'crypto' | 'cash' | 'alternative' | 'commodity';
  lat: number;
  lng: number;
  rvfId?: string;
  shares?: number;
  avgPrice?: number;
  currentPrice?: number;
}

export interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
}

export interface AutonomyStatus {
  enabled: boolean;
  level: string;
  heartbeatCount: number;
  startedAt: string | null;
  registeredActions: number;
}

export interface PortfolioState {
  totalValue: number;
  initialBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  unrealizedPnl: number;
  realizedPnl: number;
  dayChange: number;
  dayChangePercent: number;
  brokerConnected: boolean;
  buyingPower: number;
  cash: number;
  tradeStats: TradeStats;
  autonomy: AutonomyStatus | null;
  assets: Asset[];
  systemStatus: 'healthy' | 'warning' | 'critical' | 'error';
  lastUpdated: string | null;
}

export interface PortfolioAllocation {
  trading: number;
  realEstate: number;
  business: number;
  alternatives: number;
  cash: number;
}

import { create } from 'zustand';
import { Asset, PortfolioState, TradeStats, AutonomyStatus } from '@/types/portfolio';

interface PortfolioStore extends PortfolioState {
  fetchPortfolio: () => Promise<void>;
}

export const usePortfolioStore = create<PortfolioStore>((set) => ({
  totalValue: 0,
  initialBalance: 100_000,
  totalPnl: 0,
  totalPnlPercent: 0,
  unrealizedPnl: 0,
  realizedPnl: 0,
  dayChange: 0,
  dayChangePercent: 0,
  brokerConnected: false,
  buyingPower: 0,
  cash: 0,
  tradeStats: { totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgWin: 0, avgLoss: 0, bestTrade: 0, worstTrade: 0 },
  autonomy: null,
  assets: [],
  systemStatus: 'healthy',
  lastUpdated: null,

  fetchPortfolio: async () => {
    try {
      const response = await fetch('/api/portfolio');
      const data = await response.json();
      set({
        totalValue: data.totalValue,
        initialBalance: data.initialBalance,
        totalPnl: data.totalPnl,
        totalPnlPercent: data.totalPnlPercent,
        unrealizedPnl: data.unrealizedPnl,
        realizedPnl: data.realizedPnl,
        dayChange: data.dayChange,
        dayChangePercent: data.dayChangePercent,
        brokerConnected: data.brokerConnected,
        buyingPower: data.buyingPower,
        cash: data.cash,
        tradeStats: data.tradeStats,
        autonomy: data.autonomy,
        assets: data.assets,
        systemStatus: data.systemStatus,
        lastUpdated: data.lastUpdated,
      });
    } catch {
      set({ systemStatus: 'warning' });
    }
  },
}));

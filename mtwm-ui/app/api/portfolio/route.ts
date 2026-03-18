import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';
const INITIAL_BALANCE = 100_000; // Paper account starting balance

const ASSET_META: Record<string, { name: string; category: string; lat: number; lng: number }> = {
  'AAPL': { name: 'Apple', category: 'equity', lat: 37.33, lng: -122.03 },
  'NVDA': { name: 'NVIDIA', category: 'equity', lat: 37.37, lng: -121.96 },
  'MSFT': { name: 'Microsoft', category: 'equity', lat: 47.64, lng: -122.13 },
  'GOOGL': { name: 'Alphabet', category: 'equity', lat: 37.42, lng: -122.08 },
  'AMZN': { name: 'Amazon', category: 'equity', lat: 47.62, lng: -122.34 },
  'TSLA': { name: 'Tesla', category: 'equity', lat: 30.22, lng: -97.77 },
  'META': { name: 'Meta', category: 'equity', lat: 37.48, lng: -122.15 },
  'AMD': { name: 'AMD', category: 'equity', lat: 37.38, lng: -121.96 },
  'COIN': { name: 'Coinbase', category: 'equity', lat: 37.77, lng: -122.42 },
  'MARA': { name: 'Marathon', category: 'equity', lat: 25.78, lng: -80.19 },
  'RIOT': { name: 'Riot Platforms', category: 'equity', lat: 32.78, lng: -96.8 },
  'PLTR': { name: 'Palantir', category: 'equity', lat: 37.78, lng: -122.39 },
  'SOFI': { name: 'SoFi', category: 'equity', lat: 37.33, lng: -121.89 },
  'LMT': { name: 'Lockheed Martin', category: 'equity', lat: 38.89, lng: -77.03 },
  'RTX': { name: 'RTX (Raytheon)', category: 'equity', lat: 38.87, lng: -77.06 },
  'NOC': { name: 'Northrop Grumman', category: 'equity', lat: 38.93, lng: -77.17 },
  'GD': { name: 'General Dynamics', category: 'equity', lat: 38.88, lng: -77.11 },
  'BA': { name: 'Boeing', category: 'equity', lat: 41.88, lng: -87.64 },
  'LHX': { name: 'L3Harris', category: 'equity', lat: 28.23, lng: -80.72 },
  'SQQQ': { name: 'ProShares UltraPro Short QQQ', category: 'alternative', lat: 40.75, lng: -73.99 },
  'SPXS': { name: 'Direxion Daily S&P 500 Bear 3X', category: 'alternative', lat: 40.76, lng: -73.97 },
  'UVXY': { name: 'ProShares Ultra VIX', category: 'alternative', lat: 40.74, lng: -74.00 },
  'USO': { name: 'Crude Oil ETF', category: 'commodity', lat: 29.76, lng: -95.37 },
  'UNG': { name: 'Natural Gas ETF', category: 'commodity', lat: 29.76, lng: -95.35 },
  'GLD': { name: 'Gold ETF', category: 'commodity', lat: 40.71, lng: -74.01 },
  'SLV': { name: 'Silver ETF', category: 'commodity', lat: 40.71, lng: -74.02 },
  'CORN': { name: 'Corn ETF', category: 'commodity', lat: 41.88, lng: -87.63 },
  'WEAT': { name: 'Wheat ETF', category: 'commodity', lat: 41.88, lng: -87.62 },
  'BTC/USD': { name: 'Bitcoin', category: 'crypto', lat: 0, lng: 0 },
  'BTCUSD': { name: 'Bitcoin', category: 'crypto', lat: 0, lng: 0 },
  'BTC-USD': { name: 'Bitcoin', category: 'crypto', lat: 0, lng: 0 },
  'ETH/USD': { name: 'Ethereum', category: 'crypto', lat: 0, lng: 10 },
  'ETHUSD': { name: 'Ethereum', category: 'crypto', lat: 0, lng: 10 },
  'ETH-USD': { name: 'Ethereum', category: 'crypto', lat: 0, lng: 10 },
  'SOL/USD': { name: 'Solana', category: 'crypto', lat: 0, lng: 20 },
  'SOL-USD': { name: 'Solana', category: 'crypto', lat: 0, lng: 20 },
  'AVAX/USD': { name: 'Avalanche', category: 'crypto', lat: 0, lng: 30 },
  'AVAX-USD': { name: 'Avalanche', category: 'crypto', lat: 0, lng: 30 },
  'LINK/USD': { name: 'Chainlink', category: 'crypto', lat: 0, lng: 40 },
  'LINK-USD': { name: 'Chainlink', category: 'crypto', lat: 0, lng: 40 },
  'DOGE/USD': { name: 'Dogecoin', category: 'crypto', lat: 0, lng: 50 },
  'DOGE-USD': { name: 'Dogecoin', category: 'crypto', lat: 0, lng: 50 },
};

export async function GET() {
  try {
    const [accountRes, positionsRes, closedRes, autonomyRes, perfRes] = await Promise.all([
      fetch(`${GATEWAY}/api/broker/account`),
      fetch(`${GATEWAY}/api/broker/positions`),
      fetch(`${GATEWAY}/api/positions/closed?limit=100`).catch(() => null),
      fetch(`${GATEWAY}/api/autonomy/status`).catch(() => null),
      fetch(`${GATEWAY}/api/positions/performance`).catch(() => null),
    ]);

    const account = await accountRes.json();
    const { positions } = await positionsRes.json();
    const closedData = closedRes?.ok ? await closedRes.json() : { trades: [] };
    const autonomyData = autonomyRes?.ok ? await autonomyRes.json() : null;
    const perfData = perfRes?.ok ? await perfRes.json() : null;

    const assets = (positions || []).map((p: any) => {
      const meta = ASSET_META[p.ticker] || { name: p.ticker, category: 'equity', lat: 0, lng: 0 };
      return {
        id: p.ticker.toLowerCase().replace(/[/-]/g, ''),
        name: meta.name,
        ticker: p.ticker,
        value: Math.round(p.marketValue),
        change: p.unrealizedPnl,
        changePercent: p.unrealizedPnlPercent,
        category: meta.category,
        lat: meta.lat,
        lng: meta.lng,
        shares: p.shares,
        avgPrice: p.avgPrice,
        currentPrice: p.currentPrice,
      };
    });

    // Add cash as an asset
    if (account.cash > 0) {
      assets.push({
        id: 'cash',
        name: 'Cash',
        ticker: 'CASH',
        value: Math.round(account.cash),
        change: 0,
        changePercent: 0,
        category: 'cash',
        lat: 40.71,
        lng: -74.01,
        shares: 0,
        avgPrice: 0,
        currentPrice: 0,
      });
    }

    // P&L calculations
    const unrealizedPnl = assets.reduce((sum: number, a: any) => sum + (a.change || 0), 0);
    const totalValue = account.portfolioValue || 0;
    const totalPnl = totalValue - INITIAL_BALANCE; // TRUE total P&L from starting balance
    // Realized P&L = total P&L minus what's still unrealized (from Alpaca's actual data)
    const realizedFromAlpaca = totalPnl - unrealizedPnl;
    // Also check internal closed trades as a cross-reference
    const realizedFromTrades = (closedData.trades || []).reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
    // Use the Alpaca-derived number (it's authoritative), but if internal tracking is higher, use that
    const realizedPnl = Math.abs(realizedFromAlpaca) > Math.abs(realizedFromTrades) ? realizedFromAlpaca : realizedFromTrades;
    // Today's P&L from Alpaca (equity - last_equity from previous close)
    const dayPnl = account.dayPnl || 0;
    const dayPnlPercent = (account.lastEquity || 0) > 0 ? (dayPnl / account.lastEquity) * 100 : 0;

    // Performance stats
    const closedTrades = closedData.trades || [];
    const wins = closedTrades.filter((t: any) => (t.pnl || 0) > 0);
    const losses = closedTrades.filter((t: any) => (t.pnl || 0) < 0);

    return NextResponse.json({
      totalValue: Math.round(totalValue),
      initialBalance: INITIAL_BALANCE,
      // Total P&L = current equity - starting balance (the REAL number)
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalPnlPercent: INITIAL_BALANCE > 0 ? (totalPnl / INITIAL_BALANCE) * 100 : 0,
      // Breakdown
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      realizedPnl: Math.round(realizedPnl * 100) / 100,
      // Today's P&L (from Alpaca: equity - last_equity)
      dayPnl: Math.round(dayPnl * 100) / 100,
      dayPnlPercent: Math.round(dayPnlPercent * 100) / 100,
      // Legacy fields (keep backward compat)
      dayChange: Math.round(dayPnl),
      dayChangePercent: Math.round(dayPnlPercent * 100) / 100,
      // Broker status
      brokerConnected: account.connected || false,
      buyingPower: account.buyingPower || 0,
      cash: account.cash || 0,
      // Trade stats
      tradeStats: {
        totalTrades: closedTrades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
        avgWin: wins.length > 0 ? wins.reduce((s: number, t: any) => s + t.pnl, 0) / wins.length : 0,
        avgLoss: losses.length > 0 ? losses.reduce((s: number, t: any) => s + t.pnl, 0) / losses.length : 0,
        bestTrade: closedTrades.length > 0 ? Math.max(...closedTrades.map((t: any) => t.pnl || 0)) : 0,
        worstTrade: closedTrades.length > 0 ? Math.min(...closedTrades.map((t: any) => t.pnl || 0)) : 0,
      },
      // Autonomy
      autonomy: autonomyData ? {
        enabled: autonomyData.enabled,
        level: autonomyData.autonomyLevel,
        heartbeatCount: autonomyData.heartbeatCount,
        startedAt: autonomyData.startedAt,
        registeredActions: autonomyData.registeredActions?.length || 0,
      } : null,
      // Performance
      performance: perfData || null,
      // System
      systemStatus: account.connected ? 'healthy' : 'warning',
      lastUpdated: new Date().toISOString(),
      assets,
    });
  } catch {
    return NextResponse.json({
      totalValue: 0,
      initialBalance: INITIAL_BALANCE,
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
      performance: null,
      systemStatus: 'error',
      lastUpdated: new Date().toISOString(),
      assets: [],
    });
  }
}

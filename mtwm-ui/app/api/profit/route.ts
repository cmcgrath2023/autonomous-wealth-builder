import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

// US market close = 4:00 PM ET = 20:00 UTC (21:00 during DST transitions)
// Each "day" runs from previous close to current close

export async function GET() {
  try {
    // Fetch portfolio history from Alpaca via gateway (30 days, daily bars, per-day P&L reset)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const [historyRes, accountRes, closedRes, forexRes] = await Promise.all([
      fetch(`${GATEWAY}/api/broker/history?period=1M&timeframe=1D`, { signal: controller.signal }).catch(() => null),
      fetch(`${GATEWAY}/api/broker/account`, { signal: controller.signal }).catch(() => null),
      fetch(`${GATEWAY}/api/positions/closed?limit=200`, { signal: controller.signal }).catch(() => null),
      fetch('http://localhost:3003/api/forex/closedTrades', { signal: controller.signal }).catch(() => null),
    ]);

    clearTimeout(timeout);

    const history = historyRes?.ok ? await historyRes.json() : null;
    const account = accountRes?.ok ? await accountRes.json() : null;
    const closedData = closedRes?.ok ? await closedRes.json() : { trades: [] };
    const forexClosed = forexRes?.ok ? await forexRes.json() : { trades: [] };

    // Build daily P&L from Alpaca history
    const days: { date: string; equity: number; pnl: number; pnlPct: number }[] = [];

    if (history?.timestamp && history?.equity && history?.profit_loss) {
      for (let i = 0; i < history.timestamp.length; i++) {
        const ts = history.timestamp[i];
        const date = new Date(ts * 1000);
        days.push({
          date: date.toISOString().split('T')[0],
          equity: history.equity[i] || 0,
          pnl: history.profit_loss[i] || 0,
          pnlPct: history.profit_loss_pct?.[i] || 0,
        });
      }
    }

    // Current day from live account
    const dayPnl = account?.dayPnl || 0;
    const today = new Date().toISOString().split('T')[0];
    const todayEntry = days.find(d => d.date === today);
    if (!todayEntry && account) {
      days.push({
        date: today,
        equity: account.equity || account.portfolioValue || 0,
        pnl: dayPnl,
        pnlPct: account.lastEquity ? (dayPnl / account.lastEquity) * 100 : 0,
      });
    } else if (todayEntry && account) {
      // Update with live data
      todayEntry.pnl = dayPnl;
      todayEntry.equity = account.equity || account.portfolioValue || 0;
    }

    // Closed equity trades by day
    const equityTradesByDay: Record<string, { count: number; pnl: number; trades: any[] }> = {};
    for (const trade of (closedData.trades || [])) {
      const d = trade.closedAt ? new Date(trade.closedAt).toISOString().split('T')[0] : today;
      if (!equityTradesByDay[d]) equityTradesByDay[d] = { count: 0, pnl: 0, trades: [] };
      equityTradesByDay[d].count++;
      equityTradesByDay[d].pnl += trade.pnl || 0;
      equityTradesByDay[d].trades.push({
        ticker: trade.ticker,
        pnl: trade.pnl || 0,
        direction: trade.direction || 'long',
      });
    }

    // Closed forex trades by day
    const forexTradesByDay: Record<string, { count: number; pnl: number; trades: any[] }> = {};
    for (const trade of (forexClosed.trades || [])) {
      const d = trade.closeTime ? new Date(trade.closeTime).toISOString().split('T')[0] : today;
      if (!forexTradesByDay[d]) forexTradesByDay[d] = { count: 0, pnl: 0, trades: [] };
      forexTradesByDay[d].count++;
      forexTradesByDay[d].pnl += trade.realizedPL || 0;
      forexTradesByDay[d].trades.push({
        ticker: trade.instrument,
        pnl: trade.realizedPL || 0,
        direction: trade.direction || 'long',
      });
    }

    // Summary stats
    const totalPnl = days.reduce((s, d) => s + d.pnl, 0);
    const winDays = days.filter(d => d.pnl > 0).length;
    const lossDays = days.filter(d => d.pnl < 0).length;
    const bestDay = days.length > 0 ? Math.max(...days.map(d => d.pnl)) : 0;
    const worstDay = days.length > 0 ? Math.min(...days.map(d => d.pnl)) : 0;

    return NextResponse.json({
      days: days.sort((a, b) => b.date.localeCompare(a.date)), // newest first
      summary: {
        totalPnl: Math.round(totalPnl * 100) / 100,
        winDays,
        lossDays,
        bestDay: Math.round(bestDay * 100) / 100,
        worstDay: Math.round(worstDay * 100) / 100,
        currentEquity: account?.equity || 0,
        dayPnl: Math.round(dayPnl * 100) / 100,
      },
      equityTrades: equityTradesByDay,
      forexTrades: forexTradesByDay,
    });
  } catch {
    return NextResponse.json({
      days: [],
      summary: { totalPnl: 0, winDays: 0, lossDays: 0, bestDay: 0, worstDay: 0, currentEquity: 0, dayPnl: 0 },
      equityTrades: {},
      forexTrades: {},
    });
  }
}

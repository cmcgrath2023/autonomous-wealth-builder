'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody } from '@heroui/react';
import { formatCurrency } from '@/lib/utils/formatters';

interface DayPnl {
  date: string;
  equity: number;
  pnl: number;
  pnlPct: number;
}

interface TradeDetail {
  ticker: string;
  pnl: number;
  direction: string;
}

interface DayTrades {
  count: number;
  pnl: number;
  trades: TradeDetail[];
}

interface ProfitData {
  days: DayPnl[];
  summary: {
    totalPnl: number;
    winDays: number;
    lossDays: number;
    bestDay: number;
    worstDay: number;
    currentEquity: number;
    dayPnl: number;
  };
  equityTrades: Record<string, DayTrades>;
  forexTrades: Record<string, DayTrades>;
}

const DAILY_GOAL = 500;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function PnlBar({ pnl, maxAbs }: { pnl: number; maxAbs: number }) {
  const pct = maxAbs > 0 ? Math.abs(pnl) / maxAbs * 100 : 0;
  const isPos = pnl >= 0;
  return (
    <div className="flex items-center gap-2 w-32">
      {!isPos && (
        <div className="flex-1 flex justify-end">
          <div className="h-3 rounded-l bg-red-500/60" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="w-px h-4 bg-white/10" />
      {isPos && (
        <div className="flex-1">
          <div className="h-3 rounded-r bg-green-500/60" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default function ProfitPage() {
  const [data, setData] = useState<ProfitData | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/profit');
        const json = await res.json();
        setData(json);
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-white/40 text-sm">Loading profit data...</div>
      </div>
    );
  }

  if (!data || data.days.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-white/40 text-sm">No profit data available yet</div>
      </div>
    );
  }

  const { days, summary, equityTrades, forexTrades } = data;
  const maxAbs = Math.max(...days.map(d => Math.abs(d.pnl)), 1);
  const goalDays = days.filter(d => d.pnl >= DAILY_GOAL).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Daily Profit & Loss</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Period P&L</div>
            <div className={`text-xl font-mono font-bold ${summary.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {summary.totalPnl >= 0 ? '+' : ''}{formatCurrency(summary.totalPnl)}
            </div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Today</div>
            <div className={`text-xl font-mono font-bold ${summary.dayPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {summary.dayPnl >= 0 ? '+' : ''}{formatCurrency(summary.dayPnl)}
            </div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Win / Loss Days</div>
            <div className="text-xl font-mono font-bold text-white/90">
              <span className="text-green-400">{summary.winDays}</span>
              <span className="text-white/30"> / </span>
              <span className="text-red-400">{summary.lossDays}</span>
            </div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Best Day</div>
            <div className="text-xl font-mono font-bold text-green-400">+{formatCurrency(summary.bestDay)}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Goal Days (${DAILY_GOAL}+)</div>
            <div className="text-xl font-mono font-bold text-amber-400">
              {goalDays} <span className="text-sm text-white/30">/ {days.length}</span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Equity */}
      <Card className="bg-white/5 border border-white/5">
        <CardBody className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-white/40">Current Equity</span>
            <span className="text-lg font-mono font-bold text-white/90">{formatCurrency(summary.currentEquity)}</span>
          </div>
        </CardBody>
      </Card>

      {/* Daily Breakdown Table */}
      <Card className="bg-white/5 border border-white/5">
        <CardBody className="p-0">
          <div className="px-4 py-3 border-b border-white/5">
            <h2 className="text-sm font-semibold text-white/60">Day-by-Day Breakdown</h2>
            <p className="text-xs text-white/30 mt-0.5">Based on US market close (4:00 PM ET). Click a row for trade details.</p>
          </div>
          <div className="divide-y divide-white/5">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-white/30 font-medium">
              <div className="col-span-2">Date</div>
              <div className="col-span-2 text-right">Day P&L</div>
              <div className="col-span-2 text-right">P&L %</div>
              <div className="col-span-3">Bar</div>
              <div className="col-span-1 text-right">Equity</div>
              <div className="col-span-1 text-center">Trades</div>
              <div className="col-span-1 text-center">Goal</div>
            </div>
            {days.map((day) => {
              const eqTrades = equityTrades[day.date];
              const fxTrades = forexTrades[day.date];
              const totalTrades = (eqTrades?.count || 0) + (fxTrades?.count || 0);
              const goalMet = day.pnl >= DAILY_GOAL;
              const isToday = day.date === new Date().toISOString().split('T')[0];
              const isExpanded = expandedDay === day.date;

              return (
                <div key={day.date}>
                  <div
                    className={`grid grid-cols-12 gap-2 px-4 py-2.5 text-sm cursor-pointer hover:bg-white/3 transition-colors ${isToday ? 'bg-blue-500/5' : ''}`}
                    onClick={() => setExpandedDay(isExpanded ? null : day.date)}
                  >
                    <div className="col-span-2 font-mono text-white/70">
                      {formatDate(day.date)}
                      {isToday && <span className="ml-1 text-[10px] text-blue-400">LIVE</span>}
                    </div>
                    <div className={`col-span-2 text-right font-mono font-medium ${day.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {day.pnl >= 0 ? '+' : ''}{formatCurrency(day.pnl)}
                    </div>
                    <div className={`col-span-2 text-right font-mono text-xs ${day.pnlPct >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                      {day.pnlPct >= 0 ? '+' : ''}{(day.pnlPct * 100).toFixed(2)}%
                    </div>
                    <div className="col-span-3 flex items-center">
                      <PnlBar pnl={day.pnl} maxAbs={maxAbs} />
                    </div>
                    <div className="col-span-1 text-right font-mono text-xs text-white/40">
                      {formatCurrency(day.equity)}
                    </div>
                    <div className="col-span-1 text-center text-xs text-white/40">
                      {totalTrades > 0 ? totalTrades : '-'}
                    </div>
                    <div className="col-span-1 text-center">
                      {goalMet ? (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">MET</span>
                      ) : day.pnl > 0 ? (
                        <span className="text-[10px] font-mono text-white/25">{Math.round((day.pnl / DAILY_GOAL) * 100)}%</span>
                      ) : (
                        <span className="text-[10px] font-mono text-red-400/40">MISS</span>
                      )}
                    </div>
                  </div>

                  {/* Expanded trade details */}
                  {isExpanded && (totalTrades > 0 || fxTrades) && (
                    <div className="px-6 py-3 bg-white/[0.02] border-t border-white/5">
                      {eqTrades && eqTrades.trades.length > 0 && (
                        <div className="mb-2">
                          <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Equity Trades ({eqTrades.count})</div>
                          <div className="grid grid-cols-3 gap-1">
                            {eqTrades.trades.map((t, i) => (
                              <div key={i} className="flex justify-between text-xs px-2 py-1 rounded bg-white/[0.03]">
                                <span className="text-white/60">{t.ticker}</span>
                                <span className={`font-mono ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {t.pnl >= 0 ? '+' : ''}{formatCurrency(t.pnl)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {fxTrades && fxTrades.trades.length > 0 && (
                        <div>
                          <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Forex Trades ({fxTrades.count})</div>
                          <div className="grid grid-cols-3 gap-1">
                            {fxTrades.trades.map((t, i) => (
                              <div key={i} className="flex justify-between text-xs px-2 py-1 rounded bg-white/[0.03]">
                                <span className="text-white/60">{t.ticker}</span>
                                <span className={`font-mono ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {t.pnl >= 0 ? '+' : ''}{formatCurrency(t.pnl)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {totalTrades === 0 && (
                        <div className="text-xs text-white/25">No closed trades recorded for this day</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

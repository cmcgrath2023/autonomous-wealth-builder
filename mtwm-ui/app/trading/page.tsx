'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Spinner } from '@heroui/react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatCurrency, formatPercent, formatRelativeTime } from '@/lib/utils/formatters';

interface Signal {
  id: string;
  ticker: string;
  direction: string;
  confidence: number;
  pattern: string;
  timestamp: string;
  indicators?: Record<string, any>;
}

interface ClosedTrade {
  ticker: string;
  direction: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  returnPct: number;
  entryTime: string;
  exitTime: string;
}

interface Position {
  ticker: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

interface PerfStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  totalPnl: number;
  profitFactor: number;
}

const GW = '/api/gateway';

export default function TradingPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [closed, setClosed] = useState<ClosedTrade[]>([]);
  const [perf, setPerf] = useState<PerfStats | null>(null);
  const [account, setAccount] = useState<any>(null);
  const [autonomy, setAutonomy] = useState<any>(null);
  const [equityCurve, setEquityCurve] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [sigRes, posRes, closedRes, perfRes, accRes, autoRes] = await Promise.all([
        fetch('/api/portfolio').then(r => r.json()),
        fetch(`${GW}/broker/positions`).then(r => r.json()).catch(() => ({ positions: [] })),
        fetch(`${GW}/positions/closed?limit=50`).then(r => r.json()).catch(() => ({ trades: [] })),
        fetch(`${GW}/positions/performance`).then(r => r.json()).catch(() => null),
        fetch(`${GW}/broker/account`).then(r => r.json()).catch(() => null),
        fetch(`${GW}/autonomy/status`).then(r => r.json()).catch(() => null),
      ]);
      setPositions(posRes.positions || []);
      setClosed(closedRes.trades || []);
      setPerf(perfRes);
      setAccount(accRes);
      setAutonomy(autoRes);

      // Build equity curve from closed trades
      const trades = closedRes.trades || [];
      if (trades.length > 0) {
        let equity = 100000;
        const curve = [{ time: 'Start', equity: 100000 }];
        for (const t of trades) {
          equity += t.pnl || 0;
          curve.push({
            time: new Date(t.exitTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            equity: Math.round(equity),
          });
        }
        setEquityCurve(curve);
      }

      // Fetch active signals from gateway
      try {
        const sigGw = await fetch(`${GW}/status`).then(r => r.json());
        if (sigGw.trading?.activeSignals) {
          setSignals(sigGw.trading.activeSignals);
        }
      } catch {}
    } catch (err) {
      console.error('Trading fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;

  const totalPnl = account ? (account.portfolioValue || 0) - 100000 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trading Operations</h1>
          <p className="text-sm text-white/40 mt-1">
            {autonomy?.enabled ? `Autonomy: ${autonomy.autonomyLevel?.toUpperCase()} mode` : 'Autonomy OFF'} &middot; {autonomy?.heartbeatCount || 0} heartbeats &middot; {autonomy?.registeredActions?.length || 0} actions
          </p>
        </div>
        <div className="flex gap-2">
          <Chip color={account?.connected ? 'success' : 'danger'} variant="flat">
            {account?.connected ? 'Alpaca Connected' : 'Disconnected'}
          </Chip>
          <Chip variant="flat" color="primary">Paper Trading</Chip>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Portfolio Value</div>
            <div className="text-xl font-bold font-mono">{formatCurrency(account?.portfolioValue || 0)}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Total P&L</div>
            <div className={`text-xl font-bold font-mono ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
            </div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Open Positions</div>
            <div className="text-xl font-bold">{positions.length}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Closed Trades</div>
            <div className="text-xl font-bold">{perf?.totalTrades || 0}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Win Rate</div>
            <div className={`text-xl font-bold ${(perf?.winRate || 0) >= 55 ? 'text-green-400' : (perf?.totalTrades || 0) > 0 ? 'text-red-400' : ''}`}>
              {perf && perf.totalTrades > 0 ? `${perf.winRate.toFixed(1)}%` : '—'}
            </div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Buying Power</div>
            <div className="text-xl font-bold font-mono">{formatCurrency(account?.buyingPower || 0)}</div>
          </CardBody>
        </Card>
      </div>

      {/* Equity Curve */}
      {equityCurve.length > 1 && (
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold text-white/80">Equity Curve</h3>
          </CardHeader>
          <CardBody className="p-4">
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve}>
                  <XAxis dataKey="time" stroke="#ffffff20" tick={{ fill: '#ffffff40', fontSize: 11 }} />
                  <YAxis stroke="#ffffff20" tick={{ fill: '#ffffff40', fontSize: 11 }} domain={['auto', 'auto']} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                  <ReferenceLine y={100000} stroke="#ffffff15" strokeDasharray="3 3" label={{ value: '$100K Start', fill: '#ffffff30', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #ffffff15', borderRadius: 8 }}
                    labelStyle={{ color: '#ffffff60' }}
                    formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Equity']}
                  />
                  <Line type="monotone" dataKey="equity" stroke={totalPnl >= 0 ? '#4ade80' : '#f87171'} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Open Positions */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <h3 className="font-semibold text-white/80">Open Positions ({positions.length})</h3>
        </CardHeader>
        <CardBody className="p-4">
          {positions.length === 0 ? (
            <div className="text-sm text-white/30 py-4 text-center">No open positions — system scanning for opportunities</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs border-b border-white/5">
                    <th className="text-left py-2 px-2">Ticker</th>
                    <th className="text-right py-2 px-2">Shares</th>
                    <th className="text-right py-2 px-2">Avg Cost</th>
                    <th className="text-right py-2 px-2">Price</th>
                    <th className="text-right py-2 px-2">Value</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-right py-2 px-2">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.ticker} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2 font-medium text-white/90">{p.ticker}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{p.shares}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{formatCurrency(p.avgPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{formatCurrency(p.currentPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/90">{formatCurrency(p.marketValue)}</td>
                      <td className={`py-2 px-2 text-right font-mono font-medium ${p.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {p.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(p.unrealizedPnl)}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono ${p.unrealizedPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatPercent(p.unrealizedPnlPercent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Active Signals */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <h3 className="font-semibold text-white/80">Active Signals ({signals.length})</h3>
        </CardHeader>
        <CardBody className="p-4">
          {signals.length === 0 ? (
            <div className="text-sm text-white/30 py-4 text-center">No active signals — Neural Trader scanning every 5 minutes</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs border-b border-white/5">
                    <th className="text-left py-2 px-2">Ticker</th>
                    <th className="text-left py-2 px-2">Direction</th>
                    <th className="text-right py-2 px-2">Confidence</th>
                    <th className="text-left py-2 px-2">Pattern</th>
                    <th className="text-right py-2 px-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s) => (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2 font-medium text-white/90">{s.ticker}</td>
                      <td className="py-2 px-2">
                        <Chip size="sm" variant="flat" color={s.direction === 'buy' ? 'success' : s.direction === 'short' ? 'danger' : 'warning'}>
                          {s.direction.toUpperCase()}
                        </Chip>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-white/80">{(s.confidence * 100).toFixed(0)}%</td>
                      <td className="py-2 px-2 text-white/60 text-xs">{s.pattern}</td>
                      <td className="py-2 px-2 text-right text-white/40 text-xs">{formatRelativeTime(s.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Closed Trades */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="flex justify-between items-center px-4 pt-4 pb-0">
          <h3 className="font-semibold text-white/80">Closed Trades ({closed.length})</h3>
          {perf && perf.totalTrades > 0 && (
            <div className="flex gap-3 text-xs text-white/50">
              <span>Avg Win: <span className="text-green-400">{formatCurrency(perf.avgWin)}</span></span>
              <span>Avg Loss: <span className="text-red-400">{formatCurrency(perf.avgLoss)}</span></span>
              <span>Total: <span className={perf.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}>{formatCurrency(perf.totalPnl)}</span></span>
            </div>
          )}
        </CardHeader>
        <CardBody className="p-4">
          {closed.length === 0 ? (
            <div className="text-sm text-white/30 py-4 text-center">No closed trades yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs border-b border-white/5">
                    <th className="text-left py-2 px-2">Ticker</th>
                    <th className="text-left py-2 px-2">Side</th>
                    <th className="text-right py-2 px-2">Entry</th>
                    <th className="text-right py-2 px-2">Exit</th>
                    <th className="text-right py-2 px-2">Shares</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-right py-2 px-2">Return</th>
                    <th className="text-right py-2 px-2">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((t, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2 font-medium text-white/90">{t.ticker}</td>
                      <td className="py-2 px-2">
                        <Chip size="sm" variant="flat" color={t.direction === 'buy' ? 'success' : 'danger'}>
                          {(t.direction || 'long').toUpperCase()}
                        </Chip>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{formatCurrency(t.entryPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{formatCurrency(t.exitPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{t.shares}</td>
                      <td className={`py-2 px-2 text-right font-mono font-medium ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {t.pnl >= 0 ? '+' : ''}{formatCurrency(t.pnl)}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono ${t.returnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatPercent(t.returnPct)}
                      </td>
                      <td className="py-2 px-2 text-right text-white/40 text-xs">{t.exitTime ? formatRelativeTime(t.exitTime) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Divider, Progress } from '@heroui/react';

interface Position {
  ticker: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

interface Strategy {
  id: string;
  name: string;
  risk: string;
  direction: string;
  description: string;
}

const GATEWAY = '/api/gateway';

export default function OptionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [posRes, stratRes] = await Promise.all([
        fetch(`${GATEWAY}/broker/positions`).then(r => r.json()).catch(() => ({ positions: [] })),
        fetch(`${GATEWAY}/expansion/options/strategies`).then(r => r.json()).catch(() => ({ strategies: [] })),
      ]);
      setPositions(posRes.positions || []);
      setStrategies(stratRes.strategies || []);
      setLastUpdate(new Date());
    } catch {
      /* keep stale */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Separate winners and losers for strategy recommendations
  const winners = positions.filter(p => p.unrealizedPnlPercent > 2);
  const losers = positions.filter(p => p.unrealizedPnlPercent < -2);
  const neutral = positions.filter(p => Math.abs(p.unrealizedPnlPercent) <= 2);

  const formatCurrency = (val: number) => `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatPercent = (val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-white/40">Loading options data...</div>
        <Progress isIndeterminate size="sm" aria-label="Loading" />
      </div>
    );
  }

  const strategyIcons: Record<string, string> = {
    covered_call: 'CC',
    cash_secured_put: 'CSP',
    protective_put: 'PP',
    collar: 'COL',
  };

  const strategyColors: Record<string, string> = {
    covered_call: 'bg-green-500/10 border-green-500/20',
    cash_secured_put: 'bg-blue-500/10 border-blue-500/20',
    protective_put: 'bg-red-500/10 border-red-500/20',
    collar: 'bg-purple-500/10 border-purple-500/20',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Options Trading</h1>
          <p className="text-sm text-white/40 mt-1">
            Defined-Risk Strategies — Covered Calls, CSPs, Protective Puts, Collars
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Chip color="primary" variant="flat" size="sm">Alpaca Paper</Chip>
          {lastUpdate && (
            <span className="text-xs text-white/40">{lastUpdate.toLocaleTimeString()}</span>
          )}
          <Button size="sm" variant="flat" onPress={fetchData}>Refresh</Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Open Positions</div>
            <div className="text-2xl font-bold">{positions.length}</div>
          </CardBody>
        </Card>
        <Card className="bg-green-500/5 border border-green-500/20">
          <CardBody className="p-4">
            <div className="text-xs text-green-400/60">CC Candidates (Winners)</div>
            <div className="text-2xl font-bold text-green-400">{winners.length}</div>
            <div className="text-xs text-white/30 mt-1">P&L &gt; +2%</div>
          </CardBody>
        </Card>
        <Card className="bg-blue-500/5 border border-blue-500/20">
          <CardBody className="p-4">
            <div className="text-xs text-blue-400/60">CSP Candidates (Dips)</div>
            <div className="text-2xl font-bold text-blue-400">{losers.length}</div>
            <div className="text-xs text-white/30 mt-1">P&L &lt; -2%</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Strategies Active</div>
            <div className="text-2xl font-bold">{strategies.length}</div>
          </CardBody>
        </Card>
      </div>

      {/* Strategy Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {strategies.map(strat => (
          <Card key={strat.id} className={`border ${strategyColors[strat.id] || 'bg-white/5 border-white/5'}`}>
            <CardBody className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold">
                  {strategyIcons[strat.id] || '?'}
                </div>
                <div>
                  <div className="text-sm font-medium text-white/90">{strat.name}</div>
                  <div className="text-xs text-white/40">{strat.direction}</div>
                </div>
              </div>
              <p className="text-xs text-white/50">{strat.description}</p>
              <Chip size="sm" variant="flat" color="success" className="mt-2">
                {strat.risk} risk
              </Chip>
            </CardBody>
          </Card>
        ))}
      </div>

      <Divider className="bg-white/5" />

      {/* Covered Call Candidates */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white/80">Covered Call Candidates</h3>
            <Chip size="sm" variant="flat" color="success">Sell calls on winners</Chip>
          </div>
        </CardHeader>
        <CardBody className="p-4">
          {winners.length === 0 ? (
            <div className="text-sm text-white/30 py-4 text-center">
              No positions with &gt;2% gain — covered calls trigger on winning positions with IV Rank &gt;40%
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs border-b border-white/5">
                    <th className="text-left py-2 px-2">Ticker</th>
                    <th className="text-right py-2 px-2">Shares</th>
                    <th className="text-right py-2 px-2">Price</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-right py-2 px-2">Return</th>
                    <th className="text-left py-2 px-2">Call Strike (5% OTM)</th>
                    <th className="text-left py-2 px-2">Strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {winners.map(p => (
                    <tr key={p.ticker} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2 font-medium text-white/90">{p.ticker}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{p.shares}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{formatCurrency(p.currentPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono text-green-400">{formatCurrency(p.unrealizedPnl)}</td>
                      <td className="py-2 px-2 text-right font-mono text-green-400">{formatPercent(p.unrealizedPnlPercent)}</td>
                      <td className="py-2 px-2 font-mono text-white/50">${(p.currentPrice * 1.05).toFixed(2)}</td>
                      <td className="py-2 px-2">
                        <Chip size="sm" variant="flat" color="success">Sell Call</Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* CSP Candidates */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white/80">Cash-Secured Put Candidates</h3>
            <Chip size="sm" variant="flat" color="primary">Get paid to buy dips</Chip>
          </div>
        </CardHeader>
        <CardBody className="p-4">
          {losers.length === 0 ? (
            <div className="text-sm text-white/30 py-4 text-center">
              No positions with &gt;2% loss — CSPs trigger on dips with IV Rank &gt;50%
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs border-b border-white/5">
                    <th className="text-left py-2 px-2">Ticker</th>
                    <th className="text-right py-2 px-2">Price</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-right py-2 px-2">Return</th>
                    <th className="text-left py-2 px-2">Put Strike (5% OTM)</th>
                    <th className="text-left py-2 px-2">Strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {losers.map(p => (
                    <tr key={p.ticker} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2 font-medium text-white/90">{p.ticker}</td>
                      <td className="py-2 px-2 text-right font-mono text-white/70">{formatCurrency(p.currentPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono text-red-400">{formatCurrency(p.unrealizedPnl)}</td>
                      <td className="py-2 px-2 text-right font-mono text-red-400">{formatPercent(p.unrealizedPnlPercent)}</td>
                      <td className="py-2 px-2 font-mono text-white/50">${(p.currentPrice * 0.95).toFixed(2)}</td>
                      <td className="py-2 px-2">
                        <Chip size="sm" variant="flat" color="primary">Sell Put</Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Rules */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <h3 className="font-semibold text-white/80">Options Rules</h3>
        </CardHeader>
        <CardBody className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-white/60">
            <div>
              <div className="text-xs text-white/40 mb-1">Max DTE</div>
              <div className="font-medium text-white/80">45 days</div>
            </div>
            <div>
              <div className="text-xs text-white/40 mb-1">Risk Type</div>
              <div className="font-medium text-white/80">Defined only (no naked)</div>
            </div>
            <div>
              <div className="text-xs text-white/40 mb-1">CC IV Rank Threshold</div>
              <div className="font-medium text-white/80">&gt; 40%</div>
            </div>
            <div>
              <div className="text-xs text-white/40 mb-1">CSP IV Rank Threshold</div>
              <div className="font-medium text-white/80">&gt; 50%</div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

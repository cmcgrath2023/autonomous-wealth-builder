'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Divider, Progress } from '@heroui/react';

interface ForexQuote {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  change: number;
  changePercent: number;
  timestamp: string;
}

interface SessionStatus {
  session: string;
  sessions: Record<string, boolean>;
}

interface ForexTrade {
  id: string;
  instrument: string;
  currentUnits: string;
  price: string;
  unrealizedPL: string;
  openTime: string;
  stopLossOrder?: { price: string };
  takeProfitOrder?: { price: string };
}

const GATEWAY = '/api/gateway';

const SESSION_LABELS: Record<string, { label: string; hours: string }> = {
  asian: { label: 'Asian', hours: '00:00–08:00 UTC' },
  london: { label: 'London', hours: '08:00–16:00 UTC' },
  newyork: { label: 'New York', hours: '13:30–21:00 UTC' },
  overlap: { label: 'London/NY Overlap', hours: '13:30–16:00 UTC' },
};

const CATEGORY_COLORS: Record<string, string> = {
  major: 'primary',
  carry: 'warning',
  cross: 'secondary',
};

export default function ForexPage() {
  const [quotes, setQuotes] = useState<ForexQuote[]>([]);
  const [trades, setTrades] = useState<ForexTrade[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const pairs = [
    { symbol: 'EUR/USD', category: 'major' },
    { symbol: 'GBP/USD', category: 'major' },
    { symbol: 'USD/JPY', category: 'major' },
    { symbol: 'AUD/JPY', category: 'carry' },
    { symbol: 'NZD/JPY', category: 'carry' },
    { symbol: 'EUR/GBP', category: 'cross' },
    { symbol: 'AUD/NZD', category: 'cross' },
  ];

  const fetchData = useCallback(async () => {
    try {
      const [quotesRes, sessionRes, tradesRes] = await Promise.all([
        fetch(`${GATEWAY}/expansion/forex/quotes`).then(r => r.json()).catch(() => ({ quotes: [], connected: false })),
        fetch(`${GATEWAY}/expansion/forex/session`).then(r => r.json()).catch(() => null),
        fetch(`${GATEWAY}/expansion/forex/trades`).then(r => r.json()).catch(() => ({ trades: [] })),
      ]);
      setQuotes(quotesRes.quotes || []);
      setConnected(quotesRes.connected || false);
      setSessionStatus(sessionRes);
      setTrades(tradesRes.trades || []);
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

  const quoteMap = new Map(quotes.map(q => [q.symbol, q]));

  const formatPips = (val: number, symbol: string) => {
    const isJpy = symbol.includes('JPY');
    const pips = isJpy ? val * 100 : val * 10000;
    return pips >= 0 ? `+${pips.toFixed(1)}` : pips.toFixed(1);
  };

  const formatPrice = (val: number, symbol: string) => {
    const isJpy = symbol.includes('JPY');
    return val.toFixed(isJpy ? 3 : 5);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-white/40">Loading forex data...</div>
        <Progress isIndeterminate size="sm" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Forex Trading</h1>
          <p className="text-sm text-white/40 mt-1">
            OANDA Integration — Session Momentum + Carry Trade Strategies
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Chip color={connected ? 'success' : 'warning'} variant="flat" size="sm">
            {connected ? 'OANDA Connected' : 'Awaiting Data'}
          </Chip>
          {lastUpdate && (
            <span className="text-xs text-white/40">
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <Button size="sm" variant="flat" onPress={fetchData}>Refresh</Button>
        </div>
      </div>

      {/* Session Status */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <h3 className="font-semibold text-white/80">Trading Sessions</h3>
        </CardHeader>
        <CardBody className="p-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(SESSION_LABELS).map(([key, { label, hours }]) => {
              const isOpen = sessionStatus?.sessions?.[key] || false;
              const isActive = sessionStatus?.session === key;
              return (
                <div
                  key={key}
                  className={`p-3 rounded-lg border ${
                    isActive ? 'border-blue-500/50 bg-blue-500/10' :
                    isOpen ? 'border-green-500/30 bg-green-500/5' :
                    'border-white/5 bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-medium ${isActive ? 'text-blue-400' : isOpen ? 'text-green-400' : 'text-white/50'}`}>
                      {label}
                    </span>
                    <div className={`w-2 h-2 rounded-full ${isOpen ? 'bg-green-400 animate-pulse' : 'bg-white/20'}`} />
                  </div>
                  <div className="text-xs text-white/30">{hours}</div>
                  {isActive && <div className="text-xs text-blue-400 mt-1">Active Session</div>}
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Open Trades & P&L */}
      {trades.length > 0 && (() => {
        const totalPL = trades.reduce((sum, t) => sum + parseFloat(t.unrealizedPL || '0'), 0);
        const totalUnits = trades.reduce((sum, t) => sum + Math.abs(parseFloat(t.currentUnits || '0')), 0);
        return (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="bg-white/5 border border-white/5">
                <CardBody className="p-4">
                  <div className="text-xs text-white/40">Open Trades</div>
                  <div className="text-2xl font-bold">{trades.length}</div>
                </CardBody>
              </Card>
              <Card className={`border ${totalPL >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                <CardBody className="p-4">
                  <div className="text-xs text-white/40">Unrealized P&L</div>
                  <div className={`text-2xl font-bold font-mono ${totalPL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
                  </div>
                </CardBody>
              </Card>
              <Card className="bg-white/5 border border-white/5">
                <CardBody className="p-4">
                  <div className="text-xs text-white/40">Total Exposure</div>
                  <div className="text-2xl font-bold font-mono">{totalUnits.toLocaleString()}</div>
                  <div className="text-xs text-white/30 mt-1">units</div>
                </CardBody>
              </Card>
              <Card className="bg-white/5 border border-white/5">
                <CardBody className="p-4">
                  <div className="text-xs text-white/40">Target P&L</div>
                  <div className="text-2xl font-bold font-mono text-blue-400">$160.00</div>
                  <div className="text-xs text-white/30 mt-1">overnight goal</div>
                </CardBody>
              </Card>
            </div>

            <Card className="bg-white/5 border border-white/5">
              <CardHeader className="px-4 pt-4 pb-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white/80">Open Positions</h3>
                  <Chip size="sm" variant="flat" color={totalPL >= 0 ? 'success' : 'danger'}>
                    {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
                  </Chip>
                </div>
              </CardHeader>
              <CardBody className="p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-white/40 text-xs border-b border-white/5">
                        <th className="text-left py-2 px-2">Pair</th>
                        <th className="text-left py-2 px-2">Side</th>
                        <th className="text-right py-2 px-2">Units</th>
                        <th className="text-right py-2 px-2">Entry</th>
                        <th className="text-right py-2 px-2">Stop Loss</th>
                        <th className="text-right py-2 px-2">Take Profit</th>
                        <th className="text-right py-2 px-2">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map(t => {
                        const units = parseFloat(t.currentUnits);
                        const pl = parseFloat(t.unrealizedPL || '0');
                        const isLong = units > 0;
                        return (
                          <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="py-3 px-2 font-medium text-white/90">{t.instrument.replace('_', '/')}</td>
                            <td className="py-3 px-2">
                              <Chip size="sm" variant="flat" color={isLong ? 'success' : 'danger'}>
                                {isLong ? 'LONG' : 'SHORT'}
                              </Chip>
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-white/70">{Math.abs(units).toLocaleString()}</td>
                            <td className="py-3 px-2 text-right font-mono text-white/70">{t.price}</td>
                            <td className="py-3 px-2 text-right font-mono text-red-400/70">{t.stopLossOrder?.price || '—'}</td>
                            <td className="py-3 px-2 text-right font-mono text-green-400/70">{t.takeProfitOrder?.price || '—'}</td>
                            <td className={`py-3 px-2 text-right font-mono font-medium ${pl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {pl >= 0 ? '+' : ''}${pl.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          </>
        );
      })()}

      {trades.length === 0 && (
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4 text-center text-white/40 text-sm">
            No open forex trades — scanner evaluating session momentum and carry opportunities
          </CardBody>
        </Card>
      )}

      {/* Currency Pairs */}
      <div className="grid grid-cols-1 gap-4">
        {['major', 'carry', 'cross'].map(category => {
          const categoryPairs = pairs.filter(p => p.category === category);
          return (
            <Card key={category} className="bg-white/5 border border-white/5">
              <CardHeader className="px-4 pt-4 pb-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white/80 capitalize">{category} Pairs</h3>
                  <Chip size="sm" variant="flat" color={CATEGORY_COLORS[category] as any}>
                    {category === 'major' ? 'High Liquidity' : category === 'carry' ? 'Interest Differential' : 'Cross Rates'}
                  </Chip>
                </div>
              </CardHeader>
              <CardBody className="p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-white/40 text-xs border-b border-white/5">
                        <th className="text-left py-2 px-2">Pair</th>
                        <th className="text-right py-2 px-2">Bid</th>
                        <th className="text-right py-2 px-2">Ask</th>
                        <th className="text-right py-2 px-2">Mid</th>
                        <th className="text-right py-2 px-2">Spread</th>
                        <th className="text-right py-2 px-2">Change (pips)</th>
                        <th className="text-right py-2 px-2">Change %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryPairs.map(pair => {
                        const q = quoteMap.get(pair.symbol);
                        const hasData = !!q;
                        const isPositive = (q?.change || 0) >= 0;
                        return (
                          <tr key={pair.symbol} className="border-b border-white/5 hover:bg-white/5">
                            <td className="py-3 px-2 font-medium text-white/90">{pair.symbol}</td>
                            <td className="py-3 px-2 text-right font-mono text-white/70">
                              {hasData ? formatPrice(q!.bid, pair.symbol) : '—'}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-white/70">
                              {hasData ? formatPrice(q!.ask, pair.symbol) : '—'}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-white/90 font-medium">
                              {hasData ? formatPrice(q!.mid, pair.symbol) : '—'}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-white/50">
                              {hasData ? formatPips(q!.ask - q!.bid, pair.symbol) : '—'}
                            </td>
                            <td className={`py-3 px-2 text-right font-mono ${hasData ? (isPositive ? 'text-green-400' : 'text-red-400') : 'text-white/30'}`}>
                              {hasData ? formatPips(q!.change, pair.symbol) : '—'}
                            </td>
                            <td className={`py-3 px-2 text-right font-mono ${hasData ? (isPositive ? 'text-green-400' : 'text-red-400') : 'text-white/30'}`}>
                              {hasData ? `${q!.changePercent >= 0 ? '+' : ''}${q!.changePercent.toFixed(3)}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Divider className="bg-white/5" />

      {/* Strategy Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold text-white/80">Session Momentum Strategy</h3>
          </CardHeader>
          <CardBody className="p-4 text-sm text-white/60 space-y-2">
            <p>Scans for breakouts from prior session range during London and NY open.</p>
            <p>Price position &gt;80% of range = long, &lt;20% = short. Higher conviction during London/NY overlap.</p>
            <p className="text-white/40">Stop: 25 pips | Target: 50 pips | 2:1 reward/risk</p>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold text-white/80">Carry Trade Strategy</h3>
          </CardHeader>
          <CardBody className="p-4 text-sm text-white/60 space-y-2">
            <p>Long AUD/JPY and NZD/JPY when price trends above 20-period SMA.</p>
            <p>Captures interest rate differential (swap income) plus trend momentum.</p>
            <p className="text-white/40">Stop: 50 pips | Target: 100 pips | 2:1 reward/risk</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

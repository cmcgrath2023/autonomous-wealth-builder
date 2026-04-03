'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Spinner, Divider } from '@heroui/react';
import { formatCurrency, formatPercent } from '@/lib/utils/formatters';

interface CryptoPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  current_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  change_today: string;
  side: string;
}

interface CryptoQuote {
  symbol: string;
  price: number;
  change24h: number;
}

const WATCHED_PAIRS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'LTC/USD', 'BCH/USD', 'AVAX/USD', 'DOGE/USD', 'DOT/USD'];

export default function CryptoPage() {
  const [positions, setPositions] = useState<CryptoPosition[]>([]);
  const [quotes, setQuotes] = useState<CryptoQuote[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // Positions from gateway
      const posRes = await fetch('/api/gateway/broker/positions');
      if (posRes.ok) {
        const data = await posRes.json();
        const cryptoPos = (data.positions || []).filter((p: any) => p.asset_class === 'crypto');
        setPositions(cryptoPos);
      }

      // Crypto snapshots for watchlist
      try {
        const symbols = WATCHED_PAIRS.join(',');
        const snapRes = await fetch(`/api/gateway/broker/crypto-quotes?symbols=${symbols}`);
        if (snapRes.ok) {
          const data = await snapRes.json();
          setQuotes(data.quotes || []);
        }
      } catch {}
    } catch (e) {
      console.error('Crypto refresh failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (loading) return <div className="flex justify-center items-center h-64"><Spinner size="lg" /></div>;

  const totalValue = positions.reduce((s, p) => s + parseFloat(p.market_value || '0'), 0);
  const totalPnl = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl || '0'), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Crypto</h1>
        <p className="text-white/50 text-sm mt-1">24/7 cryptocurrency positions via Alpaca</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">Positions</div>
            <div className="text-2xl font-bold text-white">{positions.length}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">Market Value</div>
            <div className="text-2xl font-bold text-white">{formatCurrency(totalValue)}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">Unrealized P&L</div>
            <div className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(totalPnl)}
            </div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">Strategy</div>
            <div className="text-sm font-medium text-white">Overnight hold, liquidate pre-market</div>
          </CardBody>
        </Card>
      </div>

      {/* Open Positions */}
      <Card className="bg-white/5 border border-white/10">
        <CardHeader className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-white/80">Open Positions</h3>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          {positions.length === 0 ? (
            <div className="text-white/40 text-sm py-8 text-center">No crypto positions — liquidated pre-market or market closed</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 text-xs border-b border-white/5">
                    <th className="text-left py-2 pr-4">Asset</th>
                    <th className="text-right py-2 pr-4">Qty</th>
                    <th className="text-right py-2 pr-4">Entry</th>
                    <th className="text-right py-2 pr-4">Price</th>
                    <th className="text-right py-2 pr-4">Value</th>
                    <th className="text-right py-2 pr-4">P&L</th>
                    <th className="text-right py-2">24h</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map(p => {
                    const pnl = parseFloat(p.unrealized_pl || '0');
                    const pnlPct = parseFloat(p.unrealized_plpc || '0') * 100;
                    const change24 = parseFloat(p.change_today || '0') * 100;
                    return (
                      <tr key={p.symbol} className="border-b border-white/5">
                        <td className="py-3 pr-4">
                          <div className="font-medium text-white">{p.symbol.replace('USD', '')}</div>
                          <div className="text-xs text-white/40">{p.symbol}</div>
                        </td>
                        <td className="text-right py-3 pr-4 text-white/80">{parseFloat(p.qty).toFixed(4)}</td>
                        <td className="text-right py-3 pr-4 text-white/60">{formatCurrency(parseFloat(p.avg_entry_price))}</td>
                        <td className="text-right py-3 pr-4 text-white/80">{formatCurrency(parseFloat(p.current_price))}</td>
                        <td className="text-right py-3 pr-4 text-white">{formatCurrency(parseFloat(p.market_value))}</td>
                        <td className={`text-right py-3 pr-4 ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatCurrency(pnl)} ({pnlPct.toFixed(2)}%)
                        </td>
                        <td className={`text-right py-3 ${change24 >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {change24 >= 0 ? '+' : ''}{change24.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Watchlist */}
      <Card className="bg-white/5 border border-white/10">
        <CardHeader className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-white/80">Watchlist</h3>
          <span className="text-xs text-white/30 ml-2">Refreshes every 30s</span>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
            {WATCHED_PAIRS.map(pair => {
              const held = positions.find(p => p.symbol === pair.replace('/', ''));
              return (
                <div key={pair} className={`p-3 rounded-lg border ${held ? 'border-blue-500/30 bg-blue-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-white">{pair.replace('/USD', '')}</span>
                    {held && <Chip size="sm" color="primary" variant="flat">Held</Chip>}
                  </div>
                  <div className="text-xs text-white/40">{pair}</div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

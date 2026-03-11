'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Divider, Progress } from '@heroui/react';

interface MetalQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: string;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
}

interface MetalAsset {
  symbol: string;
  name: string;
  type: string;
  category: string;
  proxy?: string;
}

const GATEWAY = '/api/gateway';

export default function MetalsPage() {
  const [quotes, setQuotes] = useState<MetalQuote[]>([]);
  const [assets, setAssets] = useState<MetalAsset[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [quotesRes, assetsRes] = await Promise.all([
        fetch(`${GATEWAY}/expansion/metals/quotes`).then(r => r.json()).catch(() => ({ quotes: [], connected: false })),
        fetch(`${GATEWAY}/expansion/metals/assets`).then(r => r.json()).catch(() => ({ assets: [] })),
      ]);
      setQuotes(quotesRes.quotes || []);
      setConnected(quotesRes.connected || false);
      setAssets(assetsRes.assets || []);
      setLastUpdate(new Date());
    } catch {
      /* keep stale */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const quoteMap = new Map(quotes.map(q => [q.symbol, q]));

  const getRsiColor = (rsi: number | null) => {
    if (rsi == null) return 'text-white/30';
    if (rsi > 70) return 'text-red-400';
    if (rsi < 30) return 'text-green-400';
    return 'text-white/70';
  };

  const getRsiLabel = (rsi: number | null) => {
    if (rsi == null) return '';
    if (rsi > 70) return 'Overbought';
    if (rsi < 30) return 'Oversold';
    return 'Neutral';
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-white/40">Loading metals data...</div>
        <Progress isIndeterminate size="sm" aria-label="Loading" />
      </div>
    );
  }

  const goldQuote = quoteMap.get('GC') || quoteMap.get('GLD');
  const silverQuote = quoteMap.get('SI') || quoteMap.get('SLV');
  const goldSilverRatio = goldQuote && silverQuote && silverQuote.price > 0
    ? (goldQuote.price / silverQuote.price).toFixed(1)
    : '—';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Precious Metals</h1>
          <p className="text-sm text-white/40 mt-1">
            Gold & Silver — Momentum Crossovers, Volatility Plays, VIX Hedging
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Chip color={connected ? 'success' : 'warning'} variant="flat" size="sm">
            {connected ? 'Market Data Live' : 'Awaiting Data'}
          </Chip>
          {lastUpdate && (
            <span className="text-xs text-white/40">{lastUpdate.toLocaleTimeString()}</span>
          )}
          <Button size="sm" variant="flat" onPress={fetchData}>Refresh</Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-yellow-500/5 border border-yellow-500/20">
          <CardBody className="p-4">
            <div className="text-xs text-yellow-400/60">Gold (GLD)</div>
            <div className="text-2xl font-bold font-mono text-yellow-400">
              ${goldQuote?.price?.toFixed(2) || '—'}
            </div>
            {goldQuote?.rsi != null && (
              <div className={`text-xs mt-1 ${getRsiColor(goldQuote.rsi)}`}>
                RSI: {goldQuote.rsi.toFixed(1)} — {getRsiLabel(goldQuote.rsi)}
              </div>
            )}
          </CardBody>
        </Card>
        <Card className="bg-gray-400/5 border border-gray-400/20">
          <CardBody className="p-4">
            <div className="text-xs text-gray-300/60">Silver (SLV)</div>
            <div className="text-2xl font-bold font-mono text-gray-300">
              ${silverQuote?.price?.toFixed(2) || '—'}
            </div>
            {silverQuote?.rsi != null && (
              <div className={`text-xs mt-1 ${getRsiColor(silverQuote.rsi)}`}>
                RSI: {silverQuote.rsi.toFixed(1)} — {getRsiLabel(silverQuote.rsi)}
              </div>
            )}
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Gold/Silver Ratio</div>
            <div className="text-2xl font-bold font-mono">{goldSilverRatio}</div>
            <div className="text-xs text-white/30 mt-1">Historical avg: ~60-80</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Tracked Assets</div>
            <div className="text-2xl font-bold">{assets.length}</div>
            <div className="text-xs text-white/30 mt-1">Futures + ETFs</div>
          </CardBody>
        </Card>
      </div>

      {/* Detailed Quotes Table */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <h3 className="font-semibold text-white/80">Metal Instruments</h3>
        </CardHeader>
        <CardBody className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs border-b border-white/5">
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-left py-2 px-2">Name</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-right py-2 px-2">Price</th>
                  <th className="text-right py-2 px-2">EMA 20</th>
                  <th className="text-right py-2 px-2">EMA 50</th>
                  <th className="text-right py-2 px-2">RSI</th>
                  <th className="text-right py-2 px-2">BB Lower</th>
                  <th className="text-right py-2 px-2">BB Upper</th>
                </tr>
              </thead>
              <tbody>
                {assets.map(asset => {
                  const q = quoteMap.get(asset.symbol);
                  const emaSignal = q?.ema20 != null && q?.ema50 != null
                    ? (q.ema20 > q.ema50 ? 'Golden Cross' : 'Death Cross')
                    : null;
                  return (
                    <tr key={asset.symbol} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-2 font-medium text-white/90">
                        <div className="flex items-center gap-2">
                          {asset.symbol}
                          {asset.category === 'gold' && <span className="text-yellow-400 text-xs">Au</span>}
                          {asset.category === 'silver' && <span className="text-gray-300 text-xs">Ag</span>}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-white/60">{asset.name}</td>
                      <td className="py-3 px-2">
                        <Chip size="sm" variant="flat" color={asset.type === 'futures' ? 'warning' : 'primary'}>
                          {asset.type}
                        </Chip>
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-white/90 font-medium">
                        {q ? `$${q.price.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-white/50">
                        {q?.ema20 != null ? `$${q.ema20.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-white/50">
                        {q?.ema50 != null ? `$${q.ema50.toFixed(2)}` : '—'}
                      </td>
                      <td className={`py-3 px-2 text-right font-mono ${getRsiColor(q?.rsi ?? null)}`}>
                        {q?.rsi != null ? q.rsi.toFixed(1) : '—'}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-white/50">
                        {q?.bollingerLower != null ? `$${q.bollingerLower.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-white/50">
                        {q?.bollingerUpper != null ? `$${q.bollingerUpper.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Divider className="bg-white/5" />

      {/* Strategy Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-yellow-500/5 border border-yellow-500/10">
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold text-yellow-400/80">Gold Momentum</h3>
          </CardHeader>
          <CardBody className="p-4 text-sm text-white/60 space-y-2">
            <p>EMA 20/50 crossover detection on gold futures.</p>
            <p>Golden Cross = Long signal (0.7 confidence). Death Cross = Exit/Short.</p>
            <p className="text-white/40">Stop: 3% | Target: 5%</p>
          </CardBody>
        </Card>
        <Card className="bg-gray-400/5 border border-gray-400/10">
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold text-gray-300/80">Silver Volatility</h3>
          </CardHeader>
          <CardBody className="p-4 text-sm text-white/60 space-y-2">
            <p>RSI + Bollinger Band mean-reversion on silver.</p>
            <p>RSI &lt;30 + price at lower BB = Long. RSI &gt;70 or upper BB = Exit.</p>
            <p className="text-white/40">Stop: 4% | Target: 6%</p>
          </CardBody>
        </Card>
        <Card className="bg-red-500/5 border border-red-500/10">
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold text-red-400/80">VIX Hedge</h3>
          </CardHeader>
          <CardBody className="p-4 text-sm text-white/60 space-y-2">
            <p>Automatic gold allocation when VIX &gt;25 or SPY drops &gt;3%.</p>
            <p>Hedges 5-10% of portfolio into GLD for protection.</p>
            <p className="text-white/40">Confidence: 0.8 | Defensive position</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

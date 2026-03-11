'use client';

import { useState, useEffect } from 'react';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Card, CardBody, Chip, Spinner } from '@heroui/react';
import { formatCurrency, formatPercent } from '@/lib/utils/formatters';

interface Asset {
  id: string;
  name: string;
  ticker?: string;
  value: number;
  change: number;
  changePercent: number;
  category: string;
  shares?: number;
  avgPrice?: number;
  currentPrice?: number;
}

interface TickerMeta {
  symbol: string;
  name?: string;
  exchange?: string;
  assetClass?: string;
  tradable?: boolean;
  shortable?: boolean;
  fractionable?: boolean;
  latestPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  bidSize?: number;
  askSize?: number;
  dayOpen?: number;
  dayHigh?: number;
  dayLow?: number;
  dayClose?: number;
  dayVolume?: number;
  dayVwap?: number;
  dayChange?: number;
  dayChangePercent?: number;
  prevClose?: number;
  prevVolume?: number;
  indicators?: {
    rsi?: number;
    macd?: number;
    bbPosition?: number;
    momentum5?: number;
    volatility?: number;
  };
  activeSignal?: {
    direction: string;
    confidence: number;
  };
  bayesian?: {
    winRate: number;
    observations: number;
  };
}

interface PortfolioTableProps {
  assets: Asset[];
}

export function PortfolioTable({ assets }: PortfolioTableProps) {
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [tickerMeta, setTickerMeta] = useState<TickerMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  useEffect(() => {
    if (!selectedAsset?.ticker || selectedAsset.category === 'cash') {
      setTickerMeta(null);
      return;
    }
    setMetaLoading(true);
    fetch(`/api/ticker/${selectedAsset.ticker}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setTickerMeta(data))
      .catch(() => setTickerMeta(null))
      .finally(() => setMetaLoading(false));
  }, [selectedAsset?.ticker, selectedAsset?.category]);

  const categoryColor = (cat: string) => {
    switch (cat) {
      case 'equity': return 'primary';
      case 'crypto': return 'warning';
      case 'cash': return 'success';
      case 'alternative': return 'secondary';
      case 'commodity': return 'danger';
      default: return 'default';
    }
  };

  const fmt = (v: number | undefined, decimals = 2) => v != null ? v.toFixed(decimals) : '—';
  const fmtVol = (v: number | undefined) => {
    if (!v) return '—';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toString();
  };

  return (
    <div className="space-y-3">
      <Card className="bg-white/5 border border-white/5">
        <CardBody className="p-0">
          <Table
            aria-label="Portfolio positions"
            removeWrapper
            classNames={{
              th: 'bg-white/5 text-white/50 text-xs',
              td: 'text-sm',
              tr: 'hover:bg-white/5 cursor-pointer border-b border-white/5 last:border-0',
            }}
            selectionMode="single"
            onRowAction={(key) => {
              const asset = assets.find(a => a.id === key);
              setSelectedAsset(asset === selectedAsset ? null : asset || null);
            }}
          >
            <TableHeader>
              <TableColumn>Asset</TableColumn>
              <TableColumn>Type</TableColumn>
              <TableColumn align="end">Price</TableColumn>
              <TableColumn align="end">Value</TableColumn>
              <TableColumn align="end">P&L</TableColumn>
            </TableHeader>
            <TableBody emptyContent="No positions — system scanning for opportunities...">
              {assets.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell>
                    <div>
                      <span className="font-medium text-white/90">{asset.ticker}</span>
                      <span className="text-white/40 ml-2 text-xs">{asset.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat" color={categoryColor(asset.category)}>{asset.category}</Chip>
                  </TableCell>
                  <TableCell className="text-right font-mono text-white/70">
                    {asset.currentPrice ? formatCurrency(asset.currentPrice) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-white/90 font-medium">
                    {formatCurrency(asset.value)}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-medium ${asset.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {asset.change !== 0 ? `${asset.change >= 0 ? '+' : ''}${formatCurrency(asset.change)} (${formatPercent(asset.changePercent)})` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* Enriched detail panel when row is clicked */}
      {selectedAsset && selectedAsset.category !== 'cash' && (
        <Card className="bg-white/5 border border-blue-500/20">
          <CardBody className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-white/90">{tickerMeta?.name || selectedAsset.name}</h3>
                <Chip size="sm" variant="flat" color={categoryColor(selectedAsset.category)}>{selectedAsset.ticker}</Chip>
                {tickerMeta?.exchange && <span className="text-xs text-white/30">{tickerMeta.exchange}</span>}
                {tickerMeta?.shortable && <Chip size="sm" variant="flat" color="secondary">Shortable</Chip>}
                {tickerMeta?.activeSignal && (
                  <Chip size="sm" variant="flat" color={tickerMeta.activeSignal.direction === 'buy' ? 'success' : 'danger'}>
                    {tickerMeta.activeSignal.direction.toUpperCase()} {(tickerMeta.activeSignal.confidence * 100).toFixed(0)}%
                  </Chip>
                )}
              </div>
              <button onClick={() => setSelectedAsset(null)} className="text-white/30 hover:text-white/60 text-sm">Close</button>
            </div>

            {metaLoading ? (
              <div className="flex justify-center py-4"><Spinner size="sm" /></div>
            ) : (
              <div className="space-y-4">
                {/* Row 1: Position Info */}
                <div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Position</div>
                  <div className="grid grid-cols-5 gap-4 text-sm">
                    <div>
                      <div className="text-white/40 text-xs">Shares</div>
                      <div className="font-mono text-white/80">{selectedAsset.shares || '—'}</div>
                    </div>
                    <div>
                      <div className="text-white/40 text-xs">Avg Cost</div>
                      <div className="font-mono text-white/80">{selectedAsset.avgPrice ? formatCurrency(selectedAsset.avgPrice) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-white/40 text-xs">Current Price</div>
                      <div className="font-mono text-white/80">{selectedAsset.currentPrice ? formatCurrency(selectedAsset.currentPrice) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-white/40 text-xs">Market Value</div>
                      <div className="font-mono text-white/90 font-medium">{formatCurrency(selectedAsset.value)}</div>
                    </div>
                    <div>
                      <div className="text-white/40 text-xs">Unrealized P&L</div>
                      <div className={`font-mono font-medium ${selectedAsset.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {selectedAsset.change >= 0 ? '+' : ''}{formatCurrency(selectedAsset.change)} ({formatPercent(selectedAsset.changePercent)})
                      </div>
                    </div>
                  </div>
                </div>

                {/* Row 2: Market Data */}
                {tickerMeta && (
                  <div>
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Market Data</div>
                    <div className="grid grid-cols-6 gap-4 text-sm">
                      <div>
                        <div className="text-white/40 text-xs">Day Range</div>
                        <div className="font-mono text-white/70 text-xs">
                          {tickerMeta.dayLow ? `$${fmt(tickerMeta.dayLow)} — $${fmt(tickerMeta.dayHigh)}` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">Open</div>
                        <div className="font-mono text-white/70">${fmt(tickerMeta.dayOpen)}</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">Prev Close</div>
                        <div className="font-mono text-white/70">${fmt(tickerMeta.prevClose)}</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">Volume</div>
                        <div className="font-mono text-white/70">{fmtVol(tickerMeta.dayVolume)}</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">VWAP</div>
                        <div className="font-mono text-white/70">${fmt(tickerMeta.dayVwap)}</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">Bid / Ask</div>
                        <div className="font-mono text-white/70 text-xs">
                          ${fmt(tickerMeta.bidPrice)} / ${fmt(tickerMeta.askPrice)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Row 3: Technical Indicators */}
                {tickerMeta?.indicators && (
                  <div>
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Technical Indicators</div>
                    <div className="grid grid-cols-5 gap-4 text-sm">
                      <div>
                        <div className="text-white/40 text-xs">RSI</div>
                        <div className={`font-mono font-medium ${
                          (tickerMeta.indicators.rsi || 50) < 30 ? 'text-green-400' :
                          (tickerMeta.indicators.rsi || 50) > 70 ? 'text-red-400' : 'text-white/80'
                        }`}>{fmt(tickerMeta.indicators.rsi, 1)}</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">MACD</div>
                        <div className={`font-mono ${(tickerMeta.indicators.macd || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {fmt(tickerMeta.indicators.macd, 3)}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">BB Position</div>
                        <div className="font-mono text-white/80">{tickerMeta.indicators.bbPosition != null ? `${(tickerMeta.indicators.bbPosition * 100).toFixed(0)}%` : '—'}</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">Momentum (5-bar)</div>
                        <div className={`font-mono ${(tickerMeta.indicators.momentum5 || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {tickerMeta.indicators.momentum5 != null ? `${(tickerMeta.indicators.momentum5 * 100).toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">Volatility</div>
                        <div className="font-mono text-white/80">
                          {tickerMeta.indicators.volatility != null ? `${(tickerMeta.indicators.volatility * 100).toFixed(2)}%` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Row 4: Bayesian Intelligence */}
                {tickerMeta?.bayesian && (
                  <div>
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Bayesian Intelligence</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-white/40 text-xs">Historical Win Rate</div>
                        <div className={`font-mono font-medium ${tickerMeta.bayesian.winRate >= 0.55 ? 'text-green-400' : tickerMeta.bayesian.winRate < 0.45 ? 'text-red-400' : 'text-amber-400'}`}>
                          {(tickerMeta.bayesian.winRate * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-white/40 text-xs">Observations</div>
                        <div className="font-mono text-white/80">{tickerMeta.bayesian.observations}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Divider } from '@heroui/react';

interface CommodityContract {
  symbol: string;
  name: string;
  category: string;
  exchange: string;
  margin: string | number;
  tradingHours: string;
}

interface SpreadResult {
  symbol: string;
  spread: string;
  recommendation: string;
  confidence: number;
  details?: string;
}

interface SeasonalResult {
  symbol: string;
  pattern: string;
  direction: string;
  winRate: number;
  details?: string;
}

const CATEGORY_COLORS: Record<string, { chip: 'warning' | 'success' | 'secondary' | 'primary'; border: string; text: string }> = {
  livestock: { chip: 'warning', border: 'border-amber-500/20', text: 'text-amber-400' },
  grains: { chip: 'success', border: 'border-green-500/20', text: 'text-green-400' },
  energy: { chip: 'secondary', border: 'border-orange-500/20', text: 'text-orange-400' },
  metals: { chip: 'primary', border: 'border-blue-500/20', text: 'text-blue-400' },
};

function getCategoryStyle(category: string) {
  return CATEGORY_COLORS[category?.toLowerCase()] || CATEGORY_COLORS.metals;
}

export default function CommoditiesPage() {
  const [contracts, setContracts] = useState<CommodityContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [spreadResults, setSpreadResults] = useState<Record<string, SpreadResult>>({});
  const [seasonalResults, setSeasonalResults] = useState<Record<string, SeasonalResult>>({});
  const [evaluating, setEvaluating] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/expansion/commodities')
      .then(r => r.json())
      .then(d => {
        // API returns contracts as object keyed by symbol — normalize to array
        const raw = d.contracts || {};
        const arr = Array.isArray(raw) ? raw : Object.values(raw);
        setContracts(arr);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const evaluateSpread = useCallback(async (symbol: string) => {
    setEvaluating(prev => ({ ...prev, [`spread-${symbol}`]: true }));
    try {
      const res = await fetch('/api/expansion/commodities/spread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (!data.error) {
        setSpreadResults(prev => ({ ...prev, [symbol]: data }));
      }
    } catch { /* silently fail */ }
    setEvaluating(prev => ({ ...prev, [`spread-${symbol}`]: false }));
  }, []);

  const evaluateSeasonal = useCallback(async (symbol: string) => {
    setEvaluating(prev => ({ ...prev, [`seasonal-${symbol}`]: true }));
    try {
      const res = await fetch('/api/expansion/commodities/seasonal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (!data.error) {
        setSeasonalResults(prev => ({ ...prev, [symbol]: data }));
      }
    } catch { /* silently fail */ }
    setEvaluating(prev => ({ ...prev, [`seasonal-${symbol}`]: false }));
  }, []);

  const categories = [...new Set(contracts.map(c => c.category?.toLowerCase()).filter(Boolean))];
  const grouped = categories.reduce<Record<string, CommodityContract[]>>((acc, cat) => {
    acc[cat] = contracts.filter(c => c.category?.toLowerCase() === cat);
    return acc;
  }, {});

  const spreadCount = Object.keys(spreadResults).length;

  if (loading) return <div className="text-white/40">Loading commodities...</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Commodities</h1>
        <p className="text-sm text-white/40 mt-1">Agricultural, Livestock, Energy &amp; Metals</p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Total Contracts</div>
            <div className="text-2xl font-bold">{contracts.length}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Categories</div>
            <div className="text-2xl font-bold">{categories.length}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Spread Strategies Active</div>
            <div className="text-2xl font-bold text-green-400">{spreadCount}</div>
          </CardBody>
        </Card>
      </div>

      {/* Contracts by Category */}
      {categories.map(category => {
        const style = getCategoryStyle(category);
        const items = grouped[category] || [];

        return (
          <Card key={category} className={`bg-white/5 border ${style.border}`}>
            <CardHeader className="px-4 pt-4 pb-0 flex items-center gap-2">
              <h3 className={`font-semibold capitalize ${style.text}`}>{category}</h3>
              <Chip size="sm" color={style.chip} variant="flat">{items.length} contracts</Chip>
            </CardHeader>
            <CardBody className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map(contract => (
                  <Card key={contract.symbol} className="bg-white/[0.03] border border-white/5">
                    <CardBody className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white/90">{contract.symbol}</span>
                          <Chip size="sm" color={style.chip} variant="flat">{category}</Chip>
                        </div>
                      </div>
                      <div className="text-sm text-white/80">{contract.name}</div>
                      <Divider className="bg-white/5" />
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div>
                          <span className="text-white/40">Exchange: </span>
                          <span className="text-white/70">{contract.exchange}</span>
                        </div>
                        <div>
                          <span className="text-white/40">Margin: </span>
                          <span className="text-white/70">
                            {typeof contract.margin === 'number'
                              ? `$${contract.margin.toLocaleString()}`
                              : contract.margin}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-white/40">Hours: </span>
                          <span className="text-white/70">{contract.tradingHours}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="flat"
                          color={style.chip}
                          isLoading={evaluating[`spread-${contract.symbol}`]}
                          onPress={() => evaluateSpread(contract.symbol)}
                        >
                          Evaluate Spread
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="default"
                          isLoading={evaluating[`seasonal-${contract.symbol}`]}
                          onPress={() => evaluateSeasonal(contract.symbol)}
                        >
                          Evaluate Seasonal
                        </Button>
                      </div>

                      {/* Spread Results */}
                      {spreadResults[contract.symbol] && (
                        <div className="mt-2 p-2 rounded bg-white/[0.03] border border-white/5 space-y-1">
                          <div className="text-xs font-semibold text-white/60">Spread Analysis</div>
                          <div className="text-xs text-white/80">
                            <span className="text-white/40">Spread: </span>
                            {spreadResults[contract.symbol].spread}
                          </div>
                          <div className="text-xs text-white/80">
                            <span className="text-white/40">Recommendation: </span>
                            {spreadResults[contract.symbol].recommendation}
                          </div>
                          <div className="text-xs text-white/80">
                            <span className="text-white/40">Confidence: </span>
                            <span className={
                              spreadResults[contract.symbol].confidence > 0.7
                                ? 'text-green-400'
                                : spreadResults[contract.symbol].confidence > 0.4
                                  ? 'text-yellow-400'
                                  : 'text-red-400'
                            }>
                              {(spreadResults[contract.symbol].confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          {spreadResults[contract.symbol].details && (
                            <div className="text-xs text-white/50">{spreadResults[contract.symbol].details}</div>
                          )}
                        </div>
                      )}

                      {/* Seasonal Results */}
                      {seasonalResults[contract.symbol] && (
                        <div className="mt-2 p-2 rounded bg-white/[0.03] border border-white/5 space-y-1">
                          <div className="text-xs font-semibold text-white/60">Seasonal Pattern</div>
                          <div className="text-xs text-white/80">
                            <span className="text-white/40">Pattern: </span>
                            {seasonalResults[contract.symbol].pattern}
                          </div>
                          <div className="text-xs text-white/80">
                            <span className="text-white/40">Direction: </span>
                            <Chip size="sm" variant="flat" color={
                              seasonalResults[contract.symbol].direction === 'bullish' ? 'success' : 'danger'
                            }>
                              {seasonalResults[contract.symbol].direction}
                            </Chip>
                          </div>
                          <div className="text-xs text-white/80">
                            <span className="text-white/40">Win Rate: </span>
                            <span className="text-green-400">
                              {(seasonalResults[contract.symbol].winRate * 100).toFixed(0)}%
                            </span>
                          </div>
                          {seasonalResults[contract.symbol].details && (
                            <div className="text-xs text-white/50">{seasonalResults[contract.symbol].details}</div>
                          )}
                        </div>
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>
            </CardBody>
          </Card>
        );
      })}

      {/* Empty state */}
      {contracts.length === 0 && (
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-8 text-center">
            <div className="text-white/40 text-sm">No commodity contracts available. Ensure the gateway is running.</div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

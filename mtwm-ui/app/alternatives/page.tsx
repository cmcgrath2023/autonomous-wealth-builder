'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Divider, Progress } from '@heroui/react';

interface AlternativeAsset {
  name: string;
  category: string;
  allocation: number;
  returnYTD: number;
  risk: 'low' | 'medium' | 'high';
  thesis: string;
  correlation: number;
}

const ALTERNATIVES: AlternativeAsset[] = [
  { name: 'Bitcoin (BTC)', category: 'Crypto', allocation: 8, returnYTD: 42.5, risk: 'high', thesis: 'Digital store of value — macro hedge against fiat debasement. Position sizing disciplined via Kelly criterion.', correlation: -0.12 },
  { name: 'Ethereum (ETH)', category: 'Crypto', allocation: 4, returnYTD: 28.3, risk: 'high', thesis: 'Smart contract platform — L2 scaling thesis. DeFi protocol exposure without individual token risk.', correlation: -0.08 },
  { name: 'Gold (GLD)', category: 'Precious Metals', allocation: 10, returnYTD: 14.2, risk: 'low', thesis: 'Traditional safe haven — central bank accumulation trend continuing. Negative real rates environment.', correlation: -0.31 },
  { name: 'Silver (SLV)', category: 'Precious Metals', allocation: 3, returnYTD: 8.7, risk: 'medium', thesis: 'Industrial + monetary demand convergence. Solar panel demand growth accelerating.', correlation: -0.22 },
  { name: 'Timber REITs', category: 'Real Assets', allocation: 2, returnYTD: 5.1, risk: 'low', thesis: 'Inflation-linked biological growth asset. Carbon credit optionality via sustainable forestry.', correlation: 0.15 },
  { name: 'Farmland', category: 'Real Assets', allocation: 3, returnYTD: 7.8, risk: 'low', thesis: 'Food security + inflation hedge. Limited supply, growing global demand. Olympia/WA agricultural adjacency.', correlation: 0.08 },
  { name: 'Private Credit', category: 'Credit', allocation: 5, returnYTD: 11.2, risk: 'medium', thesis: 'Senior secured lending to middle-market companies. Floating rate protects against rising rates.', correlation: 0.22 },
  { name: 'Infrastructure Fund', category: 'Real Assets', allocation: 4, returnYTD: 9.4, risk: 'low', thesis: 'Essential services — toll roads, utilities, data centers. Contracted cash flows with inflation escalators.', correlation: 0.18 },
  { name: 'Art & Collectibles', category: 'Collectibles', allocation: 1, returnYTD: 3.2, risk: 'high', thesis: 'Ultra-low correlation alternative. Fractionalized ownership via platforms. Long-term appreciation.', correlation: -0.05 },
  { name: 'Venture (Pre-seed)', category: 'Venture', allocation: 2, returnYTD: 0, risk: 'high', thesis: 'AI/ML startup exposure. McGrath Trust network deal flow. Angel syndicate participation.', correlation: 0.05 },
];

const CATEGORY_COLORS: Record<string, { chip: 'warning' | 'success' | 'primary' | 'secondary' | 'danger'; text: string }> = {
  'Crypto': { chip: 'warning', text: 'text-amber-400' },
  'Precious Metals': { chip: 'success', text: 'text-yellow-400' },
  'Real Assets': { chip: 'primary', text: 'text-green-400' },
  'Credit': { chip: 'secondary', text: 'text-blue-400' },
  'Collectibles': { chip: 'danger', text: 'text-pink-400' },
  'Venture': { chip: 'warning', text: 'text-purple-400' },
};

export default function AlternativesPage() {
  const [assets] = useState<AlternativeAsset[]>(ALTERNATIVES);

  const totalAllocation = assets.reduce((s, a) => s + a.allocation, 0);
  const weightedReturn = assets.reduce((s, a) => s + a.returnYTD * (a.allocation / totalAllocation), 0);
  const categories = [...new Set(assets.map(a => a.category))];
  const avgCorrelation = assets.reduce((s, a) => s + Math.abs(a.correlation), 0) / assets.length;

  const grouped = categories.reduce<Record<string, AlternativeAsset[]>>((acc, cat) => {
    acc[cat] = assets.filter(a => a.category === cat);
    return acc;
  }, {});

  const riskColor = (r: string) => r === 'low' ? 'success' : r === 'medium' ? 'warning' : 'danger';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alternatives</h1>
        <p className="text-sm text-white/40 mt-1">Non-correlated assets — Crypto, Precious Metals, Real Assets, Venture</p>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Alt Allocation</div>
            <div className="text-2xl font-bold">{totalAllocation}%</div>
            <div className="text-xs text-white/30 mt-1">of portfolio</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Weighted Return YTD</div>
            <div className={`text-2xl font-bold ${weightedReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {weightedReturn >= 0 ? '+' : ''}{weightedReturn.toFixed(1)}%
            </div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Asset Classes</div>
            <div className="text-2xl font-bold">{categories.length}</div>
            <div className="text-xs text-white/30 mt-1">{assets.length} positions</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Avg |Correlation|</div>
            <div className="text-2xl font-bold text-blue-400">{avgCorrelation.toFixed(2)}</div>
            <div className="text-xs text-white/30 mt-1">to S&P 500</div>
          </CardBody>
        </Card>
      </div>

      {/* Allocation Bar */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <h3 className="font-semibold text-white/80">Allocation Breakdown</h3>
        </CardHeader>
        <CardBody className="p-4 space-y-3">
          {categories.map(cat => {
            const catAssets = grouped[cat];
            const catAlloc = catAssets.reduce((s, a) => s + a.allocation, 0);
            const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS['Crypto'];
            return (
              <div key={cat}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${colors.text}`}>{cat}</span>
                    <Chip size="sm" color={colors.chip} variant="flat">{catAssets.length} assets</Chip>
                  </div>
                  <span className="text-sm text-white/60">{catAlloc}%</span>
                </div>
                <Progress value={(catAlloc / totalAllocation) * 100} color={colors.chip} size="sm" />
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* Assets by Category */}
      {categories.map(cat => {
        const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS['Crypto'];
        const items = grouped[cat];

        return (
          <Card key={cat} className="bg-white/5 border border-white/5">
            <CardHeader className="px-4 pt-4 pb-0 flex items-center gap-2">
              <h3 className={`font-semibold ${colors.text}`}>{cat}</h3>
              <Chip size="sm" color={colors.chip} variant="flat">
                {items.reduce((s, a) => s + a.allocation, 0)}% allocation
              </Chip>
            </CardHeader>
            <CardBody className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map(asset => (
                  <Card key={asset.name} className="bg-white/[0.03] border border-white/5">
                    <CardBody className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-white/90 text-sm">{asset.name}</span>
                        <div className="flex items-center gap-1">
                          <Chip size="sm" variant="flat" color={riskColor(asset.risk)}>{asset.risk}</Chip>
                          <span className="text-xs text-white/40">{asset.allocation}%</span>
                        </div>
                      </div>
                      <p className="text-xs text-white/40 leading-relaxed">{asset.thesis}</p>
                      <Divider className="bg-white/5" />
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <span className="text-white/40">YTD: </span>
                          <span className={asset.returnYTD >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {asset.returnYTD >= 0 ? '+' : ''}{asset.returnYTD}%
                          </span>
                        </div>
                        <div>
                          <span className="text-white/40">Corr: </span>
                          <span className={Math.abs(asset.correlation) < 0.2 ? 'text-blue-400' : 'text-white/60'}>
                            {asset.correlation >= 0 ? '+' : ''}{asset.correlation.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

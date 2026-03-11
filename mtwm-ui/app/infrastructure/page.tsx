'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Divider } from '@heroui/react';

interface Asset {
  symbol: string;
  name: string;
  type: 'futures' | 'stock' | 'etf';
  category: string;
  thesis: string;
  correlations: string[];
}

interface CategoryAllocation {
  allocation: number;
  assets: any[];
}

interface AllocationData {
  allocation: Record<string, CategoryAllocation>;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; chip: 'warning' | 'success' | 'primary' | 'secondary' | 'danger' }> = {
  copper:     { bg: 'border-orange-500/30', text: 'text-orange-400', chip: 'warning' },
  uranium:    { bg: 'border-green-500/30',  text: 'text-green-400',  chip: 'success' },
  natgas:     { bg: 'border-blue-500/30',   text: 'text-blue-400',   chip: 'primary' },
  rare_earth: { bg: 'border-purple-500/30', text: 'text-purple-400', chip: 'secondary' },
  power:      { bg: 'border-yellow-500/30', text: 'text-yellow-400', chip: 'danger' },
};

const CATEGORY_LABELS: Record<string, string> = {
  copper: 'Copper',
  uranium: 'Uranium',
  natgas: 'Natural Gas',
  rare_earth: 'Rare Earths',
  power: 'Power & Grid',
};

function formatDollars(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default function InfrastructurePage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [allocation, setAllocation] = useState<AllocationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [capexForm, setCapexForm] = useState({ company: '', amount: '', focus: '' });
  const [capexStatus, setCapexStatus] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/expansion/infra/assets').then(r => r.json()),
      fetch('/api/expansion/infra/allocation').then(r => r.json()),
    ]).then(([assetsData, allocData]) => {
      setAssets(assetsData.assets || []);
      // API may return { allocation: { cat: { allocation, assets } } } directly
      if (allocData.allocation) {
        setAllocation({ allocation: allocData.allocation });
      } else {
        setAllocation(allocData);
      }
    }).catch(() => {
      setAssets([]);
      setAllocation(null);
    }).finally(() => setLoading(false));
  }, []);

  const grouped = assets.reduce<Record<string, Asset[]>>((acc, a) => {
    (acc[a.category] ||= []).push(a);
    return acc;
  }, {});

  const categories = Object.keys(CATEGORY_LABELS);

  async function submitCapex() {
    if (!capexForm.company || !capexForm.amount || !capexForm.focus) return;
    setCapexStatus('Submitting...');
    try {
      const res = await fetch('/api/expansion/infra/capex-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: capexForm.company,
          amount_billions: parseFloat(capexForm.amount),
          focus: capexForm.focus,
        }),
      });
      if (res.ok) {
        setCapexStatus('Event registered successfully');
        setCapexForm({ company: '', amount: '', focus: '' });
      } else {
        setCapexStatus('Failed to register event');
      }
    } catch {
      setCapexStatus('Network error');
    }
    setTimeout(() => setCapexStatus(null), 3000);
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white/90">AI Infrastructure</h1>
        <p className="text-white/40 text-sm mt-1">
          Data Center Supply Chain — Copper, Uranium, Natural Gas, Rare Earths
        </p>
      </div>

      {loading ? (
        <div className="text-white/40 text-center py-12">Loading infrastructure data...</div>
      ) : (
        <>
          {/* Sector Allocation Overview */}
          <div>
            <h2 className="text-lg font-semibold text-white/80 mb-3">Sector Allocation Overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {categories.map(cat => {
                const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.copper;
                const alloc = allocation?.allocation?.[cat];
                return (
                  <Card
                    key={cat}
                    className={`bg-white/5 border ${colors.bg}`}
                  >
                    <CardBody className="p-4">
                      <p className={`text-xs font-medium ${colors.text} uppercase tracking-wide`}>
                        {CATEGORY_LABELS[cat]}
                      </p>
                      <p className="text-xl font-bold text-white/90 mt-1">
                        {alloc ? formatDollars(alloc.allocation) : '—'}
                      </p>
                      <p className="text-xs text-white/40 mt-0.5">
                        {alloc ? `${alloc.assets?.length || 0} assets` : 'No allocation'}
                      </p>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </div>

          <Divider className="bg-white/5" />

          {/* Assets by Category */}
          {categories.map(cat => {
            const group = grouped[cat];
            if (!group || group.length === 0) return null;
            const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.copper;

            return (
              <div key={cat}>
                <h2 className={`text-lg font-semibold ${colors.text} mb-3`}>
                  {CATEGORY_LABELS[cat]}
                  <Chip size="sm" variant="flat" color={colors.chip} className="ml-2">
                    {group.length} asset{group.length !== 1 ? 's' : ''}
                  </Chip>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.map(asset => (
                    <Card key={asset.symbol} className={`bg-white/5 border ${colors.bg}`}>
                      <CardHeader className="pb-1 pt-3 px-4 flex justify-between items-start">
                        <div>
                          <span className="text-white/90 font-bold text-sm">{asset.symbol}</span>
                          <span className="text-white/40 text-xs ml-2">{asset.name}</span>
                        </div>
                        <Chip size="sm" variant="flat" color={colors.chip}>
                          {asset.type}
                        </Chip>
                      </CardHeader>
                      <CardBody className="pt-1 px-4 pb-3 space-y-2">
                        <p className="text-white/60 text-xs leading-relaxed">{asset.thesis}</p>
                        {asset.correlations && asset.correlations.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {asset.correlations.map(c => (
                              <Chip key={c} size="sm" variant="dot" className="text-[10px] text-white/40">
                                {c}
                              </Chip>
                            ))}
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}

          <Divider className="bg-white/5" />

          {/* Register Capex Event */}
          <Card className="bg-white/5 border border-white/5">
            <CardHeader className="pb-1">
              <h2 className="text-lg font-semibold text-white/80">Register Capex Event</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-white/40 text-xs">
                Track major data center or infrastructure capital expenditure announcements.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-white/40 text-xs block mb-1">Company</label>
                  <input
                    type="text"
                    placeholder="e.g. Microsoft, Meta"
                    value={capexForm.company}
                    onChange={e => setCapexForm(f => ({ ...f, company: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-white/20"
                  />
                </div>
                <div>
                  <label className="text-white/40 text-xs block mb-1">Amount ($B)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 10.0"
                    value={capexForm.amount}
                    onChange={e => setCapexForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-white/20"
                  />
                </div>
                <div>
                  <label className="text-white/40 text-xs block mb-1">Focus Area</label>
                  <input
                    type="text"
                    placeholder="e.g. AI data centers, GPU clusters"
                    value={capexForm.focus}
                    onChange={e => setCapexForm(f => ({ ...f, focus: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-white/20"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  onPress={submitCapex}
                  isDisabled={!capexForm.company || !capexForm.amount || !capexForm.focus}
                >
                  Register Event
                </Button>
                {capexStatus && (
                  <span className="text-xs text-white/40">{capexStatus}</span>
                )}
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

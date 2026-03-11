'use client';

import { useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Divider, Progress } from '@heroui/react';

interface BusinessUnit {
  name: string;
  type: string;
  revenue: number;
  expenses: number;
  status: 'active' | 'planning' | 'paused';
  description: string;
  kpis: { label: string; value: string; trend?: 'up' | 'down' | 'flat' }[];
}

const BUSINESS_UNITS: BusinessUnit[] = [
  {
    name: 'MTWM Trading Operations',
    type: 'Algorithmic Trading',
    revenue: 12400,
    expenses: 890,
    status: 'active',
    description: 'Autonomous algorithmic trading across equities, options, and futures via Alpaca. Analyst Agent + Bayesian Intel engine.',
    kpis: [
      { label: 'Win Rate', value: '68%', trend: 'up' },
      { label: 'Sharpe Ratio', value: '1.42', trend: 'up' },
      { label: 'Active Signals', value: '12', trend: 'flat' },
      { label: 'Max Drawdown', value: '-4.2%', trend: 'up' },
    ],
  },
  {
    name: 'Real Estate Pipeline',
    type: 'Acquisitions & Analysis',
    revenue: 0,
    expenses: 150,
    status: 'active',
    description: 'Olympia/Tumwater WA focused. Creative financing via Allen Nothing Down strategy. OpenClaw agent autonomous deal sourcing.',
    kpis: [
      { label: 'Pipeline Deals', value: '8', trend: 'up' },
      { label: 'Target Area', value: 'Olympia WA', trend: 'flat' },
      { label: 'Avg Cap Rate', value: '7.2%', trend: 'flat' },
      { label: 'Creative Offers', value: '3', trend: 'up' },
    ],
  },
  {
    name: 'AI Infrastructure Thesis',
    type: 'Thematic Investing',
    revenue: 3200,
    expenses: 0,
    status: 'active',
    description: 'Data center supply chain plays — copper, uranium, natural gas, rare earths. Capex event tracking for position timing.',
    kpis: [
      { label: 'Sectors', value: '5', trend: 'flat' },
      { label: 'Tracked Assets', value: '15+', trend: 'up' },
      { label: 'Capex Events', value: '7', trend: 'up' },
      { label: 'YTD Return', value: '+11.3%', trend: 'up' },
    ],
  },
  {
    name: 'Commodity Strategies',
    type: 'Futures & ETF Proxies',
    revenue: 1800,
    expenses: 0,
    status: 'active',
    description: 'Livestock, grains, energy, metals via Alpaca ETF proxies. Spread and seasonal pattern analysis.',
    kpis: [
      { label: 'Contracts', value: '11', trend: 'flat' },
      { label: 'Spread Opps', value: '4', trend: 'up' },
      { label: 'Seasonal Signals', value: '3', trend: 'flat' },
      { label: 'Coverage', value: '4 sectors', trend: 'flat' },
    ],
  },
  {
    name: 'Global Markets Coverage',
    type: 'Multi-Session Trading',
    revenue: 800,
    expenses: 0,
    status: 'active',
    description: 'Sydney → Tokyo → London → NY coverage. FOREX scanner pending OANDA integration. 24/7 opportunity detection.',
    kpis: [
      { label: 'Sessions', value: '7', trend: 'flat' },
      { label: 'Instruments', value: '20+', trend: 'up' },
      { label: 'Coverage', value: '24h', trend: 'flat' },
      { label: 'FOREX', value: 'Pending', trend: 'flat' },
    ],
  },
  {
    name: 'McGrath Trust Admin',
    type: 'Trust Management',
    revenue: 0,
    expenses: 420,
    status: 'active',
    description: 'Trust administration, compliance, and wealth preservation strategy. Long-term generational wealth building.',
    kpis: [
      { label: 'Structure', value: 'Revocable', trend: 'flat' },
      { label: 'Beneficiaries', value: 'Family', trend: 'flat' },
      { label: 'Tax Strategy', value: 'Active', trend: 'flat' },
      { label: 'Estate Plan', value: 'Current', trend: 'flat' },
    ],
  },
];

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'default'> = {
  active: 'success',
  planning: 'warning',
  paused: 'default',
};

export default function BusinessPage() {
  const [units] = useState<BusinessUnit[]>(BUSINESS_UNITS);

  const totalRevenue = units.reduce((s, u) => s + u.revenue, 0);
  const totalExpenses = units.reduce((s, u) => s + u.expenses, 0);
  const netIncome = totalRevenue - totalExpenses;
  const activeUnits = units.filter(u => u.status === 'active').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Business Operations</h1>
        <p className="text-sm text-white/40 mt-1">McGrath Trust Wealth Management — Operating Units</p>
      </div>

      {/* Financial Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Monthly Revenue</div>
            <div className="text-2xl font-bold text-green-400">${totalRevenue.toLocaleString()}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Monthly Expenses</div>
            <div className="text-2xl font-bold text-red-400">${totalExpenses.toLocaleString()}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Net Income</div>
            <div className={`text-2xl font-bold ${netIncome >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${netIncome.toLocaleString()}
            </div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Active Units</div>
            <div className="text-2xl font-bold">{activeUnits}</div>
            <div className="text-xs text-white/30 mt-1">of {units.length} total</div>
          </CardBody>
        </Card>
      </div>

      {/* Profit Margin */}
      <Card className="bg-white/5 border border-white/5">
        <CardBody className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/60">Operating Margin</span>
            <span className="text-sm font-bold text-green-400">
              {totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(1) : 0}%
            </span>
          </div>
          <Progress
            value={totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0}
            color="success"
            size="md"
          />
        </CardBody>
      </Card>

      <Divider className="bg-white/5" />

      {/* Business Units */}
      <div className="space-y-4">
        {units.map(unit => (
          <Card key={unit.name} className="bg-white/5 border border-white/5">
            <CardHeader className="px-4 pt-4 pb-0">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white/90">{unit.name}</h3>
                  <Chip size="sm" variant="flat" color={STATUS_COLOR[unit.status]}>{unit.status}</Chip>
                </div>
                <Chip size="sm" variant="bordered" color="default">{unit.type}</Chip>
              </div>
            </CardHeader>
            <CardBody className="p-4 space-y-3">
              <p className="text-xs text-white/40 leading-relaxed">{unit.description}</p>

              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-white/40">Rev: </span>
                  <span className="text-green-400 font-medium">${unit.revenue.toLocaleString()}/mo</span>
                </div>
                <div>
                  <span className="text-white/40">Exp: </span>
                  <span className="text-red-400 font-medium">${unit.expenses.toLocaleString()}/mo</span>
                </div>
                <div>
                  <span className="text-white/40">Net: </span>
                  <span className={`font-medium ${unit.revenue - unit.expenses >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${(unit.revenue - unit.expenses).toLocaleString()}/mo
                  </span>
                </div>
              </div>

              <Divider className="bg-white/5" />

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {unit.kpis.map(kpi => (
                  <div key={kpi.label} className="p-2 rounded bg-white/[0.03] border border-white/5">
                    <div className="text-[10px] text-white/40 uppercase tracking-wide">{kpi.label}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-sm font-bold text-white/80">{kpi.value}</span>
                      {kpi.trend === 'up' && <span className="text-green-400 text-xs">↑</span>}
                      {kpi.trend === 'down' && <span className="text-red-400 text-xs">↓</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

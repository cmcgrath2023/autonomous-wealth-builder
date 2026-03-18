'use client';

import { useEffect } from 'react';
import { usePortfolioStore } from '@/stores/portfolio';
import { useModulesStore } from '@/stores/modules';
import { useSystemStore } from '@/stores/system';
import { useDecisionsStore } from '@/stores/decisions';
import { ModuleCard } from '@/components/dashboard/ModuleCard';
import { BriefingPanel } from '@/components/dashboard/BriefingPanel';
import { DecisionQueue } from '@/components/dashboard/DecisionQueue';
import { MetricTile } from '@/components/dashboard/MetricTile';
import { SystemStatus } from '@/components/layout/SystemStatus';
import { PortfolioTable } from '@/components/dashboard/PortfolioTable';
import { DailyTargetTracker } from '@/components/dashboard/DailyTargetTracker';
import { IntelligenceGrowth } from '@/components/dashboard/IntelligenceGrowth';
import { ResearchDigest } from '@/components/dashboard/ResearchDigest';
import { formatCurrency, formatPercent, formatRelativeTime } from '@/lib/utils/formatters';
import { REFRESH_INTERVALS } from '@/lib/utils/constants';

// Globe removed — replaced with Active Strategy panel for better operational visibility

export default function Dashboard() {
  const {
    totalValue, totalPnl, totalPnlPercent, unrealizedPnl, realizedPnl,
    dayChange, brokerConnected, buyingPower, cash, tradeStats, autonomy,
    assets, lastUpdated, fetchPortfolio,
  } = usePortfolioStore();
  const { modules, fetchModules } = useModulesStore();
  const { fetchSystemStatus } = useSystemStore();
  const { decisions, fetchDecisions } = useDecisionsStore();

  useEffect(() => {
    fetchPortfolio();
    fetchModules();
    fetchSystemStatus();
    fetchDecisions();

    const i1 = setInterval(fetchPortfolio, REFRESH_INTERVALS.portfolio);
    const i2 = setInterval(fetchModules, REFRESH_INTERVALS.modules);
    const i3 = setInterval(fetchSystemStatus, REFRESH_INTERVALS.system);
    const i4 = setInterval(fetchDecisions, REFRESH_INTERVALS.decisions);
    return () => { clearInterval(i1); clearInterval(i2); clearInterval(i3); clearInterval(i4); };
  }, [fetchPortfolio, fetchModules, fetchSystemStatus, fetchDecisions]);

  const activeModules = modules.filter(m => m.status === 'active').length;
  const totalModules = modules.length || 4;
  const pendingDecisions = decisions.filter(d => d.status === 'pending').length;
  const openPositions = assets.filter(a => a.category !== 'cash');

  return (
    <div className="space-y-6">
      {/* Connection Status Banner */}
      {!brokerConnected && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm text-red-400 font-medium">Alpaca not connected — set API keys via gateway /api/broker/connect</span>
          </div>
        </div>
      )}

      {/* Top Row: Core Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <MetricTile
          label="Portfolio Value"
          value={formatCurrency(totalValue)}
          subValue={brokerConnected ? 'Live from Alpaca' : 'Disconnected'}
          trend={brokerConnected ? 'up' : 'neutral'}
        />
        <MetricTile
          label="Total P&L"
          value={`${totalPnl >= 0 ? '+' : ''}${formatCurrency(totalPnl)}`}
          subValue={`${formatPercent(totalPnlPercent)} from $100K`}
          trend={totalPnl >= 0 ? 'up' : 'down'}
        />
        <MetricTile
          label="Realized P&L"
          value={`${realizedPnl >= 0 ? '+' : ''}${formatCurrency(realizedPnl)}`}
          subValue={`${tradeStats.totalTrades} closed trades`}
          trend={realizedPnl >= 0 ? 'up' : 'down'}
        />
        <MetricTile
          label="Unrealized P&L"
          value={`${unrealizedPnl >= 0 ? '+' : ''}${formatCurrency(unrealizedPnl)}`}
          subValue={`${openPositions.length} open positions`}
          trend={unrealizedPnl >= 0 ? 'up' : 'down'}
        />
        <MetricTile
          label="Buying Power"
          value={formatCurrency(buyingPower)}
          subValue={`Cash: ${formatCurrency(cash)}`}
          trend="neutral"
        />
        <MetricTile
          label="Decisions Pending"
          value={String(pendingDecisions)}
          subValue={pendingDecisions > 0 ? 'Review required' : 'Autonomous'}
          trend={pendingDecisions > 0 ? 'neutral' : 'up'}
        />
      </div>

      {/* Second Row: Trade Performance + Autonomy Status */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <MetricTile
          label="Win Rate"
          value={tradeStats.totalTrades > 0 ? `${tradeStats.winRate.toFixed(1)}%` : '—'}
          subValue={`${tradeStats.wins}W / ${tradeStats.losses}L`}
          trend={tradeStats.winRate >= 50 ? 'up' : tradeStats.totalTrades > 0 ? 'down' : 'neutral'}
        />
        <MetricTile
          label="Best Trade"
          value={tradeStats.bestTrade > 0 ? `+${formatCurrency(tradeStats.bestTrade)}` : '—'}
          subValue="Single trade"
          trend={tradeStats.bestTrade > 0 ? 'up' : 'neutral'}
        />
        <MetricTile
          label="Worst Trade"
          value={tradeStats.worstTrade < 0 ? formatCurrency(tradeStats.worstTrade) : '—'}
          subValue="Single trade"
          trend={tradeStats.worstTrade < 0 ? 'down' : 'neutral'}
        />
        <MetricTile
          label="Avg Win"
          value={tradeStats.avgWin > 0 ? `+${formatCurrency(tradeStats.avgWin)}` : '—'}
          subValue={tradeStats.wins > 0 ? `${tradeStats.wins} wins` : ''}
          trend={tradeStats.avgWin > 0 ? 'up' : 'neutral'}
        />
        <MetricTile
          label="Avg Loss"
          value={tradeStats.avgLoss < 0 ? formatCurrency(tradeStats.avgLoss) : '—'}
          subValue={tradeStats.losses > 0 ? `${tradeStats.losses} losses` : ''}
          trend={tradeStats.avgLoss < 0 ? 'down' : 'neutral'}
        />
        <MetricTile
          label="Autonomy"
          value={autonomy?.enabled ? autonomy.level.toUpperCase() : 'OFF'}
          subValue={autonomy ? `${autonomy.heartbeatCount} heartbeats, ${autonomy.registeredActions} actions` : 'Not running'}
          trend={autonomy?.enabled && autonomy.level === 'act' ? 'up' : 'neutral'}
        />
      </div>

      {/* Data Freshness */}
      {lastUpdated && (
        <div className="text-xs text-white/25 text-right">
          Last updated: {formatRelativeTime(lastUpdated)} &middot; Refreshes every 30s from Alpaca
        </div>
      )}

      {/* Daily Cash Goal */}
      <DailyTargetTracker
        dayPnl={dayChange}
        realizedPnl={realizedPnl}
        unrealizedPnl={unrealizedPnl}
      />

      {/* Research Digest + Decisions + Portfolio Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PortfolioTable assets={assets} />
        </div>
        <div className="space-y-4">
          <ResearchDigest />
          <DecisionQueue />
        </div>
      </div>

      {/* Intelligence Growth + Strategy */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <IntelligenceGrowth />
        </div>
        <div className="space-y-4">
          <div className="bg-white/5 rounded-2xl border border-white/5 p-4">
            <h3 className="text-sm font-semibold text-white/60 mb-3">Active Strategy</h3>
            <div className="space-y-2 text-xs text-white/50">
              <div className="flex justify-between"><span>Mode</span><span className="text-white/80 font-mono">{autonomy?.level?.toUpperCase() || 'OFF'}</span></div>
              <div className="flex justify-between"><span>Heartbeat</span><span className="text-white/80 font-mono">2 min</span></div>
              <div className="flex justify-between"><span>Open Positions</span><span className="text-white/80 font-mono">{openPositions.length}</span></div>
              <div className="flex justify-between"><span>Closed Trades</span><span className="text-white/80 font-mono">{tradeStats.totalTrades}</span></div>
              <div className="flex justify-between"><span>Win Rate</span><span className={`font-mono ${tradeStats.winRate >= 55 ? 'text-green-400' : tradeStats.totalTrades > 0 ? 'text-red-400' : 'text-white/80'}`}>{tradeStats.totalTrades > 0 ? `${tradeStats.winRate.toFixed(1)}%` : '—'}</span></div>
              <div className="flex justify-between"><span>Target</span><span className="text-amber-400 font-mono">$5K→$15K / 30d</span></div>
              <div className="flex justify-between"><span>Strategy</span><span className="text-white/80 font-mono">AWB-SPEC</span></div>
            </div>
          </div>
          <BriefingPanel />
        </div>
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {modules.map((module) => (
          <ModuleCard key={module.id} module={module} />
        ))}
      </div>

      {/* System Status */}
      <SystemStatus />
    </div>
  );
}

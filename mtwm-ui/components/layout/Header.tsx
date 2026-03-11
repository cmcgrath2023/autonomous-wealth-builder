'use client';

import { Chip } from '@heroui/react';
import { usePortfolioStore } from '@/stores/portfolio';
import { useSystemStore } from '@/stores/system';
import { formatCurrency, formatPercent } from '@/lib/utils/formatters';

export function Header() {
  const { totalValue, dayChange, dayChangePercent, systemStatus } = usePortfolioStore();
  const { connected } = useSystemStore();

  const statusColor = systemStatus === 'healthy' ? 'success' : systemStatus === 'warning' ? 'warning' : 'danger';

  return (
    <header className="border-b border-white/5 bg-black/20 backdrop-blur-sm px-4 lg:px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 lg:gap-6 pl-10 lg:pl-0">
          <div>
            <div className="text-xs lg:text-sm text-white/40">Total Portfolio</div>
            <div className="text-lg lg:text-2xl font-bold tracking-tight">{formatCurrency(totalValue)}</div>
          </div>
          <div className="hidden sm:block">
            <div className="text-xs lg:text-sm text-white/40">Day P&L</div>
            <div className={`text-base lg:text-lg font-semibold ${dayChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(dayChange)} ({formatPercent(dayChangePercent)})
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="hidden md:flex items-center gap-2">
            <Chip size="sm" variant="dot" color={connected.ruvector ? 'success' : 'danger'}>RuVector</Chip>
            <Chip size="sm" variant="dot" color={connected.ruflow ? 'success' : 'danger'}>Ruflow</Chip>
            <Chip size="sm" variant="dot" color={connected.claude ? 'success' : 'danger'}>Claude</Chip>
          </div>
          <Chip size="sm" variant="flat" color={statusColor}>
            {systemStatus.toUpperCase()}
          </Chip>
        </div>
      </div>
    </header>
  );
}

'use client';

import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import Link from 'next/link';
import { ModuleStatus } from '@/types/modules';
import { formatCurrency, formatPercent, formatRelativeTime } from '@/lib/utils/formatters';
import { MODULE_COLORS, STATUS_COLORS } from '@/lib/utils/constants';

interface ModuleCardProps {
  module: ModuleStatus;
}

export function ModuleCard({ module }: ModuleCardProps) {
  const statusColor = module.status === 'active' ? 'success' : module.status === 'warning' ? 'warning' : module.status === 'error' ? 'danger' : 'default';

  return (
    <Link href={`/${module.id}`}>
      <Card className="bg-white/5 border border-white/5 hover:border-white/10 transition-colors cursor-pointer overflow-hidden">
        <CardHeader className="flex justify-between items-start gap-2 pb-0 px-4 pt-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-white/90 truncate">{module.name}</h3>
            <p className="text-xs text-white/40 mt-0.5">{module.activeAgents} agents active</p>
          </div>
          <Chip size="sm" variant="flat" color={statusColor} className="flex-shrink-0">{module.status}</Chip>
        </CardHeader>
        <CardBody className="px-4 pb-4 pt-3">
          <div className="flex justify-between items-end gap-2">
            <div className="min-w-0">
              <div className="text-xs text-white/40">Allocation</div>
              <div className="text-lg font-semibold truncate">{formatCurrency(module.allocation)}</div>
              <div className="text-xs text-white/40">{module.allocationPercent}% of portfolio</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs text-white/40">Day P&L</div>
              <div className={`text-lg font-semibold ${module.dayPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatPercent(module.dayPnlPercent)}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 text-xs text-white/30 truncate">
            {module.lastAction} — {formatRelativeTime(module.lastActionTime)}
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}

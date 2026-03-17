'use client';

import { Card, CardBody } from '@heroui/react';
import { formatCurrency } from '@/lib/utils/formatters';

interface DailyTargetTrackerProps {
  dayPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

const DAILY_GOAL = 500;

export function DailyTargetTracker({ dayPnl, realizedPnl, unrealizedPnl }: DailyTargetTrackerProps) {
  const progressPct = Math.max(0, Math.min(100, (dayPnl / DAILY_GOAL) * 100));
  const goalMet = dayPnl >= DAILY_GOAL;
  const isPositive = dayPnl > 0;
  const remaining = Math.max(0, DAILY_GOAL - dayPnl);

  // Color based on progress
  const barColor = goalMet
    ? 'bg-green-500'
    : progressPct >= 50
      ? 'bg-amber-500'
      : isPositive
        ? 'bg-blue-500'
        : 'bg-red-500';

  const statusText = goalMet
    ? 'GOAL MET'
    : dayPnl > 0
      ? `$${remaining.toFixed(0)} to go`
      : 'BEHIND';

  const statusColor = goalMet
    ? 'bg-green-500/20 text-green-400'
    : dayPnl > 0
      ? 'bg-amber-500/20 text-amber-400'
      : 'bg-red-500/20 text-red-400';

  return (
    <Card className="bg-white/5 border border-white/5">
      <CardBody className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white/60">Daily Cash Goal</h3>
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${statusColor}`}>
            {statusText}
          </span>
        </div>

        {/* Big number */}
        <div className="flex items-baseline gap-2 mb-3">
          <span className={`text-3xl font-mono font-bold ${isPositive ? 'text-green-400' : dayPnl < 0 ? 'text-red-400' : 'text-white/60'}`}>
            {dayPnl >= 0 ? '+' : ''}{formatCurrency(dayPnl)}
          </span>
          <span className="text-sm text-white/30 font-mono">/ {formatCurrency(DAILY_GOAL)}</span>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="w-full h-4 bg-white/5 rounded-full overflow-hidden relative">
            {/* Goal marker at 100% */}
            <div className="absolute right-0 top-0 h-full w-0.5 bg-white/20 z-10" />
            {/* Progress fill */}
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${progressPct}%` }}
            />
            {/* Percentage label inside bar */}
            {progressPct > 15 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold text-white/90">
                {progressPct.toFixed(0)}%
              </span>
            )}
          </div>
          <div className="flex justify-between text-[10px] text-white/25 mt-1">
            <span>$0</span>
            <span>${DAILY_GOAL}</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-white/40 text-xs">Today&apos;s P&L</div>
            <div className={`font-mono font-medium ${dayPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {dayPnl >= 0 ? '+' : ''}{formatCurrency(dayPnl)}
            </div>
          </div>
          <div>
            <div className="text-white/40 text-xs">Realized</div>
            <div className={`font-mono ${realizedPnl >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
              {realizedPnl >= 0 ? '+' : ''}{formatCurrency(realizedPnl)}
            </div>
          </div>
          <div>
            <div className="text-white/40 text-xs">Unrealized</div>
            <div className={`font-mono ${unrealizedPnl >= 0 ? 'text-blue-400/70' : 'text-red-400/70'}`}>
              {unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(unrealizedPnl)}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

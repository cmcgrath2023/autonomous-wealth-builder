'use client';

import { Card, CardBody } from '@heroui/react';
import { formatCurrency } from '@/lib/utils/formatters';

interface DailyTargetTrackerProps {
  dayPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

const DAILY_GOAL = 500;

// SVG circular progress bar
function CircularProgress({ percent, size = 140, stroke = 10, color }: { percent: number; size?: number; stroke?: number; color: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.min(percent, 100);
  const offset = circumference - (clampedPct / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={stroke}
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

export function DailyTargetTracker({ dayPnl, realizedPnl, unrealizedPnl }: DailyTargetTrackerProps) {
  const progressPct = Math.max(0, (dayPnl / DAILY_GOAL) * 100);
  const goalMet = dayPnl >= DAILY_GOAL;
  const isPositive = dayPnl > 0;
  const surplus = dayPnl - DAILY_GOAL;
  const remaining = Math.max(0, DAILY_GOAL - dayPnl);

  // Ring color
  const ringColor = goalMet
    ? '#22c55e'
    : progressPct >= 50
      ? '#f59e0b'
      : isPositive
        ? '#3b82f6'
        : '#ef4444';

  return (
    <Card className="bg-white/5 border border-white/5">
      <CardBody className="p-5">
        <div className="flex items-start gap-6">
          {/* Circular progress with center text */}
          <div className="relative flex-shrink-0" style={{ width: 140, height: 140 }}>
            <CircularProgress percent={progressPct} color={ringColor} />
            {/* Center content overlaid */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {goalMet ? (
                <>
                  <span className="text-[11px] font-semibold text-green-400 tracking-wide uppercase">At Goal</span>
                  <span className="text-2xl font-mono font-bold text-green-400">
                    {Math.round(progressPct)}%
                  </span>
                </>
              ) : (
                <>
                  <span className="text-2xl font-mono font-bold text-white/90">
                    {Math.round(progressPct)}%
                  </span>
                  <span className="text-[10px] text-white/40 font-mono">
                    ${remaining.toFixed(0)} to go
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right side: numbers */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-white/60">Daily Cash Goal</h3>
              {goalMet && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-green-500/20 text-green-400 uppercase tracking-wide">
                  Goal Met
                </span>
              )}
            </div>

            {/* Day P&L — the big number */}
            <div className="flex items-baseline gap-2 mb-3">
              <span className={`text-3xl font-mono font-bold ${isPositive ? 'text-green-400' : dayPnl < 0 ? 'text-red-400' : 'text-white/60'}`}>
                {dayPnl >= 0 ? '+' : ''}{formatCurrency(dayPnl)}
              </span>
              <span className="text-sm text-white/30 font-mono">/ {formatCurrency(DAILY_GOAL)}</span>
            </div>

            {/* Surplus banner when over goal */}
            {goalMet && surplus > 0 && (
              <div className="mb-3 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 inline-flex items-center gap-2">
                <span className="text-xs text-green-400/70">Surplus</span>
                <span className="text-sm font-mono font-bold text-green-400">+{formatCurrency(surplus)}</span>
              </div>
            )}

            {/* Breakdown */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40 text-xs">Day P&L</span>
                <span className={`font-mono text-xs ${dayPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {dayPnl >= 0 ? '+' : ''}{formatCurrency(dayPnl)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40 text-xs">Unrealized</span>
                <span className={`font-mono text-xs ${unrealizedPnl >= 0 ? 'text-blue-400/70' : 'text-red-400/70'}`}>
                  {unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(unrealizedPnl)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40 text-xs">Realized</span>
                <span className={`font-mono text-xs ${realizedPnl >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                  {realizedPnl >= 0 ? '+' : ''}{formatCurrency(realizedPnl)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40 text-xs">Target</span>
                <span className="font-mono text-xs text-white/50">{formatCurrency(DAILY_GOAL)}</span>
              </div>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

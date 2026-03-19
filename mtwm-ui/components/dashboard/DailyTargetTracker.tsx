'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardBody } from '@heroui/react';
import { formatCurrency } from '@/lib/utils/formatters';

interface DailyTargetTrackerProps {
  dayPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

type Period = 'today' | 'yesterday' | 'week' | 'month';

const DAILY_GOAL = 500;
const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 Days',
  month: 'Last 30 Days',
};
const PERIOD_GOALS: Record<Period, number> = {
  today: 500,
  yesterday: 500,
  week: 3500,
  month: 15000,
};

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
  const [period, setPeriod] = useState<Period>('today');
  const [historicalPnl, setHistoricalPnl] = useState<Record<string, number>>({});

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/profit');
      if (!res.ok) return;
      const data = await res.json();
      const days = data.days || [];
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

      const yesterdayPnl = days.find((d: any) => d.date === yesterday)?.pnl || 0;
      const weekPnl = days.filter((d: any) => d.date >= weekAgo).reduce((s: number, d: any) => s + (d.pnl || 0), 0);
      const monthPnl = days.filter((d: any) => d.date >= monthAgo).reduce((s: number, d: any) => s + (d.pnl || 0), 0);

      setHistoricalPnl({ yesterday: yesterdayPnl, week: weekPnl, month: monthPnl });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const goal = PERIOD_GOALS[period];
  const displayPnl = period === 'today' ? dayPnl
    : period === 'yesterday' ? historicalPnl.yesterday || 0
    : period === 'week' ? historicalPnl.week || 0
    : historicalPnl.month || 0;

  const progressPct = Math.max(0, (displayPnl / goal) * 100);
  const goalMet = displayPnl >= goal;
  const isPositive = displayPnl > 0;
  const surplus = displayPnl - goal;
  const remaining = Math.max(0, goal - displayPnl);

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
            {/* Period filter */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                {(['today', 'yesterday', 'week', 'month'] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      period === p
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'text-white/30 hover:text-white/50'
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
              {goalMet && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-green-500/20 text-green-400 uppercase tracking-wide">
                  Goal Met
                </span>
              )}
            </div>

            {/* P&L — the big number */}
            <div className="flex items-baseline gap-2 mb-3">
              <span className={`text-3xl font-mono font-bold ${isPositive ? 'text-green-400' : displayPnl < 0 ? 'text-red-400' : 'text-white/60'}`}>
                {displayPnl >= 0 ? '+' : ''}{formatCurrency(displayPnl)}
              </span>
              <span className="text-sm text-white/30 font-mono">/ {formatCurrency(goal)}</span>
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

'use client';

import { Card, CardBody } from '@heroui/react';
import { formatCurrency } from '@/lib/utils/formatters';

interface DailyTargetTrackerProps {
  totalPnl: number;
  totalValue: number;
  dayNumber: number; // Days since strategy start
}

const INITIAL_CAPITAL = 5000;
const TARGET_CAPITAL = 15000;
const TARGET_DAYS = 30;
const DAILY_TARGET = 333.33; // $10K profit over 30 days

export function DailyTargetTracker({ totalPnl, totalValue, dayNumber }: DailyTargetTrackerProps) {
  // Generate trajectory data: actual vs expected
  const dailyRate = Math.pow(TARGET_CAPITAL / INITIAL_CAPITAL, 1 / TARGET_DAYS) - 1; // ~1.2%/day
  const today = Math.max(1, dayNumber);

  // Expected capital at each day
  const trajectory: { day: number; expected: number; actual: number }[] = [];
  for (let d = 0; d <= Math.min(today + 5, TARGET_DAYS); d++) {
    const expected = INITIAL_CAPITAL * Math.pow(1 + dailyRate, d);
    const actual = d <= today ? INITIAL_CAPITAL + (totalPnl * (d / today)) : null;
    trajectory.push({
      day: d,
      expected: Math.round(expected),
      actual: actual !== null ? Math.round(actual) : 0,
    });
  }

  const expectedToday = INITIAL_CAPITAL * Math.pow(1 + dailyRate, today);
  const actualCapital = INITIAL_CAPITAL + totalPnl;
  const onTrack = actualCapital >= expectedToday * 0.9;
  const percentOfTarget = ((actualCapital / expectedToday) * 100);
  const dailyPnlNeeded = DAILY_TARGET - (totalPnl / Math.max(1, today));
  const progressPct = Math.max(0, Math.min(100, ((totalPnl / (TARGET_CAPITAL - INITIAL_CAPITAL)) * 100)));

  // Simple SVG bar chart showing daily progress
  const barWidth = 100;
  const targetBar = 100;
  const actualBar = Math.max(0, Math.min(100, (actualCapital / expectedToday) * 100));

  return (
    <Card className="bg-white/5 border border-white/5">
      <CardBody className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white/60">Daily Target Tracker — AWB-SPEC</h3>
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${onTrack ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            {onTrack ? 'ON TRACK' : 'BEHIND'}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-white/40 mb-1">
            <span>Day {today} of {TARGET_DAYS}</span>
            <span>{percentOfTarget.toFixed(0)}% of daily target</span>
          </div>
          <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden relative">
            {/* Expected position marker */}
            <div
              className="absolute top-0 h-full w-0.5 bg-amber-400/60 z-10"
              style={{ left: `${Math.min(100, (today / TARGET_DAYS) * 100)}%` }}
            />
            {/* Actual progress */}
            <div
              className={`h-full rounded-full transition-all ${onTrack ? 'bg-green-500/60' : 'bg-red-500/60'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-white/25 mt-1">
            <span>${INITIAL_CAPITAL.toLocaleString()}</span>
            <span>${TARGET_CAPITAL.toLocaleString()}</span>
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-white/40 text-xs">Actual Capital</div>
            <div className={`font-mono font-medium ${actualCapital >= INITIAL_CAPITAL ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(actualCapital)}
            </div>
          </div>
          <div>
            <div className="text-white/40 text-xs">Expected Today</div>
            <div className="font-mono text-amber-400">{formatCurrency(expectedToday)}</div>
          </div>
          <div>
            <div className="text-white/40 text-xs">Daily Target</div>
            <div className="font-mono text-white/80">{formatCurrency(DAILY_TARGET)}/day</div>
          </div>
          <div>
            <div className="text-white/40 text-xs">Total P&L</div>
            <div className={`font-mono font-medium ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
            </div>
          </div>
        </div>

        {/* Mini trajectory chart using SVG */}
        <div className="mt-3">
          <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">30-Day Growth Trajectory</div>
          <svg viewBox="0 0 300 60" className="w-full h-16">
            {/* Grid lines */}
            <line x1="0" y1="50" x2="300" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            <line x1="0" y1="30" x2="300" y2="30" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            <line x1="0" y1="10" x2="300" y2="10" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />

            {/* Expected trajectory (amber) */}
            <polyline
              fill="none"
              stroke="rgba(245,158,11,0.4)"
              strokeWidth="1.5"
              strokeDasharray="4,2"
              points={trajectory.map((t, i) => {
                const x = (t.day / TARGET_DAYS) * 300;
                const y = 55 - ((t.expected - INITIAL_CAPITAL) / (TARGET_CAPITAL - INITIAL_CAPITAL)) * 50;
                return `${x},${y}`;
              }).join(' ')}
            />

            {/* Actual trajectory (green/red) */}
            {today > 0 && (
              <polyline
                fill="none"
                stroke={onTrack ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)'}
                strokeWidth="2"
                points={trajectory.filter(t => t.day <= today).map((t) => {
                  const x = (t.day / TARGET_DAYS) * 300;
                  const y = 55 - ((t.actual - INITIAL_CAPITAL) / (TARGET_CAPITAL - INITIAL_CAPITAL)) * 50;
                  return `${x},${Math.min(58, Math.max(2, y))}`;
                }).join(' ')}
              />
            )}

            {/* Current position dot */}
            <circle
              cx={(today / TARGET_DAYS) * 300}
              cy={Math.min(58, Math.max(2, 55 - ((actualCapital - INITIAL_CAPITAL) / (TARGET_CAPITAL - INITIAL_CAPITAL)) * 50))}
              r="3"
              fill={onTrack ? '#22c55e' : '#ef4444'}
            />

            {/* Labels */}
            <text x="2" y="58" fill="rgba(255,255,255,0.2)" fontSize="6">$5K</text>
            <text x="2" y="8" fill="rgba(255,255,255,0.2)" fontSize="6">$15K</text>
            <text x="280" y="58" fill="rgba(255,255,255,0.2)" fontSize="6">30d</text>
          </svg>
        </div>
      </CardBody>
    </Card>
  );
}

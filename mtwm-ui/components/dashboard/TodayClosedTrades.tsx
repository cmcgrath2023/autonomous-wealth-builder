'use client';

/**
 * Today's Closed Trades
 *
 * Renders the round-trip trades that Alpaca's position view HIDES.
 * Added 2026-04-10 after the AFJKU incident where the dashboard showed
 * "all positions green" but daily P&L was -$7,041 — the loss was in six
 * already-closed trades that had vanished from the position view.
 *
 * Data source: /api/portfolio → todayClosedTrades + todayRealizedPnl
 * (backed by the SQLite closed_trades table, which is now populated by
 * every sell path + the Alpaca activities reconciler).
 */

import { usePortfolioStore } from '@/stores/portfolio';
import { formatCurrency } from '@/lib/utils/formatters';

export function TodayClosedTrades() {
  const { todayClosedTrades, todayRealizedPnl, todayTradeCount, todayWins, todayLosses } = usePortfolioStore();

  if (todayTradeCount === 0) {
    return (
      <div className="bg-white/5 rounded-2xl border border-white/5 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white/60">Today&apos;s Closed Trades</h3>
          <span className="text-xs text-white/30">from closed_trades + Alpaca activities</span>
        </div>
        <div className="text-xs text-white/40 py-4 text-center">
          No round-trip trades today yet.
        </div>
      </div>
    );
  }

  const negative = todayRealizedPnl < 0;
  const worst = todayClosedTrades[0]; // sorted worst→best by API

  return (
    <div className="bg-white/5 rounded-2xl border border-white/5 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white/60">Today&apos;s Closed Trades</h3>
          <p className="text-xs text-white/30 mt-0.5">
            Round-trip trades hidden from the position view
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-mono font-semibold ${negative ? 'text-red-400' : 'text-green-400'}`}>
            {todayRealizedPnl >= 0 ? '+' : ''}{formatCurrency(todayRealizedPnl)}
          </div>
          <div className="text-xs text-white/40 mt-0.5">
            {todayTradeCount} trades · {todayWins}W / {todayLosses}L
          </div>
        </div>
      </div>

      {negative && worst && worst.pnl < -500 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
          <div className="text-xs text-red-300">
            <span className="font-semibold">{worst.ticker}</span> is {Math.round((worst.pnl / todayRealizedPnl) * 100)}% of today&apos;s loss
            {worst.entryPrice && worst.exitPrice && (
              <span className="text-red-400/70">
                {' '}· {worst.qty} @ {formatCurrency(worst.entryPrice)} → {formatCurrency(worst.exitPrice)}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1">
        {todayClosedTrades.slice(0, 10).map((t, i) => {
          const isNeg = t.pnl < 0;
          const pnlTxt = `${t.pnl >= 0 ? '+' : ''}${formatCurrency(t.pnl)}`;
          return (
            <div
              key={`${t.ticker}-${t.closedAt}-${i}`}
              className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-white/5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full ${isNeg ? 'bg-red-400' : 'bg-green-400'}`} />
                <span className="font-mono font-semibold text-white/90 w-16">{t.ticker}</span>
                {t.qty && t.entryPrice && t.exitPrice ? (
                  <span className="text-white/40 truncate">
                    {t.qty} @ {formatCurrency(t.entryPrice)} → {formatCurrency(t.exitPrice)}
                  </span>
                ) : (
                  <span className="text-white/30 truncate">{t.reason}</span>
                )}
              </div>
              <span className={`font-mono font-semibold ${isNeg ? 'text-red-400' : 'text-green-400'}`}>
                {pnlTxt}
              </span>
            </div>
          );
        })}
        {todayClosedTrades.length > 10 && (
          <div className="text-xs text-white/30 text-center pt-2">
            + {todayClosedTrades.length - 10} more
          </div>
        )}
      </div>
    </div>
  );
}

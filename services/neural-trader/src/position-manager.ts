import { Position } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { TradeExecutor } from './executor.js';

export interface PositionRules {
  stopLossPct: number;     // e.g. 0.05 = 5%
  takeProfitPct: number;   // e.g. 0.05 = 5%
  trailingStopPct: number; // e.g. 0.03 = 3% trailing from peak
  maxDailyLossPct: number; // e.g. 0.03 = 3% of portfolio
}

export interface ClosedTrade {
  ticker: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  returnPct: number;
  pnl: number;
  holdTimeMs: number;
  exitReason: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'signal' | 'circuit_breaker';
  closedAt: string;
}

const DEFAULT_RULES: PositionRules = {
  stopLossPct: 0.03,        // 3% stop — cut losers fast
  takeProfitPct: 0.04,       // 4% take profit — lock in gains
  trailingStopPct: 0.02,     // 2% trailing — protect profits aggressively
  maxDailyLossPct: 0.03,     // 3% max daily loss = $150 on $5K
};

export class PositionManager {
  private rules: PositionRules;
  private closedTrades: ClosedTrade[] = [];
  private peakPrices: Map<string, number> = new Map();
  private entryTimes: Map<string, number> = new Map();
  private dailyPnl = 0;
  private dailyPnlResetDate = new Date().toDateString();
  private circuitBreakerTripped = false;

  constructor(rules?: Partial<PositionRules>) {
    this.rules = { ...DEFAULT_RULES, ...rules };
  }

  async checkPositions(executor: TradeExecutor): Promise<string[]> {
    const positions = await executor.getPositions();
    const account = await executor.getAccount();
    const actions: string[] = [];

    // Reset daily P&L tracking
    const today = new Date().toDateString();
    if (today !== this.dailyPnlResetDate) {
      this.dailyPnl = 0;
      this.dailyPnlResetDate = today;
      this.circuitBreakerTripped = false;
    }

    // Check circuit breaker
    if (this.circuitBreakerTripped) {
      actions.push('Circuit breaker active — no new trades until tomorrow');
      return actions;
    }

    // SPEC-005: Use simulated $5K capital for circuit breaker, not full paper account
    const simulatedCapital = 5000;
    const maxDailyLoss = simulatedCapital * this.rules.maxDailyLossPct; // $150 on $5K

    for (const pos of positions) {
      const pnlPct = pos.unrealizedPnlPercent / 100;
      const ticker = pos.ticker;

      // Track entry time
      if (!this.entryTimes.has(ticker)) {
        this.entryTimes.set(ticker, Date.now());
      }

      // Update peak price for trailing stop
      const currentPeak = this.peakPrices.get(ticker) || pos.avgPrice;
      if (pos.currentPrice > currentPeak) {
        this.peakPrices.set(ticker, pos.currentPrice);
      }
      const peak = this.peakPrices.get(ticker) || pos.currentPrice;

      // Check stop-loss
      if (pnlPct <= -this.rules.stopLossPct) {
        const result = await this.closePosition(executor, pos, 'stop_loss');
        if (result) actions.push(result);
        continue;
      }

      // Check take-profit
      if (pnlPct >= this.rules.takeProfitPct) {
        const result = await this.closePosition(executor, pos, 'take_profit');
        if (result) actions.push(result);
        continue;
      }

      // Check trailing stop (only if we've been profitable)
      if (peak > pos.avgPrice) {
        const dropFromPeak = (peak - pos.currentPrice) / peak;
        if (dropFromPeak >= this.rules.trailingStopPct) {
          const result = await this.closePosition(executor, pos, 'trailing_stop');
          if (result) actions.push(result);
          continue;
        }
      }
    }

    // Check daily loss circuit breaker
    if (this.dailyPnl < -maxDailyLoss) {
      this.circuitBreakerTripped = true;
      actions.push(`CIRCUIT BREAKER: daily loss $${Math.abs(this.dailyPnl).toFixed(2)} exceeds ${(this.rules.maxDailyLossPct * 100)}% limit`);
      eventBus.emit('risk:alert', {
        metric: 'daily_loss',
        value: this.dailyPnl,
        threshold: -maxDailyLoss,
      });
    }

    return actions;
  }

  private async closePosition(executor: TradeExecutor, pos: Position, reason: ClosedTrade['exitReason']): Promise<string | null> {
    // Create a sell signal to close
    const signal = {
      id: `close-${Date.now()}`,
      ticker: pos.ticker.includes('USD') ? pos.ticker.replace('USD', '-USD') : pos.ticker,
      direction: 'sell' as const,
      confidence: 1,
      timeframe: '1h' as const,
      indicators: {},
      pattern: reason,
      timestamp: new Date(),
      source: 'neural_trader' as const,
    };

    const order = await executor.execute(signal, pos.shares, pos.marketValue);

    if (order.status === 'filled' || order.status === 'pending') {
      const entryTime = this.entryTimes.get(pos.ticker) || Date.now();
      const trade: ClosedTrade = {
        ticker: pos.ticker,
        entryPrice: pos.avgPrice,
        exitPrice: pos.currentPrice,
        shares: pos.shares,
        returnPct: pos.unrealizedPnlPercent / 100,
        pnl: pos.unrealizedPnl,
        holdTimeMs: Date.now() - entryTime,
        exitReason: reason,
        closedAt: new Date().toISOString(),
      };

      this.closedTrades.push(trade);
      this.dailyPnl += trade.pnl;
      this.peakPrices.delete(pos.ticker);
      this.entryTimes.delete(pos.ticker);

      // Emit for trait engine learning
      eventBus.emit('trade:closed', {
        ticker: trade.ticker,
        returnPct: trade.returnPct,
        pnl: trade.pnl,
        reason: trade.exitReason,
        success: trade.pnl > 0,
      });

      const emoji = trade.pnl > 0 ? 'WIN' : 'LOSS';
      return `${emoji} ${reason.toUpperCase()} ${pos.ticker}: ${(trade.returnPct * 100).toFixed(2)}% ($${trade.pnl.toFixed(2)})`;
    }

    return null;
  }

  getClosedTrades(limit = 50): ClosedTrade[] {
    return this.closedTrades.slice(-limit);
  }

  getPerformanceStats() {
    if (this.closedTrades.length === 0) {
      return { totalTrades: 0, winRate: 0, avgReturn: 0, avgWin: 0, avgLoss: 0, totalPnl: 0, profitFactor: 0 };
    }

    const wins = this.closedTrades.filter(t => t.pnl > 0);
    const losses = this.closedTrades.filter(t => t.pnl <= 0);
    const totalPnl = this.closedTrades.reduce((s, t) => s + t.pnl, 0);
    const avgReturn = this.closedTrades.reduce((s, t) => s + t.returnPct, 0) / this.closedTrades.length;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    return {
      totalTrades: this.closedTrades.length,
      winRate: wins.length / this.closedTrades.length,
      avgReturn,
      avgWin,
      avgLoss,
      totalPnl,
      profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
      dailyPnl: this.dailyPnl,
      circuitBreakerTripped: this.circuitBreakerTripped,
    };
  }

  getRules(): PositionRules {
    return { ...this.rules };
  }

  updateRules(partial: Partial<PositionRules>) {
    Object.assign(this.rules, partial);
  }

  isCircuitBreakerTripped(): boolean {
    // Auto-reset if daily P&L date is stale (new day)
    const today = new Date().toDateString();
    if (today !== this.dailyPnlResetDate) {
      this.dailyPnl = 0;
      this.dailyPnlResetDate = today;
      this.circuitBreakerTripped = false;
    }
    return this.circuitBreakerTripped;
  }

  resetCircuitBreaker() {
    this.circuitBreakerTripped = false;
    this.dailyPnl = 0;
  }

  // Star Concentration: identify top performer and cut dogs
  async starConcentration(executor: TradeExecutor): Promise<string[]> {
    const positions = await executor.getPositions();
    if (positions.length < 2) return [];

    const actions: string[] = [];
    const sorted = [...positions].sort((a, b) => b.unrealizedPnl - a.unrealizedPnl);
    const star = sorted[0];

    // Only concentrate if the star is actually winning meaningfully
    if (star.unrealizedPnl < 10) return [];

    // Cut all positions that are losing while star is winning
    for (const pos of sorted.slice(1)) {
      if (pos.unrealizedPnl < -5) { // Losing more than $5
        const result = await this.closePosition(executor, pos, 'stop_loss');
        if (result) actions.push(`CUT DOG: ${result} → freeing capital for star ${star.ticker}`);
      }
    }

    if (actions.length > 0) {
      actions.unshift(`STAR: ${star.ticker} P&L=$${star.unrealizedPnl.toFixed(2)} — concentrating capital`);
    }

    return actions;
  }
}

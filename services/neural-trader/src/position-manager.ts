import { Position } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { TradeExecutor } from './executor.js';

export interface PositionRules {
  stopLossPct: number;     // e.g. 0.05 = 5%
  takeProfitPct: number;   // e.g. 0.05 = 5%
  trailingStopPct: number; // e.g. 0.03 = 3% trailing from peak
  maxDailyLossPct: number; // e.g. 0.03 = 3% of portfolio
}

export interface DailyGoalConfig {
  targetDailyPnl: number;   // $500 default
  maxDailyPnl: number;      // $1000 — ease off above this
}

export interface ClosedTrade {
  ticker: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  returnPct: number;
  pnl: number;
  holdTimeMs: number;
  exitReason: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'signal' | 'circuit_breaker' | 'daily_goal_bank';
  closedAt: string;
}

const DEFAULT_RULES: PositionRules = {
  stopLossPct: 0.10,        // 10% stop — wide, room to breathe
  takeProfitPct: 0.20,       // 20% take profit — let winners run
  trailingStopPct: 0.10,     // unused — kept for interface compat
  maxDailyLossPct: 0.05,     // 5% max daily loss
};

const DEFAULT_GOAL: DailyGoalConfig = {
  targetDailyPnl: 500,
  maxDailyPnl: 1000,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(Math.max(t, 0), 1);
}

export class PositionManager {
  private rules: PositionRules;
  private goalConfig: DailyGoalConfig;
  private closedTrades: ClosedTrade[] = [];
  private peakPrices: Map<string, number> = new Map();
  private entryTimes: Map<string, number> = new Map();
  private dailyPnl = 0;
  private dailyPnlResetDate = new Date().toDateString();
  private circuitBreakerTripped = false;
  private _pressure = 0;

  constructor(rules?: Partial<PositionRules>, goalConfig?: Partial<DailyGoalConfig>) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.goalConfig = { ...DEFAULT_GOAL, ...goalConfig };
  }

  // ── Pressure: 0 = goal met, 1 = max urgency ──
  private calculatePressure(): number {
    const { targetDailyPnl, maxDailyPnl } = this.goalConfig;

    // Goal exceeded — let positions run
    if (this.dailyPnl >= maxDailyPnl) return 0;
    // Goal met — mild pressure, still bank but not aggressively
    if (this.dailyPnl >= targetDailyPnl) return 0.15;

    // How far from goal (always positive when below target)
    const deficit = targetDailyPnl - this.dailyPnl;
    const deficitRatio = deficit / targetDailyPnl; // 1.0 = no progress, >1 if negative day

    // Time pressure: ramps from 0 to 1 over the day
    // Crypto is 24/7 so we use hours since midnight UTC
    const hourUTC = new Date().getUTCHours();
    const timePressure = Math.min(hourUTC / 20, 1); // Full pressure by 20:00 UTC

    // Combined: deficit × time, clamped 0-1
    this._pressure = Math.min(Math.max(deficitRatio * Math.max(timePressure, 0.3), 0), 1);
    return this._pressure;
  }

  getDailyGoalPressure(): number {
    return this._pressure;
  }

  getDailyGoalStatus() {
    const pressure = this.calculatePressure();
    const { targetDailyPnl, maxDailyPnl } = this.goalConfig;
    return {
      target: targetDailyPnl,
      max: maxDailyPnl,
      realized: this.dailyPnl,
      pressure,
      thresholds: this.getPressureThresholds(pressure),
    };
  }

  private getPressureThresholds(pressure: number) {
    const sl = this.rules.stopLossPct; // 8%
    // RULE: TP must ALWAYS exceed SL. Minimum R/R = 1.5:1
    // At low pressure: TP = 15% (1.875:1 R/R). At max: TP = 12% (1.5:1 R/R). Never below SL.
    const minTP = sl * 1.5; // 4.5% — floor for take profit (1.5:1 R/R on 3% SL)
    return {
      cryptoTrailActivation: lerp(0.03, 0.02, pressure),
      cryptoTrailLow: lerp(0.015, 0.01, pressure),
      cryptoTrailHigh: lerp(0.01, 0.008, pressure),
      cryptoHighGainThreshold: lerp(0.06, 0.04, pressure),
      cryptoHardCap: Math.max(lerp(0.10, 0.06, pressure), minTP), // Never below 12%
      equityTakeProfit: Math.max(lerp(0.15, 0.10, pressure), minTP), // 10-15%, floor 12%
      microBankMin: pressure > 0.9 ? 50 : Infinity, // Only at extreme pressure, min $50 (not $10 or $30)
    };
  }

  updateDailyGoal(partial: Partial<DailyGoalConfig>) {
    Object.assign(this.goalConfig, partial);
  }

  async checkPositions(executor: TradeExecutor): Promise<string[]> {
    const positions = await executor.getPositions();
    const actions: string[] = [];

    // Reset daily P&L tracking
    const today = new Date().toDateString();
    if (today !== this.dailyPnlResetDate) {
      this.dailyPnl = 0;
      this.dailyPnlResetDate = today;
      this.circuitBreakerTripped = false;
    }

    // Circuit breaker active — no exits, no new trades
    if (this.circuitBreakerTripped) {
      actions.push('Circuit breaker active — no new trades until tomorrow');
      return actions;
    }

    // ── EXIT LOGIC — Crypto vs Equity vs Resilient thresholds ──
    // Crypto: -5% SL / +10% TP (volatile, cut faster, bank sooner)
    // Equity: -7% SL / +15% TP (room for intraday swings, let day-trend run)
    // Resilient: -10% SL / +20% TP (proven sectors, hold through volatility)
    const maxDailyLoss = 1000;

    // Resilient sectors — wider thresholds, hold through dips
    const resilientTickers = new Set([
      'LMT','RTX','NOC','GD','BA','KTOS','HII','LHX',
      'UNH','JNJ','PFE','ABBV','MRK','LLY','CVS','HUM','CI','ELV','CNC','MOH',
      'NEE','DUK','SO','D','AEP','XEL','ED',
      'PG','KO','PEP','WMT','COST','CL','GIS','K',
      'CAT','DE','URI','VMC','MLM','PWR',
      'GLD','SLV','GDX','NEM','GOLD','AEM',
    ]);

    for (const pos of positions) {
      const pnlPct = pos.unrealizedPnlPercent / 100;
      const ticker = pos.ticker;
      const tickerIsCrypto = ticker.includes('USD') && ticker.length > 5;
      const tickerIsResilient = resilientTickers.has(ticker);
      const sl = tickerIsCrypto ? 0.05 : tickerIsResilient ? 0.10 : 0.07;
      const tp = tickerIsCrypto ? 0.10 : tickerIsResilient ? 0.20 : 0.15;

      // Track entry time
      if (!this.entryTimes.has(ticker)) {
        this.entryTimes.set(ticker, Date.now());
      }

      // STOP LOSS
      if (pnlPct <= -sl) {
        console.log(`[EXIT] ${ticker} ${(pnlPct*100).toFixed(1)}% — stop loss at -${(sl*100).toFixed(0)}% (${tickerIsCrypto ? 'crypto' : 'equity'})`);
        const result = await this.closePosition(executor, pos, 'stop_loss');
        if (result) actions.push(result);
        continue;
      }

      // TAKE PROFIT
      if (pnlPct >= tp) {
        console.log(`[EXIT] ${ticker} +${(pnlPct*100).toFixed(1)}% — take profit at +${(tp*100).toFixed(0)}% (${tickerIsCrypto ? 'crypto' : 'equity'})`);
        const result = await this.closePosition(executor, pos, 'take_profit');
        if (result) actions.push(result);
        continue;
      }

      // HOLD — log status only
      const status = pnlPct >= 0 ? `+${(pnlPct*100).toFixed(1)}%` : `${(pnlPct*100).toFixed(1)}%`;
      const tierLabel = tickerIsCrypto ? 'crypto' : tickerIsResilient ? 'RESILIENT' : 'equity';
      console.log(`[HOLD] ${ticker} ${status} ($${pos.unrealizedPnl.toFixed(2)}) [${tierLabel} SL:-${(sl*100).toFixed(0)}%/TP:+${(tp*100).toFixed(0)}%]`);
    }

    // Circuit breaker: $500 daily loss limit
    if (this.dailyPnl < -maxDailyLoss) {
      this.circuitBreakerTripped = true;
      actions.push(`CIRCUIT BREAKER: daily loss $${Math.abs(this.dailyPnl).toFixed(2)} exceeds $${maxDailyLoss} limit`);
      eventBus.emit('risk:alert', {
        metric: 'daily_loss',
        value: this.dailyPnl,
        threshold: -maxDailyLoss,
      });
    }

    return actions;
  }

  private async closePosition(executor: TradeExecutor, pos: Position, reason: ClosedTrade['exitReason']): Promise<string | null> {
    // PDT guard disabled — account equity > $25K, day trading unrestricted

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
      dailyGoal: this.getDailyGoalStatus(),
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

  // Star Concentration: DISABLED — 3% SL handles losers. This was cutting positions
  // at -$25 which is under the 3% SL threshold and killed manual buys prematurely.
  async starConcentration(_executor: TradeExecutor): Promise<string[]> {
    return [];
  }
}

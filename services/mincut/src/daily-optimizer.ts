/**
 * Daily Optimizer — Tactical daily trading strategy engine
 *
 * While the StrategicPlanner answers "HOW do we turn $4K into $25K?",
 * this module answers "What should we do TODAY to make $500?"
 *
 * It produces concrete, session-aware, risk-budgeted allocations
 * and action lists based on current market conditions, existing
 * positions, and Bayesian intelligence signals.
 */

import { MinCut } from './index.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DailyState {
  budget: number;
  dailyGoal: number;
  currentDayPnl: number;
  positions: Array<{
    ticker: string;
    value: number;
    pnl: number;
    pnlPct: number;
    isCrypto: boolean;
  }>;
  forexPositions: Array<{
    instrument: string;
    pnl: number;
    direction: string;
  }>;
  bayesianPrefer: string[];
  bayesianAvoid: string[];
  slDominance: number;
  marketCondition: 'bullish' | 'bearish' | 'mixed';
  activeSessions: string[];
  cryptoMarketBias: 'bullish' | 'bearish' | 'mixed';
}

export interface DailyStrategy {
  timestamp: string;
  remainingGoal: number;
  approach: 'aggressive' | 'steady' | 'defensive' | 'recovery';
  allocations: {
    crypto: { pct: number; rationale: string; preferTickers: string[] };
    forex: { pct: number; rationale: string; preferPairs: string[] };
    equity: { pct: number; rationale: string };
    hedge: { pct: number; rationale: string };
  };
  actions: string[];
  riskBudget: number;
  maxNewPositions: number;
  takeProfitTarget: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Session-to-pair mapping
// ---------------------------------------------------------------------------

const SESSION_FOREX_PAIRS: Record<string, string[]> = {
  TOKYO: ['USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY'],
  LONDON: ['EUR_USD', 'GBP_USD', 'EUR_GBP', 'EUR_CHF'],
  NEW_YORK: ['EUR_USD', 'GBP_USD', 'USD_CAD', 'USD_JPY', 'USD_CHF'],
  SYDNEY: ['AUD_USD', 'NZD_USD', 'AUD_NZD', 'AUD_JPY'],
};

// ---------------------------------------------------------------------------
// Helper: market condition from movers
// ---------------------------------------------------------------------------

export function getMarketCondition(
  movers: Array<{ pct: number }>,
): 'bullish' | 'bearish' | 'mixed' {
  if (movers.length === 0) return 'mixed';
  const positive = movers.filter((m) => m.pct > 0).length;
  const ratio = positive / movers.length;
  if (ratio > 0.6) return 'bullish';
  if (ratio < 0.4) return 'bearish';
  return 'mixed';
}

// ---------------------------------------------------------------------------
// DailyOptimizer
// ---------------------------------------------------------------------------

export class DailyOptimizer {
  private mincut: MinCut;

  constructor(mincut?: MinCut) {
    this.mincut = mincut ?? new MinCut({ kellyFraction: 0.5, maxPositionWeight: 0.15 });
  }

  /**
   * Produce a concrete daily strategy given current state.
   */
  optimize(state: DailyState): DailyStrategy {
    const remaining = state.dailyGoal - state.currentDayPnl;
    const progressRatio = state.currentDayPnl / state.dailyGoal;
    const approach = this.determineApproach(progressRatio, remaining, state);
    const riskBudget = this.calculateRiskBudget(state);
    const allocations = this.buildAllocations(state, approach);
    const maxNewPositions = this.calculateMaxNewPositions(state, approach);
    const takeProfitTarget = this.calculateTakeProfitTarget(state, remaining);
    const actions = this.buildActions(state, approach, allocations, remaining, takeProfitTarget);
    const narrative = this.buildNarrative(state, approach, remaining, allocations, riskBudget);

    return {
      timestamp: new Date().toISOString(),
      remainingGoal: Math.round(remaining * 100) / 100,
      approach,
      allocations,
      actions,
      riskBudget,
      maxNewPositions,
      takeProfitTarget,
      narrative,
    };
  }

  // -------------------------------------------------------------------------
  // Approach selection
  // -------------------------------------------------------------------------

  private determineApproach(
    progressRatio: number,
    remaining: number,
    state: DailyState,
  ): DailyStrategy['approach'] {
    // Already at or past goal
    if (progressRatio >= 1.0) return 'defensive';

    // Losing money today — need to recover
    if (state.currentDayPnl < 0) return 'recovery';

    // More than 70% of goal still remaining and past early morning
    if (progressRatio < 0.3) return 'aggressive';

    // Steady progress — keep doing what works
    return 'steady';
  }

  // -------------------------------------------------------------------------
  // Risk budget: max we can lose before halting (20% of daily goal)
  // -------------------------------------------------------------------------

  private calculateRiskBudget(state: DailyState): number {
    const maxDrawdown = state.dailyGoal * 0.2;
    // If already losing, reduce further
    if (state.currentDayPnl < 0) {
      const alreadyLost = Math.abs(state.currentDayPnl);
      return Math.max(0, Math.round((maxDrawdown - alreadyLost) * 100) / 100);
    }
    return Math.round(maxDrawdown * 100) / 100;
  }

  // -------------------------------------------------------------------------
  // Allocation builder
  // -------------------------------------------------------------------------

  private buildAllocations(
    state: DailyState,
    approach: DailyStrategy['approach'],
  ): DailyStrategy['allocations'] {
    const preferPairs = this.getSessionPairs(state.activeSessions);
    const preferCrypto = this.filterPreferred(
      state.bayesianPrefer,
      state.bayesianAvoid,
      true,
    );
    const preferEquityTickers = this.filterPreferred(
      state.bayesianPrefer,
      state.bayesianAvoid,
      false,
    );

    // Base allocation percentages
    let crypto = 40;
    let forex = 25;
    let equity = 25;
    let hedge = 10;

    // Adjust for crypto market bias
    if (state.cryptoMarketBias === 'bullish') {
      crypto += 15;
      equity -= 10;
      hedge -= 5;
    } else if (state.cryptoMarketBias === 'bearish') {
      crypto -= 20;
      forex += 10;
      hedge += 10;
    }

    // Adjust for overall market condition
    if (state.marketCondition === 'bearish') {
      equity -= 10;
      hedge += 10;
    } else if (state.marketCondition === 'bullish') {
      equity += 5;
      hedge -= 5;
    }

    // Adjust for approach
    if (approach === 'defensive') {
      hedge += 15;
      crypto -= 10;
      equity -= 5;
    } else if (approach === 'recovery') {
      // Conservative — focus on what is working, add hedges
      hedge += 10;
      crypto -= 5;
      equity -= 5;
    } else if (approach === 'aggressive') {
      crypto += 5;
      hedge -= 5;
    }

    // High SL dominance: reduce new exposure, boost hedges
    if (state.slDominance > 0.7) {
      crypto -= 10;
      equity -= 5;
      hedge += 10;
      forex += 5;
    }

    // Clamp and normalize
    crypto = Math.max(0, crypto);
    forex = Math.max(0, forex);
    equity = Math.max(0, equity);
    hedge = Math.max(0, hedge);
    const total = crypto + forex + equity + hedge;
    crypto = Math.round((crypto / total) * 100);
    forex = Math.round((forex / total) * 100);
    equity = Math.round((equity / total) * 100);
    hedge = 100 - crypto - forex - equity; // Absorb rounding remainder

    return {
      crypto: {
        pct: crypto,
        rationale: this.cryptoRationale(state),
        preferTickers: preferCrypto,
      },
      forex: {
        pct: forex,
        rationale: this.forexRationale(state),
        preferPairs: preferPairs,
      },
      equity: {
        pct: equity,
        rationale: this.equityRationale(state),
      },
      hedge: {
        pct: hedge,
        rationale: this.hedgeRationale(state, approach),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Max new positions
  // -------------------------------------------------------------------------

  private calculateMaxNewPositions(
    state: DailyState,
    approach: DailyStrategy['approach'],
  ): number {
    const existingCount = state.positions.length + state.forexPositions.length;

    if (approach === 'defensive') return 0;
    if (state.slDominance > 0.7) return Math.max(0, 2 - existingCount);

    const baseMax = approach === 'aggressive' ? 5 : approach === 'steady' ? 3 : 2;
    return Math.max(0, baseMax - existingCount);
  }

  // -------------------------------------------------------------------------
  // Take-profit target per position
  // -------------------------------------------------------------------------

  private calculateTakeProfitTarget(state: DailyState, remaining: number): number {
    const totalPositions = state.positions.length + state.forexPositions.length;
    if (totalPositions === 0) {
      // No positions yet — aim for remaining split across expected entries
      return Math.round(Math.max(25, remaining / 3) * 100) / 100;
    }
    // Distribute remaining goal across existing positions
    const perPosition = remaining / totalPositions;
    // Floor at $25, cap at $100 per position
    return Math.round(Math.max(25, Math.min(100, perPosition)) * 100) / 100;
  }

  // -------------------------------------------------------------------------
  // Action list builder
  // -------------------------------------------------------------------------

  private buildActions(
    state: DailyState,
    approach: DailyStrategy['approach'],
    allocations: DailyStrategy['allocations'],
    remaining: number,
    tpTarget: number,
  ): string[] {
    const actions: string[] = [];

    // Defensive: protect what we have
    if (approach === 'defensive') {
      actions.push('Tighten trailing stops on all positions to lock in gains');
      for (const pos of state.positions.filter((p) => p.pnl > 0)) {
        actions.push(`Protect ${pos.ticker} gains ($${pos.pnl.toFixed(0)}) — move stop to breakeven or above`);
      }
      for (const fp of state.forexPositions.filter((p) => p.pnl > 0)) {
        actions.push(`Hold ${fp.instrument} ${fp.direction} — trail stop, bank at TP`);
      }
      actions.push('No new entries — daily goal reached, protect capital');
      return actions;
    }

    // Existing position management
    for (const pos of state.positions) {
      if (pos.pnl >= tpTarget) {
        actions.push(`Take profit on ${pos.ticker} — up $${pos.pnl.toFixed(0)} (${pos.pnlPct.toFixed(1)}%), exceeds TP target`);
      } else if (pos.pnl > 0) {
        actions.push(`Hold ${pos.ticker} toward $${tpTarget} TP — currently $${pos.pnl.toFixed(0)}`);
      } else if (pos.pnlPct < -5) {
        actions.push(`Review ${pos.ticker} — down ${pos.pnlPct.toFixed(1)}%, consider cutting if thesis broken`);
      } else {
        actions.push(`Monitor ${pos.ticker} — small drawdown ($${pos.pnl.toFixed(0)}), hold if setup intact`);
      }
    }

    for (const fp of state.forexPositions) {
      if (fp.pnl > tpTarget) {
        actions.push(`Bank ${fp.instrument} ${fp.direction} profit ($${fp.pnl.toFixed(0)})`);
      } else if (fp.pnl > 0) {
        actions.push(`Hold ${fp.instrument} ${fp.direction} toward TP — currently $${fp.pnl.toFixed(0)}`);
      } else {
        actions.push(`Monitor ${fp.instrument} ${fp.direction} — P&L $${fp.pnl.toFixed(0)}`);
      }
    }

    // New entry suggestions based on allocations
    if (approach === 'recovery') {
      actions.push('Focus on highest-conviction setups only — no speculative entries');
      if (state.slDominance > 0.7) {
        actions.push('SL dominance high (>70%) — reduce position sizes, widen stops or skip marginal setups');
      }
    }

    if (allocations.crypto.pct > 0 && allocations.crypto.preferTickers.length > 0) {
      const tickers = allocations.crypto.preferTickers.slice(0, 3).join(', ');
      actions.push(`Scan crypto entries: ${tickers} — enter if score > 0.7 and momentum confirms`);
    }

    if (allocations.forex.pct > 0 && allocations.forex.preferPairs.length > 0) {
      const pairs = allocations.forex.preferPairs.slice(0, 3).join(', ');
      actions.push(`Scan forex entries: ${pairs} — session-aligned, enter on confirmed setup`);
    }

    if (approach === 'aggressive') {
      actions.push(`Remaining goal: $${remaining.toFixed(0)} — be opportunistic but respect risk budget`);
    }

    return actions;
  }

  // -------------------------------------------------------------------------
  // Narrative builder (for audio dashboard)
  // -------------------------------------------------------------------------

  private buildNarrative(
    state: DailyState,
    approach: DailyStrategy['approach'],
    remaining: number,
    allocations: DailyStrategy['allocations'],
    riskBudget: number,
  ): string {
    const parts: string[] = [];

    // Opening
    if (state.currentDayPnl >= state.dailyGoal) {
      parts.push(
        `Daily goal of $${state.dailyGoal} is met with $${state.currentDayPnl.toFixed(0)} in profit. ` +
        `Switching to defensive mode to protect gains.`,
      );
    } else if (state.currentDayPnl > 0) {
      parts.push(
        `We have made $${state.currentDayPnl.toFixed(0)} today, ` +
        `$${remaining.toFixed(0)} remaining toward the $${state.dailyGoal} daily target.`,
      );
    } else if (state.currentDayPnl < 0) {
      parts.push(
        `Down $${Math.abs(state.currentDayPnl).toFixed(0)} today. ` +
        `Need $${remaining.toFixed(0)} to reach the daily goal. ` +
        `Shifting to recovery mode with tighter risk controls.`,
      );
    } else {
      parts.push(
        `Starting fresh today. ` +
        `Target is $${state.dailyGoal} with a $${state.budget.toLocaleString()} budget.`,
      );
    }

    // Market context
    const sessions = state.activeSessions.length > 0
      ? state.activeSessions.join(' and ')
      : 'no major';
    parts.push(
      `Market condition is ${state.marketCondition}, ` +
      `crypto bias is ${state.cryptoMarketBias}, ` +
      `with ${sessions} sessions active.`,
    );

    // Approach
    const approachDescriptions: Record<string, string> = {
      aggressive: 'Taking an aggressive approach to capture the remaining target quickly.',
      steady: 'Maintaining steady execution with balanced risk.',
      defensive: 'Playing defense to lock in gains.',
      recovery: 'In recovery mode. Focusing on high-conviction setups and tighter stops.',
    };
    parts.push(approachDescriptions[approach]);

    // Allocations summary
    parts.push(
      `Allocation: ${allocations.crypto.pct}% crypto, ` +
      `${allocations.forex.pct}% forex, ` +
      `${allocations.equity.pct}% equity, ` +
      `${allocations.hedge.pct}% hedges.`,
    );

    // Risk
    parts.push(
      `Risk budget is $${riskBudget.toFixed(0)}. ` +
      `If we lose more than that, we halt new entries for the day.`,
    );

    // SL dominance warning
    if (state.slDominance > 0.7) {
      parts.push(
        `Stop-loss dominance is high at ${(state.slDominance * 100).toFixed(0)}%. ` +
        `Reducing new entries and focusing on existing positions.`,
      );
    }

    // Position summary
    const totalPositions = state.positions.length + state.forexPositions.length;
    if (totalPositions > 0) {
      const winners = state.positions.filter((p) => p.pnl > 0).length +
        state.forexPositions.filter((p) => p.pnl > 0).length;
      parts.push(
        `Currently holding ${totalPositions} positions, ${winners} in profit.`,
      );
    }

    return parts.join(' ');
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private getSessionPairs(sessions: string[]): string[] {
    const pairs = new Set<string>();
    for (const session of sessions) {
      const sessionPairs = SESSION_FOREX_PAIRS[session];
      if (sessionPairs) {
        for (const pair of sessionPairs) {
          pairs.add(pair);
        }
      }
    }
    // Fallback: if no sessions active, default to majors
    if (pairs.size === 0) {
      return ['EUR_USD', 'GBP_USD', 'USD_JPY'];
    }
    return Array.from(pairs);
  }

  private filterPreferred(
    prefer: string[],
    avoid: string[],
    cryptoOnly: boolean,
  ): string[] {
    const avoidSet = new Set(avoid.map((t) => t.toUpperCase()));
    return prefer
      .filter((t) => !avoidSet.has(t.toUpperCase()))
      .filter((t) => {
        const upper = t.toUpperCase();
        const isCrypto = upper.includes('-USD') || upper.includes('BTC') ||
          upper.includes('ETH') || upper.includes('SOL') ||
          upper.includes('DOGE') || upper.includes('AVAX') ||
          upper.includes('ADA') || upper.includes('XRP');
        return cryptoOnly ? isCrypto : !isCrypto;
      });
  }

  private cryptoRationale(state: DailyState): string {
    if (state.cryptoMarketBias === 'bullish') {
      return 'Crypto bias bullish — 24/7 markets with fast movers, load up on momentum plays';
    }
    if (state.cryptoMarketBias === 'bearish') {
      return 'Crypto bias bearish — reduce exposure, only enter on extreme oversold bounces';
    }
    return 'Crypto mixed — selective entries on high-conviction signals only';
  }

  private forexRationale(state: DailyState): string {
    const sessions = state.activeSessions;
    if (sessions.length === 0) {
      return 'No major forex sessions active — limit to majors with tight spreads';
    }
    return `Active sessions: ${sessions.join(', ')} — favor session-aligned pairs for liquidity`;
  }

  private equityRationale(state: DailyState): string {
    if (state.marketCondition === 'bearish') {
      return 'Bearish equity market — minimal exposure, defensive names only';
    }
    if (state.marketCondition === 'bullish') {
      return 'Bullish equity market — ride momentum in preferred names';
    }
    return 'Mixed equity market — selective entries on strongest setups';
  }

  private hedgeRationale(
    state: DailyState,
    approach: DailyStrategy['approach'],
  ): string {
    if (approach === 'defensive') {
      return 'Defensive mode — increased hedge allocation to protect daily gains';
    }
    if (state.marketCondition === 'bearish' || state.cryptoMarketBias === 'bearish') {
      return 'Bearish conditions — hedges elevated to offset directional risk';
    }
    if (state.slDominance > 0.7) {
      return 'High stop-loss hit rate — hedges protect against continued adverse moves';
    }
    return 'Standard hedge allocation for tail risk protection';
  }
}

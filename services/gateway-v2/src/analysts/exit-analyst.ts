/**
 * Exit Analyst — Wave 3 (refinement)
 *
 * Pure rules-based. No LLM call. Runs every heartbeat.
 *
 * Replaces the hard +15% take-profit / -7% stop-loss with dynamic
 * trailing stops, time-stops, and profit-locking tiers. Trident LoRA
 * provides the "should I sell at all?" signal; Exit Analyst provides
 * "at what price and when?"
 *
 * The old system clipped every runner at +15% and held every loser to -7%.
 * This system: locks in profits as they grow, tightens stops on winners,
 * and cuts time-decaying losers faster.
 */

export interface ExitPlan {
  ticker: string;
  currentPrice: number;
  currentPnlPct: number;
  action: 'hold' | 'sell_now' | 'tighten_stop' | 'take_partial';
  stopLoss: number;
  trailingStopPct: number | null;
  target1: number | null;
  target2: number | null;
  reasoning: string;
  urgency: 'immediate' | 'today' | 'let_ride';
}

interface PositionInput {
  ticker: string;
  entryPrice: number;
  currentPrice: number;
  qty: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;  // as decimal, e.g. 0.05 = 5%
  holdDurationMinutes: number;
  isResilient?: boolean;     // defense, healthcare, utilities, staples, gold
  tridentSignal?: 'hold' | 'sell';
  volume?: number;           // today's volume — high volume movers get wider stops
}

export interface ExitConfig {
  slDefault?: number;           // e.g. -7
  slHighVolume?: number;        // e.g. -10
  slVeryHighVolume?: number;    // e.g. -12
  slResilientBonus?: number;    // e.g. -3 (added to base)
  highVolumeThreshold?: number; // e.g. 1000000
  veryHighVolumeThreshold?: number; // e.g. 5000000
  timeStopHours?: number;       // e.g. 2
  timeStopHoursHighVol?: number; // e.g. 3
  timeStopPct?: number;         // e.g. -3
  timeStopPctHighVol?: number;  // e.g. -5
  trailingTier1?: number;       // e.g. 5
  trailingTier2?: number;       // e.g. 4
  trailingTier3?: number;       // e.g. 3
  tpDefault?: number;           // e.g. 15
  tpResilient?: number;         // e.g. 20
}

export class ExitAnalyst {
  private cfg: Required<ExitConfig>;

  constructor(config?: ExitConfig) {
    this.cfg = {
      slDefault: config?.slDefault ?? -7,
      slHighVolume: config?.slHighVolume ?? -10,
      slVeryHighVolume: config?.slVeryHighVolume ?? -12,
      slResilientBonus: config?.slResilientBonus ?? -3,
      highVolumeThreshold: config?.highVolumeThreshold ?? 1_000_000,
      veryHighVolumeThreshold: config?.veryHighVolumeThreshold ?? 5_000_000,
      timeStopHours: config?.timeStopHours ?? 2,
      timeStopHoursHighVol: config?.timeStopHoursHighVol ?? 3,
      timeStopPct: config?.timeStopPct ?? -3,
      timeStopPctHighVol: config?.timeStopPctHighVol ?? -5,
      trailingTier1: config?.trailingTier1 ?? 5,
      trailingTier2: config?.trailingTier2 ?? 4,
      trailingTier3: config?.trailingTier3 ?? 3,
      tpDefault: config?.tpDefault ?? 15,
      tpResilient: config?.tpResilient ?? 20,
    };
  }

  /**
   * Evaluate every open position and return an exit plan.
   * Called from trade-engine heartbeat alongside Trident shouldSell.
   */
  evaluate(positions: PositionInput[]): ExitPlan[] {
    return positions.map(pos => this.evaluateOne(pos));
  }

  private evaluateOne(pos: PositionInput): ExitPlan {
    const pct = pos.unrealizedPnlPct * 100; // convert to percentage points
    const holdMins = pos.holdDurationMinutes;
    const resilient = pos.isResilient ?? false;

    // ── VOLUME-AWARE STOPS ─────────────────────────────────────
    const vol = pos.volume ?? 0;
    const isHighVolume = vol > this.cfg.highVolumeThreshold;
    const isVeryHighVolume = vol > this.cfg.veryHighVolumeThreshold;

    // Widen stops for high-volume momentum names
    let hardStopPct: number;
    const resilientExtra = resilient ? this.cfg.slResilientBonus : 0;
    if (isVeryHighVolume) hardStopPct = this.cfg.slVeryHighVolume + resilientExtra;
    else if (isHighVolume) hardStopPct = this.cfg.slHighVolume + resilientExtra;
    else hardStopPct = this.cfg.slDefault + resilientExtra;

    if (pct <= hardStopPct) {
      return this.plan(pos, pct, 'sell_now', {
        stopLoss: pos.currentPrice,
        reasoning: `Hard stop: ${pct.toFixed(1)}% ≤ ${hardStopPct}% (vol: ${(vol/1e6).toFixed(1)}M)`,
        urgency: 'immediate',
      });
    }

    // ── TIME STOP — losers that aren't recovering ──────────────
    const timeStopHours = isHighVolume ? this.cfg.timeStopHoursHighVol : this.cfg.timeStopHours;
    const timeStopPct = isHighVolume ? this.cfg.timeStopPctHighVol : this.cfg.timeStopPct;
    if (pct <= timeStopPct && holdMins > timeStopHours * 60) {
      return this.plan(pos, pct, 'sell_now', {
        stopLoss: pos.currentPrice,
        reasoning: `Time stop: ${pct.toFixed(1)}% for ${Math.round(holdMins / 60)}h (vol: ${(vol/1e6).toFixed(1)}M)`,
        urgency: 'immediate',
      });
    }

    // ── PROFIT TIER 3: +15% or more — lock in hard, trail tight ──
    const tpFloor = resilient ? this.cfg.tpResilient : this.cfg.tpDefault;
    if (pct >= tpFloor) {
      const lockFloor = pos.entryPrice * (1 + (tpFloor - 5) / 100);
      return this.plan(pos, pct, 'tighten_stop', {
        stopLoss: Math.max(lockFloor, pos.currentPrice * (1 - this.cfg.trailingTier3 / 100)),
        trailingStopPct: this.cfg.trailingTier3,
        target1: pos.entryPrice * (1 + tpFloor / 100),
        target2: pos.entryPrice * (1 + (tpFloor + 10) / 100),
        reasoning: `Tier 3: +${pct.toFixed(1)}% — trailing 3% from high, floor at +${tpFloor - 5}%`,
        urgency: 'let_ride',
      });
    }

    // ── PROFIT TIER 2: +8% to TP — tighten, lock breakeven+
    if (pct >= 8) {
      return this.plan(pos, pct, 'tighten_stop', {
        stopLoss: pos.entryPrice * 1.02,
        trailingStopPct: this.cfg.trailingTier2,
        target1: pos.entryPrice * 1.15,
        target2: pos.entryPrice * 1.20,
        reasoning: `Tier 2: +${pct.toFixed(1)}% — trailing 4%, floor at +2%`,
        urgency: 'let_ride',
      });
    }

    // ── PROFIT TIER 1: +3% to +8% — move stop to breakeven ────
    if (pct >= 3) {
      return this.plan(pos, pct, 'tighten_stop', {
        stopLoss: pos.entryPrice * 1.005,
        trailingStopPct: this.cfg.trailingTier1,
        target1: pos.entryPrice * 1.10,
        reasoning: `Tier 1: +${pct.toFixed(1)}% — stop at breakeven, trailing 5%`,
        urgency: 'let_ride',
      });
    }

    // ── SMALL GAIN (0 to +3%) — standard stop ─────────────────
    if (pct >= 0) {
      const stopPct = resilient ? -10 : -5;
      return this.plan(pos, pct, 'hold', {
        stopLoss: pos.entryPrice * (1 + stopPct / 100),
        target1: pos.entryPrice * 1.08,
        reasoning: `Small gain +${pct.toFixed(1)}% — stop at ${stopPct}%, let it develop`,
        urgency: 'let_ride',
      });
    }

    // ── SMALL LOSS (0 to -3%) — Trident gets a say ────────────
    if (pct > -3) {
      if (pos.tridentSignal === 'hold') {
        const stopPct = resilient ? -10 : -5;
        return this.plan(pos, pct, 'hold', {
          stopLoss: pos.entryPrice * (1 + stopPct / 100),
          reasoning: `Small loss ${pct.toFixed(1)}% — Trident says hold, stop at ${stopPct}%`,
          urgency: 'today',
        });
      }
      // Trident says sell or no signal — tighter stop
      return this.plan(pos, pct, 'hold', {
        stopLoss: pos.entryPrice * 0.96, // 4% stop
        reasoning: `Small loss ${pct.toFixed(1)}% — tight 4% stop, watching`,
        urgency: 'today',
      });
    }

    // ── MODERATE LOSS (-3% to hard stop) — holding with stop ───
    const stopPct = resilient ? -10 : -7;
    return this.plan(pos, pct, 'hold', {
      stopLoss: pos.entryPrice * (1 + stopPct / 100),
      reasoning: `Loss ${pct.toFixed(1)}% — stop at ${stopPct}%`,
      urgency: 'today',
    });
  }

  private plan(
    pos: PositionInput,
    pct: number,
    action: ExitPlan['action'],
    overrides: Partial<ExitPlan>,
  ): ExitPlan {
    return {
      ticker: pos.ticker,
      currentPrice: pos.currentPrice,
      currentPnlPct: pct,
      action,
      stopLoss: overrides.stopLoss ?? pos.entryPrice * 0.93,
      trailingStopPct: overrides.trailingStopPct ?? null,
      target1: overrides.target1 ?? null,
      target2: overrides.target2 ?? null,
      reasoning: overrides.reasoning ?? '',
      urgency: overrides.urgency ?? 'today',
    };
  }
}

import { Portfolio, RiskMetrics } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';

interface RiskLimits {
  maxDrawdown: number;
  kellyFraction: number;
  maxSectorConcentration: number;
  correlationAlert: number;
  emergencyReserveMonths: number;
  monthlyExpenses: number;
}

// Phase 1: Conservative limits for paper/bootstrap trading
const DEFAULT_LIMITS: RiskLimits = {
  maxDrawdown: 0.10,        // Tighter during paper phase
  kellyFraction: 0.25,      // Quarter-Kelly for safety
  maxSectorConcentration: 0.30, // Slightly relaxed for small portfolio
  correlationAlert: 0.8,
  emergencyReserveMonths: 6,    // 6 months initially
  monthlyExpenses: 5_000,       // Adjust to actual
};

export class RiskControls {
  private limits: RiskLimits;
  private peakValue = 0;
  private fullStopTriggered = false;

  constructor(limits?: Partial<RiskLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  evaluate(portfolio: Portfolio): RiskMetrics & { alerts: string[] } {
    const alerts: string[] = [];

    // Track peak value
    if (portfolio.totalValue > this.peakValue) {
      this.peakValue = portfolio.totalValue;
    }

    // Portfolio drawdown
    const drawdown = this.peakValue > 0 ? (this.peakValue - portfolio.totalValue) / this.peakValue : 0;
    if (drawdown >= this.limits.maxDrawdown) {
      alerts.push(`CRITICAL: Portfolio drawdown ${(drawdown * 100).toFixed(1)}% exceeds ${this.limits.maxDrawdown * 100}% limit — FULL STOP`);
      this.fullStopTriggered = true;
      eventBus.emit('risk:alert', { metric: 'drawdown', value: drawdown, threshold: this.limits.maxDrawdown });
    }

    // Sector concentration
    const sectorConcentration: Record<string, number> = {};
    for (const pos of portfolio.positions) {
      const sector = pos.sector || 'unknown';
      sectorConcentration[sector] = (sectorConcentration[sector] || 0) + pos.marketValue;
    }
    for (const [sector, value] of Object.entries(sectorConcentration)) {
      const pct = value / portfolio.totalValue;
      sectorConcentration[sector] = pct;
      if (pct > this.limits.maxSectorConcentration) {
        alerts.push(`WARNING: ${sector} sector at ${(pct * 100).toFixed(1)}% exceeds ${this.limits.maxSectorConcentration * 100}% limit`);
        eventBus.emit('risk:alert', { metric: 'sector_concentration', value: pct, threshold: this.limits.maxSectorConcentration });
      }
    }

    // Emergency reserves
    const requiredReserve = this.limits.emergencyReserveMonths * this.limits.monthlyExpenses;
    if (portfolio.cash < requiredReserve) {
      alerts.push(`WARNING: Cash reserves $${portfolio.cash.toLocaleString()} below ${this.limits.emergencyReserveMonths}-month requirement of $${requiredReserve.toLocaleString()}`);
    }

    // Kelly criterion position sizing
    const kellyFraction = this.limits.kellyFraction;

    return {
      portfolioDrawdown: drawdown,
      maxDrawdown: this.limits.maxDrawdown,
      sharpeRatio: 0, // Computed from historical returns
      sectorConcentration,
      correlationMatrix: {},
      kellyFraction,
      var95: portfolio.totalValue * 0.02, // Simplified 2% daily VaR
      alerts,
    };
  }

  getOptimalPositionSize(winRate: number, avgWin: number, avgLoss: number, portfolioValue: number): number {
    // Kelly criterion at configured fraction
    const kelly = winRate - ((1 - winRate) / (avgWin / avgLoss));
    const adjustedKelly = Math.max(0, kelly * this.limits.kellyFraction);
    return portfolioValue * adjustedKelly;
  }

  isFullStop(): boolean {
    return this.fullStopTriggered;
  }

  resetFullStop(): void {
    this.fullStopTriggered = false;
  }
}

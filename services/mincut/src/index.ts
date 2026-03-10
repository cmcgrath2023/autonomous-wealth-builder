import { Position, Portfolio, RiskMetrics } from '../../shared/types/index.js';

export interface OptimizationResult {
  targetWeights: Record<string, number>;
  currentWeights: Record<string, number>;
  rebalanceOrders: { ticker: string; action: 'buy' | 'sell'; shares: number; value: number }[];
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number;
}

export class MinCut {
  private riskFreeRate = 0.05; // 5% annualized
  private kellyFraction = 0.5;
  private maxPositionWeight = 0.15;
  private minPositionWeight = 0.02;

  constructor(options?: { riskFreeRate?: number; kellyFraction?: number; maxPositionWeight?: number }) {
    if (options?.riskFreeRate !== undefined) this.riskFreeRate = options.riskFreeRate;
    if (options?.kellyFraction !== undefined) this.kellyFraction = options.kellyFraction;
    if (options?.maxPositionWeight !== undefined) this.maxPositionWeight = options.maxPositionWeight;
  }

  optimize(portfolio: Portfolio, expectedReturns: Record<string, number>, volatilities: Record<string, number>): OptimizationResult {
    const totalEquity = portfolio.totalValue;
    const currentWeights: Record<string, number> = {};
    const targetWeights: Record<string, number> = {};

    // Calculate current weights
    for (const pos of portfolio.positions) {
      currentWeights[pos.ticker] = pos.marketValue / totalEquity;
    }

    // Kelly-based target weights with constraints
    let totalWeight = 0;
    for (const pos of portfolio.positions) {
      const er = expectedReturns[pos.ticker] || 0;
      const vol = volatilities[pos.ticker] || 0.2;

      // Simplified Kelly: f = (expected_return - risk_free) / variance
      const kelly = vol > 0 ? (er - this.riskFreeRate) / (vol * vol) : 0;
      const adjustedKelly = Math.max(0, kelly * this.kellyFraction);

      // Apply position size constraints
      const weight = Math.min(this.maxPositionWeight, Math.max(this.minPositionWeight, adjustedKelly));
      targetWeights[pos.ticker] = weight;
      totalWeight += weight;
    }

    // Normalize weights to sum to equity allocation (excluding cash)
    const cashTarget = 0.15; // 15% cash reserve
    const equityTarget = 1 - cashTarget;
    if (totalWeight > 0) {
      for (const ticker of Object.keys(targetWeights)) {
        targetWeights[ticker] = (targetWeights[ticker] / totalWeight) * equityTarget;
      }
    }

    // Calculate rebalance orders
    const rebalanceOrders: OptimizationResult['rebalanceOrders'] = [];
    for (const pos of portfolio.positions) {
      const currentWeight = currentWeights[pos.ticker] || 0;
      const targetWeight = targetWeights[pos.ticker] || 0;
      const diff = targetWeight - currentWeight;

      if (Math.abs(diff) > 0.01) { // 1% threshold
        const value = diff * totalEquity;
        const shares = Math.abs(Math.floor(value / pos.currentPrice));
        if (shares > 0) {
          rebalanceOrders.push({
            ticker: pos.ticker,
            action: diff > 0 ? 'buy' : 'sell',
            shares,
            value: Math.abs(value),
          });
        }
      }
    }

    // Portfolio-level metrics
    let expectedReturn = 0;
    let expectedRisk = 0;
    for (const pos of portfolio.positions) {
      const w = targetWeights[pos.ticker] || 0;
      expectedReturn += w * (expectedReturns[pos.ticker] || 0);
      expectedRisk += w * w * Math.pow(volatilities[pos.ticker] || 0.2, 2);
    }
    expectedRisk = Math.sqrt(expectedRisk);
    const sharpeRatio = expectedRisk > 0 ? (expectedReturn - this.riskFreeRate) / expectedRisk : 0;

    return { targetWeights, currentWeights, rebalanceOrders, expectedReturn, expectedRisk, sharpeRatio };
  }

  calculateCorrelation(seriesA: number[], seriesB: number[]): number {
    const n = Math.min(seriesA.length, seriesB.length);
    if (n < 2) return 0;

    const a = seriesA.slice(-n);
    const b = seriesB.slice(-n);
    const meanA = a.reduce((s, v) => s + v, 0) / n;
    const meanB = b.reduce((s, v) => s + v, 0) / n;

    let cov = 0, varA = 0, varB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA;
      const db = b[i] - meanB;
      cov += da * db;
      varA += da * da;
      varB += db * db;
    }

    const denom = Math.sqrt(varA * varB);
    return denom > 0 ? cov / denom : 0;
  }

  positionSize(winRate: number, avgWin: number, avgLoss: number, portfolioValue: number): number {
    if (avgLoss === 0) return 0;
    const kelly = winRate - ((1 - winRate) / (avgWin / avgLoss));
    const adjusted = Math.max(0, Math.min(this.maxPositionWeight, kelly * this.kellyFraction));
    return Math.round(portfolioValue * adjusted);
  }
}

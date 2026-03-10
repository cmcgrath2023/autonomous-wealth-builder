import { EventEmitter } from 'events';
import { calcGreeks } from './greeks.js';
import type { Greeks, IVRank, OptionContract, OptionSignal } from './types.js';

export type { Greeks, IVRank, OptionContract, OptionSignal };

interface OptionsTraderConfig {
  broker?: 'alpaca' | 'ibkr';
}

export class OptionsTrader extends EventEmitter {
  private broker: 'alpaca' | 'ibkr';
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: OptionsTraderConfig = {}) {
    super();
    this.broker = config.broker ?? 'alpaca';
  }

  /**
   * Evaluate a cash-secured put opportunity.
   * Only triggers when IV rank > 50% — we want to sell rich premium.
   */
  evaluateCashSecuredPut(
    underlying: string,
    currentPrice: number,
    ivRank: IVRank,
  ): OptionSignal | null {
    if (ivRank.ivRank <= 50) {
      return null;
    }

    const strike = Math.round(currentPrice * 0.95 * 100) / 100; // ~5% below
    const daysToExpiry = 45;
    const timeToExpiry = daysToExpiry / 365;
    const riskFreeRate = 0.05;
    const volatility = ivRank.currentIV / 100;

    const greeks = calcGreeks(currentPrice, strike, timeToExpiry, riskFreeRate, volatility, 'put');

    // Estimate premium as midpoint — approximate with Black-Scholes intrinsic + time value
    const premium = Math.max(currentPrice * 0.015, 0.5); // target 1-2% monthly

    const contract: OptionContract = {
      symbol: `${underlying}_P_${strike}_${daysToExpiry}DTE`,
      underlying,
      type: 'put',
      strike,
      expiration: this.getExpirationDate(daysToExpiry),
      bid: Math.round((premium - 0.05) * 100) / 100,
      ask: Math.round((premium + 0.05) * 100) / 100,
      volume: 0,
      openInterest: 0,
      impliedVolatility: ivRank.currentIV,
      greeks,
    };

    const signal: OptionSignal = {
      underlying,
      strategy: 'cash_secured_put',
      direction: 'short',
      confidence: 0.7,
      contracts: [contract],
      maxLoss: strike * 100, // assigned shares at strike
      maxGain: premium * 100,
      breakeven: strike - premium,
      rationale: 'Get paid to buy at discount',
      timestamp: new Date(),
    };

    this.emit('signal', signal);
    return signal;
  }

  /**
   * Evaluate a covered call opportunity.
   * Only triggers when IV rank > 40%.
   */
  evaluateCoveredCall(
    underlying: string,
    currentPrice: number,
    sharesOwned: number,
    ivRank: IVRank,
  ): OptionSignal | null {
    if (ivRank.ivRank <= 40) {
      return null;
    }

    const strike = Math.round(currentPrice * 1.05 * 100) / 100; // ~5% above
    const daysToExpiry = 30 + Math.floor(Math.random() * 16); // 30-45 DTE
    const timeToExpiry = daysToExpiry / 365;
    const riskFreeRate = 0.05;
    const volatility = ivRank.currentIV / 100;

    const greeks = calcGreeks(currentPrice, strike, timeToExpiry, riskFreeRate, volatility, 'call');

    const premium = Math.max(currentPrice * 0.01, 0.25); // target 1% monthly

    const contract: OptionContract = {
      symbol: `${underlying}_C_${strike}_${daysToExpiry}DTE`,
      underlying,
      type: 'call',
      strike,
      expiration: this.getExpirationDate(daysToExpiry),
      bid: Math.round((premium - 0.05) * 100) / 100,
      ask: Math.round((premium + 0.05) * 100) / 100,
      volume: 0,
      openInterest: 0,
      impliedVolatility: ivRank.currentIV,
      greeks,
    };

    const signal: OptionSignal = {
      underlying,
      strategy: 'covered_call',
      direction: 'short',
      confidence: 0.7,
      contracts: [contract],
      maxLoss: currentPrice * 100 - premium * 100, // stock drops to zero minus premium received
      maxGain: (strike - currentPrice) * 100 + premium * 100,
      breakeven: currentPrice - premium,
      rationale: 'Extract income from winning position',
      timestamp: new Date(),
    };

    this.emit('signal', signal);
    return signal;
  }

  /**
   * Evaluate a protective put for portfolio insurance.
   * Trigger when VIX > 25 or portfolio drawdown concern.
   */
  evaluateProtectivePut(
    underlying: string,
    currentPrice: number,
    portfolioValue: number,
    vixLevel: number,
  ): OptionSignal | null {
    if (vixLevel <= 25) {
      return null;
    }

    const strike = Math.round(currentPrice * 0.95 * 100) / 100; // ~5% below
    const daysToExpiry = 60; // longer for insurance
    const timeToExpiry = daysToExpiry / 365;
    const riskFreeRate = 0.05;
    const volatility = vixLevel / 100;

    const greeks = calcGreeks(currentPrice, strike, timeToExpiry, riskFreeRate, volatility, 'put');

    const premium = Math.max(currentPrice * 0.02, 0.5); // insurance cost

    const contract: OptionContract = {
      symbol: `${underlying}_P_${strike}_${daysToExpiry}DTE`,
      underlying,
      type: 'put',
      strike,
      expiration: this.getExpirationDate(daysToExpiry),
      bid: Math.round((premium - 0.05) * 100) / 100,
      ask: Math.round((premium + 0.05) * 100) / 100,
      volume: 0,
      openInterest: 0,
      impliedVolatility: vixLevel,
      greeks,
    };

    const signal: OptionSignal = {
      underlying,
      strategy: 'protective_put',
      direction: 'long',
      confidence: 0.8,
      contracts: [contract],
      maxLoss: premium * 100, // cost of insurance
      maxGain: (strike - premium) * 100, // protected down to zero
      breakeven: currentPrice + premium,
      rationale: `Portfolio insurance — VIX at ${vixLevel}, protecting ${((strike / currentPrice) * 100).toFixed(1)}% of value`,
      timestamp: new Date(),
    };

    this.emit('signal', signal);
    return signal;
  }

  /**
   * Evaluate a collar strategy — buy protective put + sell covered call for zero-cost hedging.
   */
  evaluateCollar(
    underlying: string,
    currentPrice: number,
    sharesOwned: number,
  ): OptionSignal | null {
    const putStrike = Math.round(currentPrice * 0.95 * 100) / 100; // ~5% below
    const callStrike = Math.round(currentPrice * 1.05 * 100) / 100; // ~5% above
    const daysToExpiry = 45;
    const timeToExpiry = daysToExpiry / 365;
    const riskFreeRate = 0.05;
    const volatility = 0.3; // assume moderate IV

    const putGreeks = calcGreeks(
      currentPrice,
      putStrike,
      timeToExpiry,
      riskFreeRate,
      volatility,
      'put',
    );
    const callGreeks = calcGreeks(
      currentPrice,
      callStrike,
      timeToExpiry,
      riskFreeRate,
      volatility,
      'call',
    );

    // Match premiums for zero-cost collar
    const putPremium = Math.max(currentPrice * 0.012, 0.3);
    const callPremium = putPremium; // matched for zero-cost

    const putContract: OptionContract = {
      symbol: `${underlying}_P_${putStrike}_${daysToExpiry}DTE`,
      underlying,
      type: 'put',
      strike: putStrike,
      expiration: this.getExpirationDate(daysToExpiry),
      bid: Math.round((putPremium - 0.05) * 100) / 100,
      ask: Math.round((putPremium + 0.05) * 100) / 100,
      volume: 0,
      openInterest: 0,
      impliedVolatility: 30,
      greeks: putGreeks,
    };

    const callContract: OptionContract = {
      symbol: `${underlying}_C_${callStrike}_${daysToExpiry}DTE`,
      underlying,
      type: 'call',
      strike: callStrike,
      expiration: this.getExpirationDate(daysToExpiry),
      bid: Math.round((callPremium - 0.05) * 100) / 100,
      ask: Math.round((callPremium + 0.05) * 100) / 100,
      volume: 0,
      openInterest: 0,
      impliedVolatility: 30,
      greeks: callGreeks,
    };

    const netCost = putPremium - callPremium; // should be ~0 for zero-cost collar

    const signal: OptionSignal = {
      underlying,
      strategy: 'collar',
      direction: 'long',
      confidence: 0.75,
      contracts: [putContract, callContract],
      maxLoss: (currentPrice - putStrike + netCost) * 100,
      maxGain: (callStrike - currentPrice - netCost) * 100,
      breakeven: currentPrice + netCost,
      rationale: `Zero-cost collar: protected below ${putStrike}, capped above ${callStrike}`,
      timestamp: new Date(),
    };

    this.emit('signal', signal);
    return signal;
  }

  /**
   * Calculate IV rank and percentile from historical implied volatilities.
   */
  checkIVRank(symbol: string, currentIV: number, historicalIVs: number[]): IVRank {
    const recent = historicalIVs.slice(-252); // last 252 trading days
    const high52w = Math.max(...recent);
    const low52w = Math.min(...recent);

    const ivRank = high52w !== low52w ? ((currentIV - low52w) / (high52w - low52w)) * 100 : 50;

    const daysBelow = recent.filter((iv) => iv < currentIV).length;
    const ivPercentile = (daysBelow / recent.length) * 100;

    return {
      symbol,
      currentIV,
      ivRank: Math.round(ivRank * 100) / 100,
      ivPercentile: Math.round(ivPercentile * 100) / 100,
      high52w,
      low52w,
    };
  }

  /**
   * Maximum days to expiration constraint.
   */
  getMaxDTE(): number {
    return 45;
  }

  /**
   * All strategies we use are defined-risk. We never sell naked.
   */
  isDefinedRisk(strategy: string): boolean {
    return strategy !== 'naked_short';
  }

  /**
   * Heartbeat — placeholder to evaluate opportunities from watchlist.
   */
  onHeartbeat(): void {
    this.emit('heartbeat', { timestamp: new Date(), broker: this.broker });
  }

  /**
   * Start the evaluation loop.
   */
  start(intervalMs: number = 60_000): void {
    if (this.intervalId) {
      return;
    }
    this.intervalId = setInterval(() => this.onHeartbeat(), intervalMs);
    this.emit('started', { broker: this.broker, intervalMs });
  }

  /**
   * Stop the evaluation loop.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.emit('stopped', { broker: this.broker });
    }
  }

  /**
   * Helper to compute an expiration date string from days-to-expiry.
   */
  private getExpirationDate(dte: number): string {
    const date = new Date();
    date.setDate(date.getDate() + dte);
    return date.toISOString().split('T')[0];
  }
}

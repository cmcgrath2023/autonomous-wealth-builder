import type { Greeks } from './types.js';

/**
 * Standard normal probability density function.
 */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Cumulative normal distribution using Abramowitz & Stegun approximation (formula 26.2.17).
 */
function normalCDF(x: number): number {
  if (x < -10) return 0;
  if (x > 10) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-0.5 * absX * absX);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate Black-Scholes Greeks for a European option.
 *
 * @param spot - Current price of the underlying
 * @param strike - Option strike price
 * @param timeToExpiry - Time to expiration in years
 * @param riskFreeRate - Annual risk-free interest rate (e.g. 0.05 for 5%)
 * @param volatility - Annualized implied volatility (e.g. 0.30 for 30%)
 * @param type - 'call' or 'put'
 */
export function calcGreeks(
  spot: number,
  strike: number,
  timeToExpiry: number,
  riskFreeRate: number,
  volatility: number,
  type: 'call' | 'put',
): Greeks {
  const sqrtT = Math.sqrt(timeToExpiry);
  const d1 =
    (Math.log(spot / strike) + (riskFreeRate + 0.5 * volatility * volatility) * timeToExpiry) /
    (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;

  const expRT = Math.exp(-riskFreeRate * timeToExpiry);

  // Gamma and vega are the same for calls and puts
  const gamma = normalPDF(d1) / (spot * volatility * sqrtT);
  const vega = (spot * normalPDF(d1) * sqrtT) / 100; // per 1% move in IV

  let delta: number;
  let theta: number;
  let rho: number;

  if (type === 'call') {
    delta = normalCDF(d1);
    theta =
      ((-spot * normalPDF(d1) * volatility) / (2 * sqrtT) -
        riskFreeRate * strike * expRT * normalCDF(d2)) /
      365; // per calendar day
    rho = (strike * timeToExpiry * expRT * normalCDF(d2)) / 100; // per 1% move in rate
  } else {
    delta = normalCDF(d1) - 1;
    theta =
      ((-spot * normalPDF(d1) * volatility) / (2 * sqrtT) +
        riskFreeRate * strike * expRT * normalCDF(-d2)) /
      365;
    rho = (-strike * timeToExpiry * expRT * normalCDF(-d2)) / 100;
  }

  return { delta, gamma, theta, vega, rho };
}

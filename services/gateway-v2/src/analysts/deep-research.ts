/**
 * Deep Research Analyst — Per-ticker fundamental analysis
 *
 * Runs daily (7 AM ET) on core holdings, watchlist, and top research stars.
 * Pulls from Yahoo Finance quoteSummary API:
 *   - Analyst price targets + recommendations
 *   - Earnings dates + estimates
 *   - Insider transactions
 *   - Key financials (revenue growth, margins, cash flow)
 *
 * Outputs:
 *   - Trident domain intel (domain: "fundamental_profile")
 *   - PostgreSQL ticker_fundamentals table
 *   - Research stars score adjustments
 *
 * This builds the pattern library for probabilistic predictive analytics.
 */

import { brain } from '../brain-client.js';

const YAHOO_BASE = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';
const MODULES = [
  'financialData',
  'recommendationTrend',
  'upgradeDowngradeHistory',
  'earningsHistory',
  'earningsTrend',
  'insiderTransactions',
  'defaultKeyStatistics',
  'calendarEvents',
].join(',');

const FETCH_TIMEOUT = 12_000;
const RATE_LIMIT_MS = 600; // ~100 req/min to avoid Yahoo throttle

// Yahoo requires crumb + cookie auth — cache across calls
let _yahooCrumb: string | null = null;
let _yahooCookie: string | null = null;
let _yahooAuthExpiry = 0;

async function getYahooAuth(): Promise<{ crumb: string; cookie: string } | null> {
  if (_yahooCrumb && _yahooCookie && Date.now() < _yahooAuthExpiry) {
    return { crumb: _yahooCrumb, cookie: _yahooCookie };
  }
  try {
    // Step 1: hit fc.yahoo.com to get session cookies
    const initRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
      redirect: 'manual',
    });
    const setCookies = initRes.headers.getSetCookie?.() || [];
    const cookie = setCookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: get crumb using those cookies
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie },
      signal: AbortSignal.timeout(5000),
    });
    if (!crumbRes.ok) return null;
    const crumb = await crumbRes.text();
    if (!crumb || crumb.length < 5) return null;

    _yahooCrumb = crumb;
    _yahooCookie = cookie;
    _yahooAuthExpiry = Date.now() + 30 * 60 * 1000; // cache 30 min
    return { crumb, cookie };
  } catch (e: any) {
    console.log(`  [DEEP] Yahoo auth failed: ${e.message}`);
    return null;
  }
}

export interface TickerFundamentals {
  symbol: string;
  fetchedAt: string;

  // Analyst consensus
  analystTargetMean: number | null;
  analystTargetMedian: number | null;
  analystTargetHigh: number | null;
  analystTargetLow: number | null;
  analystCount: number;
  recommendationKey: string | null;     // strongBuy, buy, hold, sell, strongSell
  recommendationScore: number | null;   // 1.0 (strong buy) to 5.0 (strong sell)

  // Upgrades/downgrades (last 90 days)
  recentUpgrades: number;
  recentDowngrades: number;

  // Earnings
  nextEarningsDate: string | null;
  earningsSurprisePct: number | null;   // Last quarter's surprise %

  // Insider activity (last 6 months)
  insiderBuyCount: number;
  insiderSellCount: number;
  insiderNetShares: number;

  // Key financials
  revenueGrowth: number | null;         // YoY %
  profitMargin: number | null;
  operatingMargin: number | null;
  returnOnEquity: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
  currentPrice: number | null;

  // Derived conviction
  fundamentalScore: number;             // 0-100 composite
}

function extractFundamentals(symbol: string, data: any): TickerFundamentals {
  const fin = data?.financialData || {};
  const rec = data?.recommendationTrend?.trend?.[0] || {};
  const upgrades = data?.upgradeDowngradeHistory?.history || [];
  const earnings = data?.earningsTrend?.trend || [];
  const insiders = data?.insiderTransactions?.transactions || [];
  const stats = data?.defaultKeyStatistics || {};
  const calendar = data?.calendarEvents || {};

  // Analyst targets
  const analystTargetMean = fin.targetMeanPrice?.raw ?? null;
  const analystTargetMedian = fin.targetMedianPrice?.raw ?? null;
  const analystTargetHigh = fin.targetHighPrice?.raw ?? null;
  const analystTargetLow = fin.targetLowPrice?.raw ?? null;
  const analystCount = fin.numberOfAnalystOpinions?.raw ?? 0;
  const recommendationKey = fin.recommendationKey ?? null;
  const recommendationScore = fin.recommendationMean?.raw ?? null;

  // Recent upgrades/downgrades (last 90 days)
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recentActions = upgrades.filter((u: any) => {
    const epoch = u.epochGradeDate ? u.epochGradeDate * 1000 : 0;
    return epoch > ninetyDaysAgo;
  });
  const recentUpgrades = recentActions.filter((u: any) => u.action === 'up').length;
  const recentDowngrades = recentActions.filter((u: any) => u.action === 'down').length;

  // Earnings
  const earningsDates = calendar.earnings?.earningsDate || [];
  const nextEarningsDate = earningsDates[0]?.fmt ?? null;
  const lastEarnings = data?.earningsHistory?.history?.slice(-1)?.[0];
  const earningsSurprisePct = lastEarnings?.surprisePercent?.raw ?? null;

  // Insider transactions (last 6 months)
  const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
  const recentInsiders = insiders.filter((t: any) => {
    const epoch = t.startDate?.raw ? t.startDate.raw * 1000 : 0;
    return epoch > sixMonthsAgo;
  });
  const insiderBuyCount = recentInsiders.filter((t: any) => t.shares?.raw > 0).length;
  const insiderSellCount = recentInsiders.filter((t: any) => t.shares?.raw < 0).length;
  const insiderNetShares = recentInsiders.reduce((sum: number, t: any) => sum + (t.shares?.raw || 0), 0);

  // Key financials
  const revenueGrowth = fin.revenueGrowth?.raw ?? null;
  const profitMargin = fin.profitMargins?.raw ?? null;
  const operatingMargin = fin.operatingMargins?.raw ?? null;
  const returnOnEquity = fin.returnOnEquity?.raw ?? null;
  const debtToEquity = stats.debtToEquity?.raw ?? null;
  const freeCashFlow = fin.freeCashflow?.raw ?? null;
  const currentPrice = fin.currentPrice?.raw ?? null;

  // ── Composite fundamental score (0-100) ──
  let score = 50; // neutral baseline

  // Analyst sentiment (-15 to +20)
  if (recommendationScore !== null) {
    if (recommendationScore <= 2.0) score += 20;       // strong buy
    else if (recommendationScore <= 2.5) score += 12;  // buy
    else if (recommendationScore <= 3.0) score += 0;   // hold
    else if (recommendationScore <= 4.0) score -= 10;  // underperform
    else score -= 15;                                   // sell
  }

  // Price target upside (-10 to +15)
  if (analystTargetMean && currentPrice && currentPrice > 0) {
    const upside = (analystTargetMean - currentPrice) / currentPrice;
    if (upside > 0.20) score += 15;
    else if (upside > 0.10) score += 8;
    else if (upside > 0) score += 3;
    else if (upside > -0.10) score -= 5;
    else score -= 10;
  }

  // Upgrade momentum (-5 to +10)
  score += Math.min(recentUpgrades * 3, 10);
  score -= Math.min(recentDowngrades * 3, 5);

  // Earnings surprise (-5 to +5)
  if (earningsSurprisePct !== null) {
    if (earningsSurprisePct > 0.05) score += 5;
    else if (earningsSurprisePct > 0) score += 2;
    else if (earningsSurprisePct < -0.05) score -= 5;
  }

  // Insider buying is bullish (-3 to +5)
  if (insiderBuyCount > insiderSellCount) score += 5;
  else if (insiderSellCount > insiderBuyCount * 3) score -= 3;

  // Profitability (+0 to +5)
  if (profitMargin !== null && profitMargin > 0.15) score += 3;
  if (revenueGrowth !== null && revenueGrowth > 0.10) score += 2;

  score = Math.max(0, Math.min(100, score));

  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    analystTargetMean, analystTargetMedian, analystTargetHigh, analystTargetLow,
    analystCount, recommendationKey, recommendationScore,
    recentUpgrades, recentDowngrades,
    nextEarningsDate, earningsSurprisePct,
    insiderBuyCount, insiderSellCount, insiderNetShares,
    revenueGrowth, profitMargin, operatingMargin, returnOnEquity,
    debtToEquity, freeCashFlow, currentPrice,
    fundamentalScore: score,
  };
}

export async function deepResearchTicker(symbol: string): Promise<TickerFundamentals | null> {
  try {
    const auth = await getYahooAuth();
    if (!auth) {
      console.log(`  [DEEP] ${symbol}: Yahoo auth unavailable`);
      return null;
    }
    const url = `${YAHOO_BASE}/${symbol}?modules=${MODULES}&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': auth.cookie },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) {
      if (res.status === 401) { _yahooCrumb = null; _yahooAuthExpiry = 0; } // force re-auth
      console.log(`  [DEEP] ${symbol}: Yahoo ${res.status}`);
      return null;
    }
    const json = await res.json() as any;
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;

    return extractFundamentals(symbol, result);
  } catch (e: any) {
    console.log(`  [DEEP] ${symbol}: ${e.message}`);
    return null;
  }
}

export interface DeepResearchResult {
  scanned: number;
  succeeded: number;
  failed: number;
  profiles: TickerFundamentals[];
  tridentRecorded: number;
}

/**
 * Run deep research on a list of tickers.
 * Records each profile to Trident domain "fundamental_profile" and optionally to PG.
 */
export async function runDeepResearch(
  tickers: string[],
  pgPool?: any,
): Promise<DeepResearchResult> {
  const profiles: TickerFundamentals[] = [];
  let failed = 0;
  let tridentRecorded = 0;

  console.log(`[DEEP RESEARCH] Starting deep analysis on ${tickers.length} tickers: ${tickers.join(', ')}`);

  for (const ticker of tickers) {
    const profile = await deepResearchTicker(ticker);
    if (profile) {
      profiles.push(profile);

      // Record to Trident for SONA pattern learning
      try {
        const upsidePct = profile.analystTargetMean && profile.currentPrice
          ? ((profile.analystTargetMean - profile.currentPrice) / profile.currentPrice * 100).toFixed(1)
          : '?';

        const content = [
          `FUNDAMENTAL PROFILE: ${ticker}`,
          `Analyst: ${profile.recommendationKey} (${profile.recommendationScore?.toFixed(1)}/5) | ${profile.analystCount} analysts`,
          `Target: $${profile.analystTargetMean?.toFixed(2)} (${upsidePct}% upside) | High: $${profile.analystTargetHigh?.toFixed(2)} Low: $${profile.analystTargetLow?.toFixed(2)}`,
          `Upgrades: ${profile.recentUpgrades} | Downgrades: ${profile.recentDowngrades} (90d)`,
          `Earnings: next ${profile.nextEarningsDate || 'unknown'} | last surprise: ${profile.earningsSurprisePct !== null ? (profile.earningsSurprisePct * 100).toFixed(1) + '%' : 'n/a'}`,
          `Insiders: ${profile.insiderBuyCount} buys / ${profile.insiderSellCount} sells (6mo) | net ${profile.insiderNetShares.toLocaleString()} shares`,
          `Financials: rev growth ${profile.revenueGrowth !== null ? (profile.revenueGrowth * 100).toFixed(1) + '%' : 'n/a'} | margin ${profile.profitMargin !== null ? (profile.profitMargin * 100).toFixed(1) + '%' : 'n/a'} | ROE ${profile.returnOnEquity !== null ? (profile.returnOnEquity * 100).toFixed(1) + '%' : 'n/a'}`,
          `Fundamental Score: ${profile.fundamentalScore}/100`,
        ].join('\n');

        await brain.recordRule(content, 'fundamental_profile');
        tridentRecorded++;
      } catch {}

      // Write to PG if available
      if (pgPool) {
        try {
          await pgPool.query(`
            INSERT INTO ticker_fundamentals (
              symbol, fetched_at, analyst_target_mean, analyst_target_median,
              analyst_target_high, analyst_target_low, analyst_count,
              recommendation_key, recommendation_score,
              recent_upgrades, recent_downgrades,
              next_earnings_date, earnings_surprise_pct,
              insider_buy_count, insider_sell_count, insider_net_shares,
              revenue_growth, profit_margin, operating_margin,
              return_on_equity, debt_to_equity, free_cash_flow,
              current_price, fundamental_score
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
            ON CONFLICT (symbol) DO UPDATE SET
              fetched_at = EXCLUDED.fetched_at,
              analyst_target_mean = EXCLUDED.analyst_target_mean,
              analyst_target_median = EXCLUDED.analyst_target_median,
              analyst_target_high = EXCLUDED.analyst_target_high,
              analyst_target_low = EXCLUDED.analyst_target_low,
              analyst_count = EXCLUDED.analyst_count,
              recommendation_key = EXCLUDED.recommendation_key,
              recommendation_score = EXCLUDED.recommendation_score,
              recent_upgrades = EXCLUDED.recent_upgrades,
              recent_downgrades = EXCLUDED.recent_downgrades,
              next_earnings_date = EXCLUDED.next_earnings_date,
              earnings_surprise_pct = EXCLUDED.earnings_surprise_pct,
              insider_buy_count = EXCLUDED.insider_buy_count,
              insider_sell_count = EXCLUDED.insider_sell_count,
              insider_net_shares = EXCLUDED.insider_net_shares,
              revenue_growth = EXCLUDED.revenue_growth,
              profit_margin = EXCLUDED.profit_margin,
              operating_margin = EXCLUDED.operating_margin,
              return_on_equity = EXCLUDED.return_on_equity,
              debt_to_equity = EXCLUDED.debt_to_equity,
              free_cash_flow = EXCLUDED.free_cash_flow,
              current_price = EXCLUDED.current_price,
              fundamental_score = EXCLUDED.fundamental_score
          `, [
            profile.symbol, profile.fetchedAt,
            profile.analystTargetMean, profile.analystTargetMedian,
            profile.analystTargetHigh, profile.analystTargetLow,
            profile.analystCount, profile.recommendationKey, profile.recommendationScore,
            profile.recentUpgrades, profile.recentDowngrades,
            profile.nextEarningsDate, profile.earningsSurprisePct,
            profile.insiderBuyCount, profile.insiderSellCount, profile.insiderNetShares,
            profile.revenueGrowth, profile.profitMargin, profile.operatingMargin,
            profile.returnOnEquity, profile.debtToEquity, profile.freeCashFlow,
            profile.currentPrice, profile.fundamentalScore,
          ]);
        } catch (e: any) {
          console.log(`  [DEEP] ${ticker} PG write failed: ${e.message}`);
        }
      }

      console.log(`  [DEEP] ${ticker}: score=${profile.fundamentalScore} | ${profile.recommendationKey} | target=$${profile.analystTargetMean?.toFixed(2)} | upgrades=${profile.recentUpgrades} downgrades=${profile.recentDowngrades}`);
    } else {
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`[DEEP RESEARCH] Done: ${profiles.length}/${tickers.length} succeeded, ${tridentRecorded} recorded to Trident`);
  return { scanned: tickers.length, succeeded: profiles.length, failed, profiles, tridentRecorded };
}

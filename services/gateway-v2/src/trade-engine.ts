/**
 * Trade Engine — RSI-2 Mean Reversion (Connors)
 *
 * Proven strategy: 65-73% win rate backtested on S&P 500.
 * Buy oversold dips in uptrending stocks, sell when they bounce.
 *
 * Entry: RSI(2) < 10 AND price > SMA(200)
 * Exit:  RSI(2) > 70 OR held 5+ days OR 5% stop loss
 * Scan:  3:50 PM ET daily on S&P 500 universe
 * Stop:  Broker-side stop order at entry - 5% (placed on buy)
 *
 * Trident records every scan, buy, sell, and observation.
 * PG stores thesis records for each entry.
 */

import { join } from 'path';
import { TradeExecutor } from '../../neural-trader/src/executor.js';
import { ForexScanner } from '../../forex-scanner/src/index.js';
import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { loadCredentials, getAlpacaHeaders } from './config-bus.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { brain } from './brain-client.js';
import { recordClosedTrade, reconcileWithAlpaca } from './trade-recorder.js';
import { getActiveResearchStars } from './research-stars.js';
import { recordTradeLot } from './trading-ledger.js';
import { rsi, sma } from '../../neural-trader/src/indicators.js';

function emitTradeClosed(payload: { ticker: string; success: boolean; returnPct: number; reason: string }) {
  eventBus.emit('trade:closed' as any, payload);
}

async function postToDiscord(text: string): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

// ─── Config ──────────────────────────────────────────────────────────────────

const HEARTBEAT_MS = 120_000;        // 2 min — monitors positions, exits, forex
const MAX_POSITIONS = 8;              // Increased from 5 — more room to concentrate on winners
const PER_POSITION = 6_000;           // $50K budget / 8 positions = $6,250 per slot
const BUDGET_MAX = 70_000;            // Cash available — room for longs + shorts without using margin
const BIZ_INSIDER_MOVERS_URL = 'https://markets.businessinsider.com/index/market-movers/s&p_500';

// Strategy lockdown: only documented strategies may open equity positions.
// The prior recovery build accreted momentum/catalyst/watchlist entries while
// debugging losses. Keep those paths visible but off until they have a spec,
// backtest, and explicit risk model.
const ENABLE_PREMARKET_MOMENTUM_BUYS = false;       // Pure momentum — no edge proven
const ENABLE_MIDDAY_MOMENTUM = false;                 // DISABLED: use catalyst buy path instead
const ENABLE_SECTOR_INTRADAY_INVERSE_BUYS = false;  // Whipsaw risk — use 3:50 PM regime only
const ENABLE_PRIORITY_WATCHLIST_BUYS = false;        // Pure momentum chasing — no edge
const ENABLE_CATALYST_BUYS = true;                   // Buys high-score research stars from Biz Insider + catalyst hunter
const ENABLE_MORNING_RSI2_BUYS = false;              // DISABLED: RSI-2 buys consistently pick losers (UNP -$639, GWW -$101)
const ENABLE_MORNING_PREP = true;                    // 8 AM unified prep — overnight catalysts + pre-market snapshots
const NEW_BUY_CUTOFF_HOUR = 14;                      // No new buys after 2 PM ET — avoid late-day entries that go red AH
const PREMARKET_MIN_STAR_SCORE = 0.85;               // Biz Insider / catalyst stars at or above this can be acted on pre-market
const PREMARKET_MIN_MOVE_PCT = 0.25;                 // Early confirmation threshold; do not wait for the full move
const PREMARKET_MAX_CHASE_PCT = 8;                   // Match ORB gap discipline; avoid buying blow-off gaps
const PREMARKET_LIMIT_BUFFER_PCT = 0.01;             // Limit order cap above current pre-market print/ask
const PREMARKET_MAX_ORDERS_PER_RUN = 3;              // Re-runs every 15 min; keep each batch focused
const MIN_DOWNSIDE_SHORT_MOVE = -3.0;                 // Must be sharply red today before shorting
const SHORT_TARGET_MIN = 0.20;                        // Bull tape: stay mostly long
const SHORT_TARGET_MAX = 0.80;                        // Tanking tape: allow heavy short book
const MIN_SHORT_NOTIONAL = 500;                       // Avoid noise-size shorts
const ROTATE_WEAK_LONG_MAX_PNL_PCT = -0.25;           // Only free capital from lagging non-core longs
const ROTATE_WEAK_LONG_MAX_DOLLAR_PNL = -50;

// Core holdings — buy and hold, engine NEVER sells these
const CORE_HOLDINGS = new Set<string>(['AMZN', 'NVDA']); // Owner long-term holds — engine NEVER sells these
const WATCHLIST_REBUY = new Map<string, number>([ // Ticker → max rebuy price — alert when price drops to this level
  ['AMD', 420],   // Sold at $437 — rebuy on meaningful dip
  ['NFLX', 85],   // FANG stock — rebuy if it dips back
]);

// Quality gate — system may ONLY auto-buy tickers on this list
// Everything else gets logged as a signal but NOT executed
// "Would I stake my family on this for 100 years?" — WWBD
const APPROVED_TICKERS = new Set<string>([
  // Core + Watchlist
  'AMZN', 'NVDA', 'AAPL', 'MSFT', 'AMD', 'NFLX', 'GOOGL', 'GOOG',
  // Category makers — tech/cloud/AI
  'META', 'NOW', 'CRM', 'DDOG', 'PANW', 'CRWD', 'SNOW', 'PLTR',
  // Berkshire portfolio
  'AXP', 'BAC', 'KO', 'CVX', 'MCO', 'OXY', 'COF', 'KR',
  // Owner approved — quality businesses
  'TSLA', 'UBER', 'COIN', 'V', 'MA', 'JPM', 'GS',
  // Inverse ETFs for hedging
  'SQQQ', 'SH', 'SPXS', 'GLD', 'SLV',
]);

function isAutoBuyAllowedSymbol(symbol: string): boolean {
  return APPROVED_TICKERS.has(symbol) ||
    SP500_UNIVERSE.includes(symbol) ||
    ['SQQQ','SH','SPXS','SDOW','TZA','GLD','SLV','TSDD','TSLQ','FAZ','SDS','PSQ'].includes(symbol);
}
const DAILY_LOSS_LIMIT = -5_000;     // Raised — broker stops are the real protection now. CB was blocking all trading.
const STOP_PCT = 0.05;               // 5% broker-side disaster stop
const DOLLAR_STOP_LOSS = 100;         // Primary active stop when heartbeat is running
const HALF_PROFIT_TRIGGER = 500;      // Sell half, resize broker stop to remaining shares
const RSI_ENTRY = 10;                // Buy long when RSI(2) < 10
const RSI_EXIT = 70;                 // Sell long when RSI(2) > 70
const RSI_SHORT_ENTRY = 96;          // Short only extreme overbought (was 90, too loose)
const RSI_SHORT_EXIT = 30;           // Cover short when RSI(2) < 30
const MAX_HOLD_DAYS = 5;             // Time stop — sell after 5 trading days
const SMA_PERIOD = 200;              // Must be above 200-day SMA
const RSI_PERIOD = 2;                // Connors RSI-2
const FOREX_BANK = 50;
const FOREX_CUT = -20;

type BizInsiderMover = {
  symbol: string;
  pct: number;
  name: string;
  list: 'gainer' | 'loser';
};

type MarketShortTarget = {
  targetShortRatio: number;
  reason: string;
  spyChangePct: number | null;
  qqqChangePct: number | null;
  uvxyChangePct: number | null;
  macroRegime: string | null;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function computeMarketShortTarget(
  headers: Record<string, string>,
  store: GatewayStateStore,
): Promise<MarketShortTarget> {
  let spyChangePct: number | null = null;
  let qqqChangePct: number | null = null;
  let uvxyChangePct: number | null = null;
  let macroRegime: string | null = null;

  try {
    const snapRes = await fetch('https://data.alpaca.markets/v2/stocks/snapshots?symbols=SPY,QQQ,UVXY&feed=iex', {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (snapRes.ok) {
      const data = await snapRes.json() as any;
      const pct = (symbol: string): number | null => {
        const snap = data[symbol];
        const price = snap?.latestTrade?.p || snap?.latestQuote?.ap;
        const prev = snap?.prevDailyBar?.c;
        return price && prev ? ((price - prev) / prev) * 100 : null;
      };
      spyChangePct = pct('SPY');
      qqqChangePct = pct('QQQ');
      uvxyChangePct = pct('UVXY');
    }
  } catch {}

  try {
    const macro = JSON.parse(store.get('macro_latest_verdict') || '{}');
    macroRegime = typeof macro.regime === 'string' ? macro.regime : null;
  } catch {}

  const equityMoves = [spyChangePct, qqqChangePct].filter((v): v is number => typeof v === 'number' && isFinite(v));
  const avgEquityMove = equityMoves.length > 0 ? equityMoves.reduce((s, v) => s + v, 0) / equityMoves.length : 0;
  const volMove = typeof uvxyChangePct === 'number' && isFinite(uvxyChangePct) ? uvxyChangePct : 0;

  // Center at 50/50. Positive tape tilts toward long movers; negative tape tilts toward BI losers.
  const marketTilt = clampNumber(avgEquityMove / 2.0 - volMove / 12.0, -1, 1);
  let targetShortRatio = 0.50 - (marketTilt * 0.30);
  targetShortRatio = clampNumber(targetShortRatio, SHORT_TARGET_MIN, SHORT_TARGET_MAX);

  if (macroRegime === 'crisis') targetShortRatio = Math.max(targetShortRatio, 0.80);
  else if (macroRegime === 'risk_off') targetShortRatio = Math.max(targetShortRatio, 0.65);
  else if (macroRegime === 'trending' && marketTilt > 0) targetShortRatio = Math.min(targetShortRatio, 0.20);
  else if (macroRegime === 'risk_on' && marketTilt > 0) targetShortRatio = Math.min(targetShortRatio, 0.35);

  return {
    targetShortRatio,
    reason: `SPY ${spyChangePct === null ? 'n/a' : spyChangePct.toFixed(2) + '%'}, QQQ ${qqqChangePct === null ? 'n/a' : qqqChangePct.toFixed(2) + '%'}, UVXY ${uvxyChangePct === null ? 'n/a' : uvxyChangePct.toFixed(2) + '%'}, tilt ${marketTilt.toFixed(2)}, macro ${macroRegime || 'n/a'}`,
    spyChangePct,
    qqqChangePct,
    uvxyChangePct,
    macroRegime,
  };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseBizInsiderMovers(html: string): BizInsiderMover[] {
  const movers: BizInsiderMover[] = [];
  const tableSections = [...html.matchAll(/<h2[^>]*>[\s\S]*?S&amp;P 500 - Top (Gainers|Losers)[\s\S]*?<\/h2>[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)];

  for (const section of tableSections) {
    const list = section[1].toLowerCase() === 'losers' ? 'loser' : 'gainer';
    const rows = [...section[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const rowMatch of rows) {
      const row = rowMatch[1];
      const link = row.match(/\/stocks\/([a-z0-9.-]+)-stock"[^>]*title="([^"]+)"/i);
      if (!link) continue;
      const symbol = link[1].replace(/[^a-z0-9]/gi, '').toUpperCase();
      if (!symbol || symbol.length > 5 || !SP500_UNIVERSE.includes(symbol)) continue;
      const pctMatches = [...row.matchAll(/>([+-]?\d[\d,.]*)%<\/span>/g)];
      if (pctMatches.length === 0) continue;
      const pct = Number(pctMatches[0][1].replace(/,/g, ''));
      if (!Number.isFinite(pct)) continue;
      movers.push({ symbol, pct, name: decodeHtml(link[2]), list });
    }
  }

  // Fallback for simpler historical markup.
  if (movers.length === 0) {
    const entries = [...html.matchAll(/\/stocks\/([a-z]+)-stock[^"]*"[^>]*title="([^"]+)"[\s\S]{0,600}?([+-]?\d+\.\d+)%/gi)];
    for (const m of entries) {
      const symbol = m[1].toUpperCase();
      const pct = Number(m[3]);
      if (!symbol || symbol.length > 5 || !SP500_UNIVERSE.includes(symbol) || !Number.isFinite(pct)) continue;
      movers.push({ symbol, pct, name: decodeHtml(m[2]), list: pct < 0 ? 'loser' : 'gainer' });
    }
  }

  return movers;
}

// ─── Inverse ETF Config (hedge for down markets) ─────────────────────────────
const INVERSE_ETF = 'SQQQ';           // 3x inverse Nasdaq — goes up when market drops
const INVERSE_ETF_1X = 'SH';          // 1x inverse S&P — less volatile alternative
const SPY_SMA_PERIOD = 20;            // Buy inverse when SPY below 20-day SMA
const INVERSE_STOP_PCT = 0.07;        // 7% stop on inverse ETF positions
const INVERSE_MAX_HOLD = 5;           // Max 5 days (3x ETFs decay fast)
const INVERSE_POSITION_SIZE = 10_000; // $10K in inverse ETFs

// Sector inverse ETFs — when a sector drops, buy the inverse
const SECTOR_INVERSE: Record<string, { etf: string; leaders: string[] }> = {
  semiconductors: { etf: 'SOXS', leaders: ['NVDA', 'AMD', 'INTC', 'QCOM', 'AVGO', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MRVL'] },
  nasdaq:         { etf: 'SQQQ', leaders: ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'NFLX'] },
  sp500:          { etf: 'SPXS', leaders: ['SPY'] },
  financials:     { etf: 'FAZ',  leaders: ['JPM', 'GS', 'BAC', 'MS', 'C', 'WFC'] },
  energy:         { etf: 'ERY',  leaders: ['XOM', 'CVX', 'OXY', 'COP', 'SLB', 'DVN'] },
  realestate:     { etf: 'DRV',  leaders: ['PLD', 'AMT', 'EQIX', 'CCI', 'SPG'] },
  dow:            { etf: 'SDOW', leaders: ['DIA'] },
};

// Priority watchlist — checked every heartbeat. Buy when up 1%+ today.
// These are the most active, most traded names. If they move, we're in.
const PRIORITY_WATCHLIST = [
  'NVDA','TSLA','META','AAPL','GOOGL','AMZN','MSFT',  // Mega cap tech
  'INTC','AMD','QCOM','AVGO','MU',                      // Semiconductors
  'VZ','T','TMUS',                                       // Telecom
  'JPM','GS','BAC','MS',                                 // Banks
  'XOM','CVX','OXY',                                     // Energy
  'BA','LMT','RTX','GD',                                 // Defense
  'UNH','JNJ','PFE','LLY','ABBV',                       // Healthcare
  'DIS','NFLX','CMCSA',                                  // Media
  'HD','WMT','COST','TGT',                               // Retail
];

// ─── ORB Config ──────────────────────────────────────────────────────────────
const ORB_GAP_MIN = 1;              // Minimum gap-up % (reject <1%)
const ORB_GAP_MAX = 8;              // Maximum gap-up % (reject >8% — blow-off)
const ORB_SCAN_TIME_START = 9;      // 9:45 AM ET — opening range established
const ORB_SCAN_TIME_END = 10;       // Stop looking for ORB entries after 10:00 AM
const ORB_FLATTEN_HOUR = 11;        // Flatten ORB positions by 11:30 AM if no target hit
const ORB_FLATTEN_MIN = 30;
const ORB_PER_POSITION = 6_000;     // Match PER_POSITION

// Full S&P 500 universe — Connors tested on the complete index
const SP500_UNIVERSE = [
  'AAPL','ABBV','ABT','ACN','ADBE','ADI','ADM','ADP','ADSK','AEE',
  'AEP','AES','AFL','AIG','AIZ','AJG','AKAM','ALB','ALGN','ALK',
  'ALL','ALLE','AMAT','AMCR','AMD','AME','AMGN','AMP','AMT','AMZN',
  'ANET','ANSS','AON','AOS','APA','APD','APH','APTV','ARE','ATO',
  'AVGO','AVY','AWK','AXP','AZO','BA','BAC','BAX','BBWI',
  'BDX','BEN','BG','BIIB','BIO','BK','BKNG','BKR','BLDR',
  'BLK','BMY','BR','BRO','BSX','BWA','BX','BXP','C',
  'CAG','CAH','CARR','CAT','CB','CBOE','CBRE','CCI','CCL','CDAY',
  'CDNS','CDW','CE','CEG','CF','CFG','CHD','CHRW','CHTR','CI',
  'CINF','CL','CLX','CMA','CMCSA','CME','CMG','CMI','CMS','CNC',
  'CNP','COF','COO','COP','COR','COST','CPAY','CPB','CPRT','CPT',
  'CRL','CRM','CRWD','CSCO','CSGP','CSX','CTAS','CTRA','CTSH',
  'CTVA','CVS','CVX','CZR','D','DAL','DAY','DD','DE','DECK',
  'DFS','DG','DGX','DHI','DHR','DIS','DLTR','DOV','DOW','DPZ',
  'DRI','DTE','DUK','DVA','DVN','DXCM','EA','EBAY','ECL','ED',
  'EFX','EG','EIX','EL','EMN','EMR','ENPH','EOG','EPAM','EQIX',
  'EQR','EQT','ERIE','ES','ESS','ETN','ETR','EVRG','EW','EXC',
  'EXPD','EXPE','EXR','F','FANG','FAST','FCNCA','FCX','FDS','FDX',
  'FE','FFIV','FI','FICO','FIS','FISV','FITB','FMC','FOX',
  'FOXA','FRT','FSLR','FTNT','FTV','GD','GDDY','GE','GEHC','GEN',
  'GEV','GILD','GIS','GL','GLW','GM','GNRC','GOOG','GOOGL','GPC',
  'GPN','GRMN','GS','GWW','HAL','HAS','HBAN','HCA','HD','HOLX',
  'HON','HPE','HPQ','HRL','HSIC','HST','HSY','HUBB','HUM','HWM',
  'IBM','ICE','IDXX','IEX','IFF','ILMN','INCY','INTC','INTU','INVH',
  'IP','IPG','IQV','IR','IRM','ISRG','IT','ITW','IVZ','J',
  'JBHT','JBL','JCI','JKHY','JNJ','JNPR','JPM','K','KDP','KEY',
  'KEYS','KHC','KIM','KLAC','KMB','KMI','KMX','KO','KR','KVUE',
  'L','LDOS','LEN','LH','LHX','LIN','LKQ','LLY','LMT','LNT',
  'LOW','LRCX','LULU','LUV','LVS','LW','LYB','LYV','MA','MAA',
  'MAR','MAS','MCD','MCHP','MCK','MCO','MDLZ','MDT','MET','META',
  'MGM','MHK','MKC','MKTX','MLM','MMC','MMM','MNST','MO','MOH',
  'MOS','MPC','MPWR','MRK','MRNA','MRVL','MS','MSCI','MSFT','MSI',
  'MTB','MTCH','MTD','MU','NCLH','NDAQ','NDSN','NEE','NEM','NFLX',
  'NI','NKE','NOC','NOW','NRG','NSC','NTAP','NTRS','NUE','NVDA',
  'NVR','NWS','NWSA','NXPI','O','ODFL','OKE','OMC','ON','ORCL',
  'ORLY','OTIS','OXY','PARA','PAYC','PAYX','PCAR','PCG','PEG','PEP',
  'PFE','PFG','PG','PGR','PH','PHM','PKG','PLD','PM','PNC',
  'PNR','PNW','PODD','POOL','PPG','PPL','PRU','PSA','PSX','PTC',
  'PVH','PWR','PYPL','QCOM','QRVO','RCL','REG','REGN','RF',
  'RHI','RJF','RL','RMD','ROK','ROL','ROP','ROST','RSG','RTX',
  'RVTY','SBAC','SBUX','SCHW','SEE','SHW','SJM','SLB','SMCI','SNA',
  'SNPS','SO','SOLV','SPG','SPGI','SRE','STE','STLD','STT','STX',
  'STZ','SWK','SWKS','SYF','SYK','SYY','T','TAP','TDG','TDY',
  'TECH','TEL','TER','TFC','TFX','TGT','TMUS','TPR','TRGP','TRMB',
  'TROW','TRV','TSCO','TSLA','TSN','TT','TTWO','TXN','TXT','TYL',
  'UAL','UBER','UDR','UHS','ULTA','UNH','UNP','UPS','URI','USB',
  'V','VICI','VLO','VLTO','VMC','VRSK','VRSN','VRTX','VST','VTR',
  'VTRS','VZ','WAB','WAT','WBA','WBD','WDC','WEC','WELL','WFC',
  'WM','WMB','WMT','WRB','WRK','WST','WTW','WY','WYNN','XEL',
  'XOM','XYL','YUM','ZBH','ZBRA','ZTS',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _clockCache: { isOpen: boolean; checkedAt: number } = { isOpen: false, checkedAt: 0 };

async function checkAlpacaClock(): Promise<boolean | null> {
  if (Date.now() - _clockCache.checkedAt < 1_800_000) return _clockCache.isOpen;
  try {
    const creds = loadCredentials();
    if (!creds.alpaca) return null;
    const r = await fetch(`${creds.alpaca.baseUrl}/v2/clock`, {
      headers: { 'APCA-API-KEY-ID': creds.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca.apiSecret },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json() as any;
      _clockCache = { isOpen: !!data.is_open, checkedAt: Date.now() };
      return data.is_open;
    }
  } catch {}
  return null;
}

function getMarketContext() {
  const now = new Date();
  const fmt = (opt: Intl.DateTimeFormatOptions) =>
    now.toLocaleString('en-US', { timeZone: 'America/New_York', ...opt });
  const etHour = parseInt(fmt({ hour: '2-digit', hour12: false }));
  const etMin = parseInt(fmt({ minute: '2-digit' }));
  const etDay = fmt({ weekday: 'short' });
  const isWeekday = !['Sat', 'Sun'].includes(etDay);
  const alpacaOpen = _clockCache.checkedAt > 0 ? _clockCache.isOpen : null;
  const timeBased = isWeekday && ((etHour === 9 && etMin >= 30) || (etHour >= 10 && etHour < 16));
  const isMarketOpen = alpacaOpen !== null ? alpacaOpen : timeBased;
  return { etHour, etMin, etDay, isWeekday, isMarketOpen };
}

function isCrypto(ticker: string): boolean {
  return ticker.includes('-') || ticker.includes('/') || (ticker.includes('USD') && ticker.length > 5);
}

function isShortPosition(pos: { shares: number; marketValue: number }): boolean {
  return pos.shares < 0 || pos.marketValue < 0;
}

// ─── RSI-2 Scanner ───────────────────────────────────────────────────────────

interface RSI2Signal {
  symbol: string;
  rsi2: number;
  sma200: number;
  price: number;
  action: 'buy' | 'exit' | 'short' | 'cover';
}

/**
 * Fetch daily bars for a batch of symbols and compute RSI(2) + SMA(200).
 * Returns buy signals (RSI2 < 10, price > SMA200) and exit signals (RSI2 > 70).
 */
async function scanRSI2(
  symbols: string[],
  headers: Record<string, string>,
  heldLongTickers: Set<string>,
  heldShortTickers: Set<string> = new Set(),
  researchTickers: Set<string> = new Set(),
): Promise<{ buys: RSI2Signal[]; exits: RSI2Signal[]; shorts: RSI2Signal[]; covers: RSI2Signal[]; diag: { scannedCount: number; failedCount: number; insufficientBars: number; nearMisses: Array<{ symbol: string; rsi2: number; aboveSMA: boolean }> } }> {
  const buys: RSI2Signal[] = [];
  const exits: RSI2Signal[] = [];
  const shorts: RSI2Signal[] = [];
  const covers: RSI2Signal[] = [];
  const heldTickers = new Set([...heldLongTickers, ...heldShortTickers]);

  // Batch into groups of 10 — Alpaca rate limits at ~200 req/min
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += 10) {
    batches.push(symbols.slice(i, i + 10));
  }

  let scannedCount = 0;
  let failedCount = 0;
  let insufficientBars = 0;
  const nearMisses: Array<{ symbol: string; rsi2: number; aboveSMA: boolean }> = [];

  for (const batch of batches) {
    const promises = batch.map(async (symbol) => {
      try {
        const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&limit=210&start=${startDate}T00:00:00Z`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) { failedCount++; return; }
        const data = await res.json() as any;
        const bars = data.bars || [];
        if (bars.length < 205) { insufficientBars++; return; }

        scannedCount++;
        const closes: number[] = bars.map((b: any) => b.c);
        const rsiValues = rsi(closes, RSI_PERIOD);
        const smaValues = sma(closes, SMA_PERIOD);

        if (rsiValues.length === 0 || smaValues.length === 0) return;

        const currentRSI = rsiValues[rsiValues.length - 1];
        const currentSMA = smaValues[smaValues.length - 1];
        const currentPrice = closes[closes.length - 1];
        const aboveSMA = currentPrice > currentSMA;

        // Track near-misses for diagnostics (RSI < 25)
        if (currentRSI < 25) {
          nearMisses.push({ symbol, rsi2: currentRSI, aboveSMA });
        }

        // Buy signal: RSI(2) < 10 AND price above 200-day SMA
        if (currentRSI < RSI_ENTRY && aboveSMA && !heldTickers.has(symbol)) {
          buys.push({ symbol, rsi2: currentRSI, sma200: currentSMA, price: currentPrice, action: 'buy' });
        }

        // Exit signal: RSI(2) > 70 (only for long positions we hold)
        if (currentRSI > RSI_EXIT && heldLongTickers.has(symbol)) {
          exits.push({ symbol, rsi2: currentRSI, sma200: currentSMA, price: currentPrice, action: 'exit' });
        }

        // Short signal: RSI(2) > 90 AND price BELOW 200-day SMA (broken downtrend, overbought bounce)
        if (currentRSI > RSI_SHORT_ENTRY && !aboveSMA && !heldTickers.has(symbol)) {
          shorts.push({ symbol, rsi2: currentRSI, sma200: currentSMA, price: currentPrice, action: 'short' });
        }

        // Cover signal: RSI(2) < 30 (only for short positions we hold)
        if (currentRSI < RSI_SHORT_EXIT && heldShortTickers.has(symbol)) {
          covers.push({ symbol, rsi2: currentRSI, sma200: currentSMA, price: currentPrice, action: 'cover' });
        }
      } catch { failedCount++; }
    });
    await Promise.all(promises);
    // Delay between batches — Alpaca rate limits at ~200 requests/min
    // 500ms per batch of 10 = ~20 req/sec = well within limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`  [RSI-2 DIAG] Scanned: ${scannedCount}, Failed: ${failedCount}, InsufficientBars: ${insufficientBars}`);
  if (nearMisses.length > 0) {
    console.log(`  [RSI-2 NEAR] ${nearMisses.map(n => `${n.symbol} RSI=${n.rsi2.toFixed(1)} aboveSMA=${n.aboveSMA}`).join(', ')}`);
  }

  // Sort buys: research-backed first, then most oversold
  buys.sort((a, b) => {
    const aHasStar = researchTickers.has(a.symbol) ? 0 : 1;
    const bHasStar = researchTickers.has(b.symbol) ? 0 : 1;
    if (aHasStar !== bHasStar) return aHasStar - bHasStar;
    return a.rsi2 - b.rsi2;
  });

  // Sort shorts: most overbought first (highest RSI = strongest short signal)
  shorts.sort((a, b) => b.rsi2 - a.rsi2);

  return { buys, exits, shorts, covers, diag: { scannedCount, failedCount, insufficientBars, nearMisses: nearMisses.slice(0, 10) } };
}

// ─── ORB Scanner ─────────────────────────────────────────────────────────────

interface ORBCandidate {
  symbol: string;
  prevClose: number;
  gapPct: number;
  orHigh: number;      // Opening range high (first 15 min)
  orLow: number;       // Opening range low (first 15 min)
  currentPrice: number;
  breakout: boolean;    // Price broke above OR high
}

/**
 * Find gap-up stocks (1-8%) and check if they've broken above their opening range.
 * Returns candidates sorted by gap % (controlled gaps, not blow-offs).
 */
async function scanORB(headers: Record<string, string>, heldTickers: Set<string>): Promise<ORBCandidate[]> {
  const candidates: ORBCandidate[] = [];

  // 1. Get today's movers with moderate gaps (1-8%)
  try {
    const moversRes = await fetch('https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=30', {
      headers, signal: AbortSignal.timeout(5000),
    });
    if (!moversRes.ok) return [];
    const data = await moversRes.json() as any;
    const sp500Set = new Set(SP500_UNIVERSE);
    const ALLOWED_INVERSE_ETFS = new Set(['SQQQ','SH','SPXS','SDOW','TZA','TSDD','TSLQ','FAZ','SDS','PSQ','DOG','RWM']);
    const gainers = (data.gainers || [])
      .filter((g: any) => sp500Set.has(g.symbol) || ALLOWED_INVERSE_ETFS.has(g.symbol)) // S&P 500 + inverse ETFs
      .filter((g: any) => g.percent_change >= ORB_GAP_MIN && g.percent_change <= ORB_GAP_MAX && g.price >= 10 && g.price <= 500)
      .filter((g: any) => !heldTickers.has(g.symbol))
      .slice(0, 15);

    if (gainers.length === 0) return [];

    // 2. For each gapper, get the first 15-min bar (opening range) and current price
    const symbols = gainers.map((g: any) => g.symbol);
    const today = new Date().toISOString().slice(0, 10);

    for (const g of gainers) {
      try {
        // Get 5-min bars for today to build opening range
        const barsRes = await fetch(
          `https://data.alpaca.markets/v2/stocks/${g.symbol}/bars?timeframe=5Min&start=${today}T09:30:00Z&limit=20&feed=iex`,
          { headers, signal: AbortSignal.timeout(5000) },
        );
        if (!barsRes.ok) continue;
        const barsData = await barsRes.json() as any;
        const bars = barsData.bars || [];
        if (bars.length < 3) continue; // Need at least 15 min of data (3 x 5-min bars)

        // Opening range = first 3 bars (15 minutes: 9:30-9:45)
        const orBars = bars.slice(0, 3);
        const orHigh = Math.max(...orBars.map((b: any) => b.h));
        const orLow = Math.min(...orBars.map((b: any) => b.l));

        // Current price from latest bar
        const currentBar = bars[bars.length - 1];
        const currentPrice = currentBar.c;

        // Previous close (approximate from gap)
        const prevClose = g.price / (1 + g.percent_change / 100);

        // Breakout: current price above opening range high
        const breakout = currentPrice > orHigh;

        candidates.push({
          symbol: g.symbol,
          prevClose,
          gapPct: g.percent_change,
          orHigh,
          orLow,
          currentPrice,
          breakout,
        });
      } catch {}
    }
  } catch {}

  // Sort: breakouts first, then by gap %
  candidates.sort((a, b) => {
    if (a.breakout && !b.breakout) return -1;
    if (!a.breakout && b.breakout) return 1;
    return b.gapPct - a.gapPct;
  });

  return candidates;
}

// ─── Regime Detection (SPY vs 20-day SMA) ────────────────────────────────────

interface RegimeResult {
  spyPrice: number;
  spySma20: number;
  bearish: boolean;  // SPY below 20-day SMA = weak market
}

async function detectRegime(headers: Record<string, string>): Promise<RegimeResult | null> {
  try {
    const startDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://data.alpaca.markets/v2/stocks/SPY/bars?timeframe=1Day&limit=25&start=${startDate}T00:00:00Z`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const bars = data.bars || [];
    if (bars.length < 20) return null;

    const closes = bars.map((b: any) => b.c);
    const sma20Values = sma(closes, SPY_SMA_PERIOD);
    if (sma20Values.length === 0) return null;

    const spyPrice = closes[closes.length - 1];
    const spySma20 = sma20Values[sma20Values.length - 1];

    return { spyPrice, spySma20, bearish: spyPrice < spySma20 };
  } catch { return null; }
}

// ─── Trade Engine ────────────────────────────────────────────────────────────

export class TradeEngine {
  private executor: TradeExecutor;
  private forex: ForexScanner;
  private store: GatewayStateStore;
  private hbCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private _scannedToday = '';  // Date string — RSI-2 scan once per day at 3:50 PM
  private _orbScannedToday = ''; // Date string — ORB scan once at 9:48 AM
  private _orbTrades = new Map<string, { orLow: number; orHigh: number; target: number; boughtAt: number }>(); // Active ORB positions

  // Day-scoped tracking
  private get _recentBuys(): Map<string, number> {
    try {
      const raw = this.store.get('recent_buys_today');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.date === new Date().toISOString().slice(0, 10)) return new Map(Object.entries(data.buys));
      }
    } catch {}
    return new Map();
  }

  private _trackBuy(ticker: string, price = 0, qty = 0, orderId: string | null = null, side: 'long' | 'short' = 'long'): void {
    const buys = this._recentBuys;
    buys.set(ticker, Date.now());
    const obj: Record<string, number> = {};
    for (const [k, v] of buys) obj[k] = v;
    this.store.set('recent_buys_today', JSON.stringify({ date: new Date().toISOString().slice(0, 10), buys: obj }));
    try { this.store.recordSystemBuy({ ticker, price, qty, clientOrderId: orderId, source: side === 'short' ? 'engine_short' : 'engine', side }); } catch {}
    recordTradeLot({
      ticker,
      entryPrice: price,
      qty,
      brokerOrderId: orderId,
      side,
      source: side === 'short' ? 'engine_short' : 'engine',
      metadata: { trackedBy: 'trade_engine' },
    }).catch(() => {});
  }

  private get _sessionSells(): Set<string> {
    try {
      const raw = this.store.get('session_sells_today');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.date === new Date().toISOString().slice(0, 10)) return new Set(data.tickers);
      }
    } catch {}
    return new Set();
  }

  private _addSessionSell(ticker: string): void {
    const sells = this._sessionSells;
    sells.add(ticker);
    this.store.set('session_sells_today', JSON.stringify({ date: new Date().toISOString().slice(0, 10), tickers: [...sells] }));
  }

  constructor(sharedStore?: GatewayStateStore) {
    const creds = loadCredentials();
    this.executor = new TradeExecutor({
      apiKey: creds.alpaca?.apiKey || '',
      apiSecret: creds.alpaca?.apiSecret || '',
      baseUrl: creds.alpaca?.baseUrl || 'https://paper-api.alpaca.markets',
      paperTrading: creds.alpaca?.mode !== 'live',
    });
    if (creds.oanda) {
      this.forex = new ForexScanner({ oandaApiKey: creds.oanda.apiKey, oandaAccountId: creds.oanda.accountId });
    } else {
      this.forex = new Proxy({} as any, {
        get: (_target, prop) => {
          if (prop === 'getOpenTrades') return async () => { try { const r = await fetch('http://localhost:3003/api/forex/positions'); const d = await r.json() as any; return d.positions || []; } catch { return []; } };
          if (prop === 'closePosition') return async (sym: string) => (await fetch(`http://localhost:3003/api/forex/position/${sym.replace('/', '_')}/close`, { method: 'POST' })).json();
          if (prop === 'evaluateSessionMomentum') return async () => { try { const r = await fetch('http://localhost:3003/api/forex/signals', { signal: AbortSignal.timeout(5000) }); if (r.ok) { const d = await r.json() as any; return d.signals || []; } } catch {} return []; };
          if (prop === 'fetchQuotes') return async () => { try { await fetch('http://localhost:3003/api/forex/refresh', { method: 'POST', signal: AbortSignal.timeout(5000) }); } catch {} return []; };
          if (prop === 'placeOrder') return async (inst: string, units: number, sl?: number, tp?: number) => (await fetch('http://localhost:3003/api/forex/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instrument: inst, units, stopLoss: sl, takeProfit: tp }) })).json();
          return () => {};
        }
      });
    }
    if (sharedStore) {
      this.store = sharedStore;
    } else {
      const dbPath = process.env.GATEWAY_DB_PATH || join(process.cwd(), '..', 'data', 'gateway-state.db');
      this.store = new GatewayStateStore(dbPath);
    }
    console.log(`[TE] RSI-2 Connors | ${SP500_UNIVERSE.length} stocks | $${PER_POSITION}/pos | 5% stop`);
  }

  // ── Sell ────────────────────────────────────────────────────────────────

  private async cancelOpenStopOrders(
    ticker: string,
    headers: Record<string, string>,
    baseUrl: string,
    side?: 'buy' | 'sell',
  ): Promise<number> {
    let cancelled = 0;
    try {
      const ordersRes = await fetch(`${baseUrl}/v2/orders?status=open&symbols=${ticker}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!ordersRes.ok) return 0;
      const orders = await ordersRes.json() as any[];
      for (const o of orders) {
        if (o.type !== 'stop' && !o.stop_price) continue;
        if (side && o.side !== side) continue;
        const cancelRes = await fetch(`${baseUrl}/v2/orders/${o.id}`, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
        if (cancelRes?.ok) cancelled++;
      }
    } catch {}
    return cancelled;
  }

  private async placeProtectiveStop(
    ticker: string,
    qty: number,
    side: 'buy' | 'sell',
    stopPrice: number,
    source: string,
  ): Promise<boolean> {
    const creds = loadCredentials();
    if (!creds.alpaca || qty <= 0 || !isFinite(stopPrice)) return false;
    const headers = {
      'APCA-API-KEY-ID': creds.alpaca.apiKey,
      'APCA-API-SECRET-KEY': creds.alpaca.apiSecret,
      'Content-Type': 'application/json',
    };
    try {
      const stopRes = await fetch(`${creds.alpaca.baseUrl}/v2/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          symbol: ticker,
          qty: String(qty),
          side,
          type: 'stop',
          stop_price: String(Math.round(stopPrice * 100) / 100),
          time_in_force: 'gtc',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!stopRes.ok) {
        console.log(`  [SL FAILED] ${ticker}: ${stopRes.status} ${(await stopRes.text()).slice(0, 80)}`);
        return false;
      }
      const stopOrder = await stopRes.json() as any;
      this.store.set(`stop_order_${ticker}`, JSON.stringify({
        symbol: ticker,
        qty,
        stopPrice,
        orderId: stopOrder.id,
        placedAt: new Date().toISOString(),
        source,
      }));
      this._trackStopTicker(ticker);
      console.log(`  [SL] ${ticker} ${side} stop ${qty} @$${stopPrice.toFixed(2)} — ${stopOrder.status}`);
      return true;
    } catch (e: any) {
      console.log(`  [SL ERROR] ${ticker}: ${e.message}`);
      return false;
    }
  }

  private async sellPosition(
    ticker: string,
    shares: number,
    reason: string,
    pnl: number,
    entryPrice: number | null,
    exitPrice: number,
    direction: 'long' | 'short' = 'long',
  ): Promise<boolean> {
    if (this._sessionSells.has(ticker)) {
      console.log(`  [SELL SKIP] ${ticker} already sold/queued this session — ${reason}`);
      return false;
    }

    // CORE HOLDINGS — never auto-sell or alter their protective orders
    if (CORE_HOLDINGS.has(ticker)) {
      console.log(`  [CORE] ${ticker} is a core holding — NOT selling`);
      return false;
    }

    const creds = loadCredentials();
    if (!creds.alpaca) { this.logSellAttempt(ticker, reason, pnl, 'NO_CREDS'); return false; }
    const headers = { 'APCA-API-KEY-ID': creds.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca.apiSecret };

    // Cancel protective stops before closing so Alpaca does not reject the
    // explicit close because the shares are already reserved by a GTC stop.
    await this.cancelOpenStopOrders(ticker, headers, creds.alpaca.baseUrl, direction === 'short' ? 'buy' : 'sell');

    // Try DELETE position, fallback to market sell
    let sold = false;
    let failReason = '';
    try {
      const res = await fetch(`${creds.alpaca.baseUrl}/v2/positions/${ticker}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
      if (res.ok) sold = true;
      else failReason = `DELETE ${res.status}: ${(await res.text()).slice(0, 80)}`;
    } catch (e: any) { failReason = `DELETE: ${e.message}`; }

    if (!sold) {
      try {
        const res = await fetch(`${creds.alpaca.baseUrl}/v2/orders`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: ticker, qty: String(Math.abs(shares)), side: direction === 'short' ? 'buy' : 'sell', type: 'market', time_in_force: 'day' }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) { sold = true; failReason = ''; }
        else failReason += ` | MKT ${res.status}: ${(await res.text()).slice(0, 80)}`;
      } catch (e: any) { failReason += ` | MKT: ${e.message}`; }
    }

    this.logSellAttempt(ticker, reason, pnl, sold ? 'SOLD' : failReason);

    if (sold) {
      const returnPct = entryPrice ? ((exitPrice - entryPrice) / entryPrice) * (direction === 'short' ? -1 : 1) : 0;
      console.log(`  [SELL] ${ticker} $${pnl.toFixed(2)} — ${reason}`);
      emitTradeClosed({ ticker, success: pnl > 0, returnPct, reason });
      recordClosedTrade(this.store, { ticker, direction, reason, qty: Math.abs(shares), entryPrice, exitPrice, pnl, source: 'engine_rsi2' });
      this._addSessionSell(ticker);
      this.store.set(`stop_order_${ticker}`, '');
      brain.recordTradeClose(ticker, pnl, returnPct, reason, direction).catch(() => {});
      // SONA training
      const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://trident.cetaceanlabs.com';
      const apiKey = process.env.BRAIN_API_KEY || '';
      const bh: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) bh['Authorization'] = `Bearer ${apiKey}`;
      fetch(`${BRAIN_URL}/v1/train`, { method: 'POST', headers: bh, body: JSON.stringify({
        input: `RSI2 trade: ${ticker} entry=$${entryPrice?.toFixed(2)} exit=$${exitPrice.toFixed(2)} return=${(returnPct*100).toFixed(1)}% reason=${reason}`,
        output: pnl > 0 ? 'profitable' : 'loss',
        metadata: { domain: 'rsi2:trade_outcome', ticker, pnl, returnPct, reason },
      }), signal: AbortSignal.timeout(5000) }).catch(() => {});
      await postToDiscord(`📊 SOLD ${ticker} $${pnl.toFixed(2)} — ${reason}`);
      return true;
    }

    console.log(`  [SELL FAILED] ${ticker}: ${failReason}`);
    await postToDiscord(`⚠️ SELL FAILED ${ticker} $${pnl.toFixed(2)} — ${failReason.slice(0, 100)}`);
    return false;
  }

  private logSellAttempt(ticker: string, reason: string, pnl: number, result: string): void {
    try {
      const hist = JSON.parse(this.store.get('sell_attempts') || '[]');
      hist.push({ time: new Date().toISOString(), hb: this.hbCount, ticker, reason, pnl: Math.round(pnl * 100) / 100, result });
      if (hist.length > 100) hist.splice(0, hist.length - 100);
      this.store.set('sell_attempts', JSON.stringify(hist));
    } catch {}
  }

  // ── Buy + Broker Stop ──────────────────────────────────────────────────

  private async buyPosition(symbol: string, price: number, reason: string, stopPrice?: number): Promise<boolean> {
	    const creds = loadCredentials();
	    if (!creds.alpaca) return false;
	    const alpaca = creds.alpaca;
	    const headers = { 'APCA-API-KEY-ID': alpaca.apiKey, 'APCA-API-SECRET-KEY': alpaca.apiSecret, 'Content-Type': 'application/json' };

    // Quality gate — approved owner list, S&P 500 research movers, or approved hedge ETFs.
    if (!isAutoBuyAllowedSymbol(symbol)) {
      console.log(`  [QUALITY GATE] ${symbol} not in auto-buy universe — skipping. Signal: ${reason}`);
      return false;
    }

    // Trident gate — check if SONA says avoid this ticker
    try {
      const tridentAdvice = await brain.shouldBuy(symbol, 0, reason);
      if (!tridentAdvice.should) {
        console.log(`  [TRIDENT BLOCK] ${symbol}: ${tridentAdvice.reason}`);
        return false;
      }
    } catch {
      // Trident unavailable — proceed without (don't block on failure)
    }

    // Budget gate — use available capital, not fixed PER_POSITION
    let buyAmount = PER_POSITION;
    try {
      const posCheck = await this.executor.getPositions();
      const deployed = posCheck.reduce((s, p) => s + Math.abs(p.marketValue), 0);
      const available = BUDGET_MAX - deployed;
      const MIN_BUY = 1000; // Don't waste slots on tiny positions
      if (available < MIN_BUY || available < price) {
        console.log(`  [BUY] BUDGET CAP — $${deployed.toFixed(0)} deployed, $${available.toFixed(0)} free. Skipping ${symbol}.`);
        return false;
      }
      if (posCheck.length >= MAX_POSITIONS) {
        console.log(`  [BUY] POSITION CAP — ${posCheck.length}/${MAX_POSITIONS}. Skipping ${symbol}.`);
        return false;
      }
      buyAmount = Math.min(PER_POSITION, available);
    } catch {}

    const qty = Math.floor(buyAmount / price);
    if (qty <= 0) return false;

    try {
	      const res = await fetch(`${alpaca.baseUrl}/v2/orders`, {
        method: 'POST', headers,
        body: JSON.stringify({ symbol, qty: String(qty), side: 'buy', type: 'market', time_in_force: 'day' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.log(`  [BUY] BLOCKED ${symbol}: ${res.status} ${(await res.text()).slice(0, 80)}`);
        return false;
      }
      const order = await res.json() as any;
      console.log(`  [BUY] ${qty} ${symbol} @~$${price.toFixed(2)} — ${reason} — ${order.status}`);
      this._trackBuy(symbol, price, qty, order.id ?? null);

      const effectiveStop = stopPrice ?? Math.round(price * (1 - STOP_PCT) * 100) / 100;
      try {
        const stopRes = await fetch(`${creds.alpaca.baseUrl}/v2/orders`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            symbol,
            qty: String(qty),
            side: 'sell',
            type: 'stop',
            stop_price: String(effectiveStop),
            time_in_force: 'gtc',
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (stopRes.ok) {
          const stopOrder = await stopRes.json() as any;
          this.store.set(`stop_order_${symbol}`, JSON.stringify({
            symbol,
            qty,
            stopPrice: effectiveStop,
            orderId: stopOrder.id,
            placedAt: new Date().toISOString(),
            source: 'buy',
          }));
          this._trackStopTicker(symbol);
          console.log(`  [SL] ${symbol} broker stop @$${effectiveStop.toFixed(2)} — ${stopOrder.status}`);
        } else {
          console.log(`  [SL FAILED] ${symbol}: ${stopRes.status} ${(await stopRes.text()).slice(0, 80)}`);
          await postToDiscord(`⚠️ STOP FAILED ${symbol} @$${effectiveStop.toFixed(2)} — manual review required`);
        }
      } catch (e: any) {
        console.log(`  [SL ERROR] ${symbol}: ${e.message}`);
        await postToDiscord(`⚠️ STOP ERROR ${symbol} @$${effectiveStop.toFixed(2)} — ${e.message}`);
      }

      // Trident: record buy
      brain.recordBuy(symbol, qty, price, reason).catch(() => {});

      // PG: record thesis
      try {
        const { query: pgQ } = await import('../../research-db/src/index.js');
        await pgQ(
          `INSERT INTO research_theses (symbol, direction, thesis, narrative, conviction, status, timeframe, sector, created_at, authority_action, routed_to)
           VALUES ($1, 'long', $2, $3, 0.70, 'triggered', 'swing', 'Algo', NOW(), 'act', 'TradeEngine')
           ON CONFLICT DO NOTHING`,
          [symbol, `${reason}`, `Algorithmic entry: ${reason}. Stop at $${effectiveStop.toFixed(2)}.`],
        );
      } catch {}

      await postToDiscord(`📊 BUY ${qty} ${symbol} @$${price.toFixed(2)} | ${reason} | SL @$${effectiveStop.toFixed(2)}`);
      return true;
    } catch (e: any) {
      console.log(`  [BUY] ERROR ${symbol}: ${e.message}`);
      return false;
    }
  }

  private async buyExtendedHoursLimitPosition(symbol: string, price: number, reason: string): Promise<boolean> {
    const creds = loadCredentials();
    if (!creds.alpaca || price <= 0) return false;
    const headers = { 'APCA-API-KEY-ID': creds.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca.apiSecret, 'Content-Type': 'application/json' };

    if (!isAutoBuyAllowedSymbol(symbol)) {
      console.log(`  [PREMARKET QUALITY] ${symbol} not in auto-buy universe — ${reason}`);
      return false;
    }

    try {
      const tridentAdvice = await brain.shouldBuy(symbol, 0, `PREMARKET ${reason}`);
      if (!tridentAdvice.should) {
        console.log(`  [PREMARKET TRIDENT BLOCK] ${symbol}: ${tridentAdvice.reason}`);
        return false;
      }
    } catch {}

    let buyAmount = PER_POSITION;
    try {
      const posCheck = await this.executor.getPositions();
      const deployed = posCheck.reduce((s, p) => s + Math.abs(p.marketValue), 0);
      const available = BUDGET_MAX - deployed;
      const MIN_BUY = 1000;
      if (available < MIN_BUY || available < price) {
        console.log(`  [PREMARKET BUY] BUDGET CAP — $${deployed.toFixed(0)} deployed, $${available.toFixed(0)} free. Skipping ${symbol}.`);
        return false;
      }
      if (posCheck.filter(p => !isCrypto(p.ticker)).length >= MAX_POSITIONS) {
        console.log(`  [PREMARKET BUY] POSITION CAP — skipping ${symbol}.`);
        return false;
      }
      buyAmount = Math.min(PER_POSITION, available);
    } catch {}

    const qty = Math.floor(buyAmount / price);
    if (qty <= 0) return false;
    const limitPrice = Math.round(price * (1 + PREMARKET_LIMIT_BUFFER_PCT) * 100) / 100;

    try {
      const res = await fetch(`${creds.alpaca.baseUrl}/v2/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          symbol,
          qty: String(qty),
          side: 'buy',
          type: 'limit',
          time_in_force: 'day',
          limit_price: String(limitPrice),
          extended_hours: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.log(`  [PREMARKET BUY] BLOCKED ${symbol}: ${res.status} ${(await res.text()).slice(0, 120)}`);
        return false;
      }

      const order = await res.json() as any;
      console.log(`  [PREMARKET BUY] ${qty} ${symbol} limit @$${limitPrice.toFixed(2)} — ${reason} — ${order.status}`);
      this._trackBuy(symbol, price, qty, order.id ?? null);
      this.store.set(`premarket_order_${symbol}`, JSON.stringify({
        symbol,
        qty,
        referencePrice: price,
        limitPrice,
        orderId: order.id ?? null,
        status: order.status,
        placedAt: new Date().toISOString(),
        reason,
      }));
      brain.recordBuy(symbol, qty, price, `PREMARKET ${reason}`).catch(() => {});
      await postToDiscord(`PREMARKET BUY ${qty} ${symbol} limit @$${limitPrice.toFixed(2)} | ${reason}`);
      return true;
    } catch (e: any) {
      console.log(`  [PREMARKET BUY] ERROR ${symbol}: ${e.message}`);
      return false;
    }
  }

  // ── Stop order tracking ─────────────────────────────────────────────────

  private _trackStopTicker(symbol: string): void {
    try {
      const raw = this.store.get('stop_order_tickers') || '[]';
      const tickers: string[] = JSON.parse(raw);
      if (!tickers.includes(symbol)) {
        tickers.push(symbol);
        this.store.set('stop_order_tickers', JSON.stringify(tickers));
      }
    } catch {}
  }

  // ── Fetch price ─────────────────────────────────────────────────────────

  private async fetchPrice(ticker: string): Promise<number | null> {
    const headers = getAlpacaHeaders();
    if (!headers) return null;
    try {
      const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${ticker}&feed=iex`;
      const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': headers['APCA-API-KEY-ID'], 'APCA-API-SECRET-KEY': headers['APCA-API-SECRET-KEY'] }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const d = await r.json() as any;
      return d[ticker]?.latestTrade?.p || d[ticker]?.latestQuote?.ap || null;
    } catch { return null; }
  }

  // ── Short a position ────────────────────────────────────────────────────

	  private async shortPosition(symbol: string, price: number, reason: string, maxNotional = PER_POSITION): Promise<boolean> {
	    const creds = loadCredentials();
	    if (!creds.alpaca) return false;
	    const alpaca = creds.alpaca;
	    const headers = { 'APCA-API-KEY-ID': alpaca.apiKey, 'APCA-API-SECRET-KEY': alpaca.apiSecret, 'Content-Type': 'application/json' };

    let shortAmount = PER_POSITION;
    try {
      const posCheck = await this.executor.getPositions();
      const deployed = posCheck.reduce((s, p) => s + Math.abs(p.marketValue), 0);
      const available = BUDGET_MAX - deployed;
	      if (available < MIN_SHORT_NOTIONAL || available < price) {
	        console.log(`  [SHORT] BUDGET CAP — $${deployed.toFixed(0)} deployed, $${available.toFixed(0)} free. Skipping ${symbol}.`);
	        return false;
	      }
	      shortAmount = Math.min(PER_POSITION, maxNotional, available);
    } catch {}

    const qty = Math.floor(shortAmount / price);
    if (qty <= 0) return false;

    try {
      // Sell short
	      const res = await fetch(`${alpaca.baseUrl}/v2/orders`, {
        method: 'POST', headers,
        body: JSON.stringify({ symbol, qty: String(qty), side: 'sell', type: 'market', time_in_force: 'day' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.text();
        console.log(`  [SHORT] BLOCKED ${symbol}: ${res.status} ${body.slice(0, 80)}`);
        return false;
      }
      const order = await res.json() as any;
      console.log(`  [SHORT] ${qty} ${symbol} @~$${price.toFixed(2)} — ${reason} — ${order.status}`);
      this._trackBuy(symbol, price, qty, order.id ?? null, 'short'); // track for position management

	      const stopPrice = Math.round(price * (1 + STOP_PCT) * 100) / 100;
	      try {
	        const placeShortStop = () => fetch(`${alpaca.baseUrl}/v2/orders`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              symbol,
              qty: String(qty),
              side: 'buy',
              type: 'stop',
              stop_price: String(stopPrice),
              time_in_force: 'gtc',
            }),
            signal: AbortSignal.timeout(10_000),
          });
	        let stopRes = await placeShortStop();
          if (!stopRes.ok) {
            const firstBody = await stopRes.text();
            console.log(`  [SHORT SL RETRY] ${symbol}: ${stopRes.status} ${firstBody.slice(0, 80)}`);
            await new Promise(r => setTimeout(r, 1500));
            stopRes = await placeShortStop();
          }
	        if (stopRes.ok) {
	          const stopOrder = await stopRes.json() as any;
	          this.store.set(`stop_order_${symbol}`, JSON.stringify({
            symbol,
            qty,
            stopPrice,
            orderId: stopOrder.id,
            placedAt: new Date().toISOString(),
            source: 'short',
          }));
          this._trackStopTicker(symbol);
          console.log(`  [SHORT SL] ${symbol} broker buy-stop @$${stopPrice.toFixed(2)} — ${stopOrder.status}`);
        } else {
          console.log(`  [SHORT SL FAILED] ${symbol}: ${stopRes.status} ${(await stopRes.text()).slice(0, 80)}`);
          await postToDiscord(`⚠️ SHORT STOP FAILED ${symbol} @$${stopPrice.toFixed(2)} — manual review required`);
        }
      } catch (e: any) {
        console.log(`  [SHORT SL ERROR] ${symbol}: ${e.message}`);
        await postToDiscord(`⚠️ SHORT STOP ERROR ${symbol} @$${stopPrice.toFixed(2)} — ${e.message}`);
      }

      brain.recordBuy(symbol, qty, price, `SHORT ${reason}`).catch(() => {});

      // PG thesis
      try {
        const { query: pgQ } = await import('../../research-db/src/index.js');
        await pgQ(
          `INSERT INTO research_theses (symbol, direction, thesis, narrative, conviction, status, timeframe, sector, created_at, authority_action, routed_to)
           VALUES ($1, 'short', $2, $3, 0.70, 'triggered', 'swing', 'Algo', NOW(), 'act', 'TradeEngine')
           ON CONFLICT DO NOTHING`,
          [symbol, `RSI-2 SHORT: ${reason}`, `Connors RSI-2 short signal. Stock is overbought (${reason}) in a downtrend below SMA(200). Expected pullback in 2-3 days.`],
        );
      } catch {}

      await postToDiscord(`📉 SHORT ${qty} ${symbol} @$${price.toFixed(2)} | ${reason}`);
      return true;
    } catch (e: any) {
      console.log(`  [SHORT] ERROR ${symbol}: ${e.message}`);
      return false;
    }
  }

  // ── Forex ──────────────────────────────────────────────────────────────

  private async manageForex(): Promise<void> {
    try {
      const trades = await this.forex.getOpenTrades();
      for (const t of trades) {
        const pl = parseFloat(t.unrealizedPL || '0');
        if (pl >= FOREX_BANK || pl < FOREX_CUT) {
          const sym = t.instrument.replace('_', '/');
          try {
            await this.forex.closePosition(sym);
            const dir = parseInt(t.currentUnits) > 0 ? 'long' : 'short';
            const reason = pl >= FOREX_BANK ? 'take_profit' : 'stop_loss';
            this.store.recordTrade({ ticker: sym, pnl: pl, direction: dir, reason, openedAt: '', closedAt: new Date().toISOString() });
            emitTradeClosed({ ticker: sym, success: pl > 0, returnPct: pl / 100, reason });
            brain.recordTradeClose(sym, pl, pl / 100, reason, dir).catch(() => {});
            console.log(`  [FX] ${pl >= FOREX_BANK ? 'BANKED' : 'CUT'} ${sym} $${pl.toFixed(2)}`);
          } catch {}
        }
      }
    } catch {}

    // Forex entries
    try {
      await this.forex.fetchQuotes();
      const signals = await this.forex.evaluateSessionMomentum();
      if (signals.length > 0) {
        const open = await this.forex.getOpenTrades();
        if (open.length < 4) {
          for (const sig of signals.sort((a: any, b: any) => b.confidence - a.confidence)) {
            try {
              await this.forex.placeOrder(sig.symbol, sig.direction === 'long' ? 25000 : -25000, sig.stopLoss, sig.takeProfit);
              console.log(`  [FX] ${sig.direction.toUpperCase()} ${sig.symbol}`);
              break;
            } catch {}
          }
        }
      }
    } catch {}
  }

  // ── THE HEARTBEAT ──────────────────────────────────────────────────────

  private async heartbeat(): Promise<void> {
    if (this.stopping) return;
    this.hbCount++;
    const t0 = Date.now();
    await checkAlpacaClock();
    const mkt = getMarketContext();
    const today = new Date().toISOString().slice(0, 10);

    console.log(`\n[TE] === #${this.hbCount} === ${mkt.etDay} ${mkt.etHour}:${String(mkt.etMin).padStart(2, '0')} ET — ${mkt.isMarketOpen ? 'OPEN' : 'CLOSED'}`);

    // ── 0. RECONCILE ─────────────────────────────────────────────────
    try {
      const creds = loadCredentials();
      if (creds.alpaca) {
        const rec = await reconcileWithAlpaca(this.store, { apiKey: creds.alpaca.apiKey, apiSecret: creds.alpaca.apiSecret, baseUrl: creds.alpaca.baseUrl }, 3);
        if (rec.buysRecorded > 0 || rec.sellsRecorded > 0) console.log(`  [RECON] +${rec.buysRecorded} buys, +${rec.sellsRecorded} sells`);
      }
    } catch {}

    // ── 1. CIRCUIT BREAKER — blocks buys only, not exits ─────────────
    let dayPnl = 0;
    // Circuit breaker DISABLED — broker stop orders are the real protection.
    // The CB was blocking all trading for days straight, preventing the RSI-2
    // and ORB strategies from ever executing. Broker stops cap losses per position.
    const circuitBreakerTripped = false;
    try {
      const creds = loadCredentials();
      if (creds.alpaca) {
        const acctRes = await fetch(`${creds.alpaca.baseUrl}/v2/account`, {
          headers: { 'APCA-API-KEY-ID': creds.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca.apiSecret },
          signal: AbortSignal.timeout(5000),
        });
        if (acctRes.ok) {
          const a = await acctRes.json() as any;
          dayPnl = parseFloat(a.equity) - parseFloat(a.last_equity);
        }
      }
    } catch {}
    console.log(`  [P&L] Day: $${dayPnl.toFixed(2)}`);

    // ── 2. FOREX ─────────────────────────────────────────────────────
    await this.manageForex();

    // ── 3. GET POSITIONS + RETROFIT STOPS on unprotected positions ───
    const positions = await this.executor.getPositions();
    const equityPos = positions.filter(p => !isCrypto(p.ticker));
    const totalDeployed = equityPos.reduce((s, p) => s + Math.abs(p.marketValue), 0);

    // Clean stale stop_order keys for positions we no longer hold.
    const heldTickers = new Set(equityPos.map(p => p.ticker));
    try {
      const trackedRaw = this.store.get('stop_order_tickers') || '[]';
      const tracked: string[] = JSON.parse(trackedRaw);
      const cleaned: string[] = [];
      for (const sym of tracked) {
        if (!heldTickers.has(sym) && this.store.get(`stop_order_${sym}`)) {
          this.store.set(`stop_order_${sym}`, '');
          cleaned.push(sym);
        }
      }
      // Update tracked list to only held tickers
      if (cleaned.length > 0) {
        const remaining = tracked.filter(t => heldTickers.has(t));
        this.store.set('stop_order_tickers', JSON.stringify(remaining));
        console.log(`  [STOP CLEANUP] Cleared ${cleaned.length} stale keys: ${cleaned.join(', ')}`);
      }
    } catch {}

    // ── 3b. AUTO-STOP — ensure every position has a broker stop order ────
    try {
      const creds2 = loadCredentials();
	      if (creds2.alpaca) {
	        const hdrs = { 'APCA-API-KEY-ID': creds2.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds2.alpaca.apiSecret };
        const ordRes = await fetch(`${creds2.alpaca.baseUrl}/v2/orders?status=open&limit=500`, {
          headers: hdrs, signal: AbortSignal.timeout(5000),
        });
	        if (ordRes.ok) {
	          const openOrders = await ordRes.json() as any[];
	          const stopsBy = new Set(
	            openOrders
	              .filter((o: any) => (o.type === 'stop' || o.stop_price))
	              .map((o: any) => `${o.symbol.toUpperCase()}:${o.side}`),
	          );
	          for (const pos of equityPos) {
	            const stopSide = pos.shares < 0 ? 'buy' : 'sell';
	            const wrongStopSide = pos.shares < 0 ? 'sell' : 'buy';
	            if (stopsBy.has(`${pos.ticker}:${stopSide}`)) continue;
	            const cancelledWrongSide = await this.cancelOpenStopOrders(pos.ticker, hdrs, creds2.alpaca.baseUrl, wrongStopSide);
	            if (cancelledWrongSide > 0) {
	              console.log(`  [AUTO-STOP] ${pos.ticker} canceled ${cancelledWrongSide} wrong-side ${wrongStopSide} stop(s)`);
	            }
	            const stopPrice = Math.round(pos.avgPrice * (pos.shares < 0 ? 1 + STOP_PCT : 1 - STOP_PCT) * 100) / 100;
	            console.log(`  [AUTO-STOP] ${pos.ticker} missing broker stop — placing ${stopSide} stop @$${stopPrice.toFixed(2)}`);
	            await this.placeProtectiveStop(pos.ticker, Math.abs(pos.shares), stopSide, stopPrice, 'auto_heartbeat');
	          }
	        }
      }
    } catch (e: any) {
      console.log(`  [AUTO-STOP ERR] ${e.message}`);
    }

    // ── 3c. WATCHLIST REBUY ALERTS — monitor sold stocks for re-entry ────
    if (WATCHLIST_REBUY.size > 0) {
      try {
        const watchSyms = [...WATCHLIST_REBUY.keys()].filter(s => !heldTickers.has(s)).join(',');
        if (watchSyms) {
          const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${watchSyms}&feed=iex`, {
            headers: (() => { const c = loadCredentials(); return { 'APCA-API-KEY-ID': c.alpaca?.apiKey || '', 'APCA-API-SECRET-KEY': c.alpaca?.apiSecret || '' }; })(),
            signal: AbortSignal.timeout(5000),
          });
          if (snapRes.ok) {
            const snaps = await snapRes.json() as any;
            const alertKey = `watchlist_alert_${today}`;
            const alerted = new Set((this.store.get(alertKey) || '').split(',').filter(Boolean));
            for (const [sym, maxPrice] of WATCHLIST_REBUY) {
              const price = snaps[sym]?.latestTrade?.p;
              if (price && price <= maxPrice && !alerted.has(sym)) {
                console.log(`  [WATCH] ${sym} hit rebuy zone: $${price.toFixed(2)} <= $${maxPrice.toFixed(2)}`);
                await postToDiscord(`👀 WATCHLIST: ${sym} at $${price.toFixed(2)} — below rebuy target $${maxPrice.toFixed(2)}`);
                alerted.add(sym);
                this.store.set(alertKey, [...alerted].join(','));
              }
            }
          }
        }
      } catch {}
    }

    // ── 3d. CORE REINFORCEMENT — auto-add to high-scoring core holdings ──
    // When deep research scores a core holding >= 90 and there's free capital,
    // consult Trident and add to the position automatically. Records every
    // decision (buy or skip) to Trident for pattern learning.
    if (mkt.isMarketOpen && CORE_HOLDINGS.size > 0) {
      const reinforceKey = `core_reinforce_${today}`;
      const reinforced = new Set((this.store.get(reinforceKey) || '').split(',').filter(Boolean));

      for (const ticker of CORE_HOLDINGS) {
        if (reinforced.has(ticker)) continue; // already checked today
        const pos = equityPos.find(p => p.ticker === ticker);
        if (!pos) continue; // not held — skip

        try {
          const { deepResearchTicker } = await import('./analysts/deep-research.js');
          const profile = await deepResearchTicker(ticker);
          if (!profile || profile.fundamentalScore < 90) {
            reinforced.add(ticker);
            this.store.set(reinforceKey, [...reinforced].join(','));
            continue;
          }

          // Check free budget
          const currentDeployed = equityPos.reduce((s, p) => s + Math.abs(p.marketValue), 0);
          const freeCapital = BUDGET_MAX - currentDeployed;
          if (freeCapital < PER_POSITION) {
            console.log(`  [CORE REINFORCE] ${ticker} score=${profile.fundamentalScore} but no free capital ($${freeCapital.toFixed(0)})`);
            reinforced.add(ticker);
            this.store.set(reinforceKey, [...reinforced].join(','));
            continue;
          }

          // Consult Trident
          const tridentAdvice = await brain.shouldBuy(ticker, 0, `core_reinforce: score=${profile.fundamentalScore}, target=$${profile.analystTargetMean?.toFixed(2)}`);
          if (!tridentAdvice.should) {
            console.log(`  [CORE REINFORCE] ${ticker} score=${profile.fundamentalScore} — Trident says NO: ${tridentAdvice.reason}`);
            brain.recordRule(
              `CORE REINFORCE SKIP: ${ticker} score=${profile.fundamentalScore} — Trident blocked: ${tridentAdvice.reason}`,
              'autonomous_decision',
            ).catch(() => {});
            reinforced.add(ticker);
            this.store.set(reinforceKey, [...reinforced].join(','));
            continue;
          }

          // Add to position
          const price = pos.currentPrice;
          const addQty = Math.floor(PER_POSITION / price);
          if (addQty <= 0) continue;

          // Cancel existing stop, buy more, re-place stop
          const creds3 = loadCredentials();
          if (!creds3.alpaca) continue;
          const hdrs3 = { 'APCA-API-KEY-ID': creds3.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds3.alpaca.apiSecret, 'Content-Type': 'application/json' };
          await this.cancelOpenStopOrders(ticker, hdrs3, creds3.alpaca.baseUrl, 'sell');

          const buyRes = await fetch(`${creds3.alpaca.baseUrl}/v2/orders`, {
            method: 'POST', headers: hdrs3,
            body: JSON.stringify({ symbol: ticker, qty: String(addQty), side: 'buy', type: 'market', time_in_force: 'day' }),
            signal: AbortSignal.timeout(10_000),
          });

          if (buyRes.ok) {
            console.log(`  [CORE REINFORCE] ${ticker} +${addQty} shares — score=${profile.fundamentalScore}, Trident approved`);
            await postToDiscord(`🏗️ CORE REINFORCE: Added ${addQty} ${ticker} — fundamental score ${profile.fundamentalScore}/100, analyst target $${profile.analystTargetMean?.toFixed(2)}`);
            this._trackBuy(ticker, price, addQty, ((await buyRes.json()) as any).id ?? null);

            // Re-place stop on full position after brief settle
            await new Promise(r => setTimeout(r, 1500));
            try {
              const updatedPos = await this.executor.getPositions();
              const newPos = updatedPos.find(p => p.ticker === ticker);
              if (newPos) {
                const newStop = Math.round(newPos.avgPrice * (1 - STOP_PCT) * 100) / 100;
                await this.placeProtectiveStop(ticker, Math.abs(newPos.shares), 'sell', newStop, 'core_reinforce');
              }
            } catch {}

            // Record to Trident for learning
            brain.recordRule(
              `CORE REINFORCE BUY: ${ticker} +${addQty}@$${price.toFixed(2)} — score=${profile.fundamentalScore}, target=$${profile.analystTargetMean?.toFixed(2)}, ${profile.recommendationKey}, ${profile.analystCount} analysts, ${profile.recentUpgrades} upgrades`,
              'autonomous_decision',
            ).catch(() => {});
          } else {
            console.log(`  [CORE REINFORCE] ${ticker} buy failed: ${(await buyRes.text()).slice(0, 80)}`);
          }

          reinforced.add(ticker);
          this.store.set(reinforceKey, [...reinforced].join(','));
        } catch (e: any) {
          console.log(`  [CORE REINFORCE ERR] ${ticker}: ${e.message}`);
          reinforced.add(ticker);
          this.store.set(reinforceKey, [...reinforced].join(','));
        }
      }
    }

    // Detect manual sells: if a position we knew about is now gone, add to session sells
    // This prevents the engine from rebuying something you manually sold
    try {
      const lastSnapshot = this.store.get('positions_snapshot');
      if (lastSnapshot) {
        const prev = JSON.parse(lastSnapshot);
        const prevTickers = (prev.positions || []).map((p: string) => p.split(':')[0].trim());
        const currentTickers = new Set(equityPos.map(p => p.ticker));
        for (const ticker of prevTickers) {
          if (ticker && !currentTickers.has(ticker) && !this._sessionSells.has(ticker)) {
            console.log(`  [MANUAL SELL DETECTED] ${ticker} — adding to session sells, won't rebuy`);
            this._addSessionSell(ticker);
          }
        }
      }
    } catch {}

    console.log(`  [POS] ${equityPos.length} equity | $${totalDeployed.toFixed(0)} | Day: $${dayPnl.toFixed(2)}`);
    const posLog: string[] = [];
    for (const p of equityPos) {
      const line = `${p.ticker}: $${p.unrealizedPnl.toFixed(2)} (${p.unrealizedPnlPercent.toFixed(1)}%)`;
      console.log(`    ${line}`);
      posLog.push(line);
    }
    this.store.set('positions_snapshot', JSON.stringify({ hb: this.hbCount, time: new Date().toISOString(), count: equityPos.length, positions: posLog }));

    // ── 4a. $100 HEARTBEAT STOP — primary active stop while AWB is running ──
    for (const pos of equityPos) {
      if (CORE_HOLDINGS.has(pos.ticker)) continue;
      if (pos.unrealizedPnl < 0 && Math.abs(pos.unrealizedPnl) >= DOLLAR_STOP_LOSS) {
        console.log(`  [$100 STOP] ${pos.ticker} -$${Math.abs(pos.unrealizedPnl).toFixed(0)} — SELLING`);
        await this.sellPosition(pos.ticker, pos.shares, 'stop_loss_$100', pos.unrealizedPnl, pos.avgPrice, pos.currentPrice);
      }
    }

    // ── 4b. $500 TAKE PROFIT — sell HALF, only during market hours ──
    if (mkt.isMarketOpen && mkt.etHour >= 10 && (mkt.etHour < 15 || (mkt.etHour === 15 && mkt.etMin < 30))) {
    for (const pos of equityPos) {
      if (CORE_HOLDINGS.has(pos.ticker)) continue;
      const tpKey = `took_profit_${pos.ticker}_${today}`;
      if (pos.unrealizedPnl >= HALF_PROFIT_TRIGGER && !this.store.get(tpKey)) {
        const halfQty = Math.floor(Math.abs(pos.shares) / 2);
        if (halfQty > 0) {
          const creds3 = loadCredentials();
          if (creds3.alpaca) {
            try {
              const tpHeaders = { 'APCA-API-KEY-ID': creds3.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds3.alpaca.apiSecret };
              // Cancel protective stops FIRST — shares are held_for_orders until stops are cancelled
              await this.cancelOpenStopOrders(pos.ticker, tpHeaders, creds3.alpaca.baseUrl, 'sell');
              console.log(`  [TAKE PROFIT] ${pos.ticker} +$${pos.unrealizedPnl.toFixed(0)} — selling HALF (${halfQty} of ${Math.abs(pos.shares)}), rest rides with $100 stop`);
              const tpRes = await fetch(`${creds3.alpaca.baseUrl}/v2/orders`, {
                method: 'POST',
                headers: { ...tpHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: pos.ticker, qty: String(halfQty), side: 'sell', type: 'market', time_in_force: 'day' }),
                signal: AbortSignal.timeout(10_000),
              });
              if (tpRes.ok) {
                let orderId: string | null = null;
                try {
                  const order = await tpRes.json() as any;
                  orderId = order?.id ?? null;
                } catch {}
                this.store.set(tpKey, new Date().toISOString());
                console.log(`  [TAKE PROFIT] ${pos.ticker} — sold ${halfQty} shares`);
                recordClosedTrade(this.store, {
                  ticker: pos.ticker,
                  direction: 'long',
                  reason: 'take_profit_half_$500',
                  qty: halfQty,
                  entryPrice: pos.avgPrice,
                  exitPrice: pos.currentPrice,
                  pnl: pos.unrealizedPnl * (halfQty / Math.abs(pos.shares)),
                  source: 'engine_take_profit',
                  orderId,
                });
                // Re-place stop for remaining shares
                const remainingQty = Math.abs(pos.shares) - halfQty;
                if (remainingQty > 0) {
                  await this.placeProtectiveStop(
                    pos.ticker,
                    remainingQty,
                    'sell',
                    pos.avgPrice * (1 - STOP_PCT),
                    'take_profit_resize',
                  );
                }
                await postToDiscord(`TAKE PROFIT: sold half of ${pos.ticker} (+$${pos.unrealizedPnl.toFixed(0)}) — ${halfQty} shares, rest rides`);
              } else {
                const errBody = await tpRes.text().catch(() => '');
                console.error(`  [TAKE PROFIT FAILED] ${pos.ticker}: ${tpRes.status} ${errBody.slice(0, 100)}`);
                // Mark as attempted so we don't spam retries — will retry next day
                this.store.set(tpKey, `failed:${new Date().toISOString()}`);
              }
            } catch (e: any) {
              console.error(`  [TAKE PROFIT ERROR] ${pos.ticker}: ${e.message}`);
              this.store.set(tpKey, `error:${new Date().toISOString()}`);
            }
          }
        }
      }
    }
    } // end take-profit market hours gate

    // ── 4b2. REINVEST IN WINNERS — after take-profit frees capital ────────
    // After take-profit sells half, reinvest freed capital into the best
    // performing held position. Cancel stops → buy → re-place stops.
    // Excludes tickers sold today (Alpaca wash trade protection).
    if (mkt.isMarketOpen && mkt.etHour >= 10 && mkt.etHour < 15) {
      const reinvestKey = `reinvested_${today}`;
      if (!this.store.get(reinvestKey)) {
        const tookProfitToday = equityPos.filter(p => {
          const tpKey = `took_profit_${p.ticker}_${today}`;
          const val = this.store.get(tpKey);
          return val && !val.startsWith('failed') && !val.startsWith('error');
        });

        if (tookProfitToday.length > 0) {
          const soldToday = new Set(tookProfitToday.map(p => p.ticker));
          const bestPerformer = [...equityPos]
            .filter(p => p.unrealizedPnlPercent > 2 && !soldToday.has(p.ticker))
            .sort((a, b) => b.unrealizedPnlPercent - a.unrealizedPnlPercent)[0];

          if (bestPerformer) {
            const currentDeployed = equityPos.reduce((s, p) => s + Math.abs(p.marketValue), 0);
            const available = BUDGET_MAX - currentDeployed;
            const reinvestAmount = Math.min(available, PER_POSITION / 2);

            if (reinvestAmount >= 1000) {
              const addQty = Math.floor(reinvestAmount / bestPerformer.currentPrice);
              if (addQty > 0) {
                const creds4 = loadCredentials();
                if (creds4.alpaca) {
                  const hdr = { 'APCA-API-KEY-ID': creds4.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds4.alpaca.apiSecret };
                  try {
                    // Cancel stops → buy → re-place stops (same pattern as take-profit)
                    await this.cancelOpenStopOrders(bestPerformer.ticker, hdr, creds4.alpaca.baseUrl, 'sell');
                    console.log(`  [REINVEST] Adding ${addQty} ${bestPerformer.ticker} (+${bestPerformer.unrealizedPnlPercent.toFixed(1)}%) — $${(addQty * bestPerformer.currentPrice).toFixed(0)}`);
                    const addRes = await fetch(`${creds4.alpaca.baseUrl}/v2/orders`, {
                      method: 'POST',
                      headers: { ...hdr, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ symbol: bestPerformer.ticker, qty: String(addQty), side: 'buy', type: 'market', time_in_force: 'day' }),
                      signal: AbortSignal.timeout(10_000),
                    });
                    if (addRes.ok) {
                      this.store.set(reinvestKey, `${bestPerformer.ticker}:${addQty}:${new Date().toISOString()}`);
                      this._trackBuy(bestPerformer.ticker, bestPerformer.currentPrice, addQty);
                      console.log(`  [REINVEST] ${bestPerformer.ticker} — bought ${addQty} shares`);
                      // Re-place stop for entire position (old + new shares)
                      const totalQty = Math.abs(bestPerformer.shares) + addQty;
                      await this.placeProtectiveStop(bestPerformer.ticker, totalQty, 'sell', bestPerformer.avgPrice * (1 - STOP_PCT), 'reinvest_stop');
                      await postToDiscord(`REINVEST: +${addQty} ${bestPerformer.ticker} (+${bestPerformer.unrealizedPnlPercent.toFixed(1)}%) — concentrating on strength`);
                    } else {
                      const errBody = await addRes.text().catch(() => '');
                      console.error(`  [REINVEST FAILED] ${bestPerformer.ticker}: ${addRes.status} ${errBody.slice(0, 150)}`);
                      // Re-place the stop we cancelled even if buy failed
                      await this.placeProtectiveStop(bestPerformer.ticker, Math.abs(bestPerformer.shares), 'sell', bestPerformer.avgPrice * (1 - STOP_PCT), 'reinvest_restore');
                      this.store.set(reinvestKey, `failed:${new Date().toISOString()}`);
                    }
                  } catch (e: any) {
                    console.error(`  [REINVEST ERROR] ${bestPerformer.ticker}: ${e.message}`);
                    this.store.set(reinvestKey, `error:${new Date().toISOString()}`);
                  }
                }
              }
            }
          }
        }
      }
    }

    // ── 4c. CLOSE ALL SHORTS BEFORE CLOSE — no overnight short exposure ──
    if (mkt.isMarketOpen && mkt.etHour === 15 && mkt.etMin >= 45) {
      for (const pos of equityPos) {
        if (isShortPosition(pos)) {
          console.log(`  [EOD SHORT CLOSE] ${pos.ticker} — closing short before overnight`);
          await this.sellPosition(pos.ticker, Math.abs(pos.shares), 'eod_close_short', pos.unrealizedPnl, pos.avgPrice, pos.currentPrice, 'short');
        }
      }
    }

    // ── 5. TIME STOP — sell positions held > 5 days ──────────────────
    for (const pos of equityPos) {
      const buyTime = this._recentBuys.get(pos.ticker);
      if (buyTime) {
        const heldDays = (Date.now() - buyTime) / (24 * 60 * 60 * 1000);
        if (heldDays >= MAX_HOLD_DAYS) {
          console.log(`  [TIME STOP] ${pos.ticker} held ${heldDays.toFixed(1)} days — selling`);
          await this.sellPosition(pos.ticker, pos.shares, `time_stop_${Math.round(heldDays)}d`, pos.unrealizedPnl, pos.avgPrice, pos.currentPrice);
        }
      }
    }

    // Common headers for all trading sections
    const creds = loadCredentials();
    const alpacaHeaders = { 'APCA-API-KEY-ID': creds.alpaca?.apiKey || '', 'APCA-API-SECRET-KEY': creds.alpaca?.apiSecret || '' };

    // ── 5a. MORNING PREP (8:00-9:25 AM ET) — unified pipeline ──────────
    // Reads: last night's RSI-2 scan + research worker catalysts + pre-market snapshots.
    // Re-runs every 15 minutes so startup ordering cannot permanently miss stars
    // populated by the 7:00/8:00/8:30 research jobs.
    const isPreMarket = mkt.isWeekday && mkt.etHour >= 8 && (mkt.etHour < 9 || (mkt.etHour === 9 && mkt.etMin <= 25));
    const preMarketSlotMin = Math.floor(mkt.etMin / 15) * 15;
    const preMarketKey = `premarket_scan_${today}_${mkt.etHour}${String(preMarketSlotMin).padStart(2, '0')}`;
    const preMarketLatestKey = `premarket_scan_${today}`;

    if (ENABLE_MORNING_PREP && isPreMarket && !this.store.get(preMarketKey)) {
      this.store.set(preMarketKey, 'running');
      console.log(`  [MORNING PREP] Unified pipeline slot ${mkt.etHour}:${String(preMarketSlotMin).padStart(2, '0')} — RSI-2 + research stars + pre-market snapshots`);

      try {
        const sp500Set = new Set(SP500_UNIVERSE);
        const PREP_ALLOWED_ETFS = new Set(['SQQQ','SH','SPXS','SDOW','TZA','GLD','SLV','TSDD','TSLQ','FAZ','SDS','PSQ']);
        const isAllowedSymbol = (sym: string) => sp500Set.has(sym) || PREP_ALLOWED_ETFS.has(sym) || APPROVED_TICKERS.has(sym);
        const heldSet = new Set(equityPos.map(p => p.ticker));

        // SOURCE 1: Last night's RSI-2 scan signals
        const rsi2Signals: Array<{ symbol: string; rsi2: number; price: number }> = [];
        try {
          const scanRaw = this.store.get('rsi2_scan');
          if (scanRaw) {
            const scan = JSON.parse(scanRaw);
            for (const b of (scan.buys || [])) {
              if (isAllowedSymbol(b.symbol) && !heldSet.has(b.symbol)) {
                rsi2Signals.push({ symbol: b.symbol, rsi2: b.rsi2, price: b.price });
              }
            }
          }
        } catch {}
        console.log(`  [PREP] RSI-2 signals from last close: ${rsi2Signals.length} (${rsi2Signals.slice(0, 5).map(s => `${s.symbol} RSI=${s.rsi2.toFixed(1)}`).join(', ')})`);

        // SOURCE 2: Research worker catalysts (overnight news)
        const researchStars = new Map<string, { catalyst: string; score: number; sector: string; createdAt?: string }>();
        try {
          const stars = await getActiveResearchStars({ includeRelated: true });
          for (const s of stars) {
            if (
              isAllowedSymbol(s.symbol) &&
              (s.sector || '') !== 'short_candidate' &&
              s.score >= PREMARKET_MIN_STAR_SCORE
            ) {
              const existing = researchStars.get(s.symbol);
              if (!existing || s.score > existing.score) {
                researchStars.set(s.symbol, {
                  catalyst: s.catalyst || '',
                  score: s.score,
                  sector: s.sector || '',
                  createdAt: s.createdAt,
                });
              }
            }
          }
        } catch {}
        console.log(`  [PREP] Research catalysts: ${researchStars.size} (S&P 500 + ETFs)`);

        // SOURCE 3: Pre-market snapshots — check which signals are confirming
        // Scan RSI-2 signals + top research stars for pre-market movement
        const checkSymbols = new Set([...rsi2Signals.map(s => s.symbol), ...researchStars.keys()]);
        const confirmedBuys: Array<{ symbol: string; price: number; preMarketPct: number; hasRSI2: boolean; hasCatalyst: boolean; rsi2: number; score: number; reason: string }> = [];

        const checkList = [...checkSymbols].filter(s => !heldSet.has(s) && !this._sessionSells.has(s) && !this._recentBuys.has(s));
        for (let i = 0; i < checkList.length; i += 30) {
          const batch = checkList.slice(i, i + 30).join(',');
          try {
            const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${batch}&feed=iex`, {
              headers: alpacaHeaders, signal: AbortSignal.timeout(8000),
            });
            if (!snapRes.ok) continue;
            const snapData = await snapRes.json() as any;
            for (const [sym, snap] of Object.entries(snapData) as any) {
              const price = snap?.latestQuote?.ap || snap?.latestTrade?.p || snap?.latestQuote?.bp;
              const prevClose = snap?.prevDailyBar?.c;
              if (!price || !prevClose || price < 10) continue;
              const pctChange = ((price - prevClose) / prevClose) * 100;

              const hasRSI2 = rsi2Signals.some(s => s.symbol === sym);
              const star = researchStars.get(sym);
              const hasCatalyst = !!star;
              const rsi2Val = rsi2Signals.find(s => s.symbol === sym)?.rsi2 ?? 50;
              const score = star?.score ?? 0;

              // Build reason string
              const reasons: string[] = [];
              if (hasRSI2) reasons.push(`RSI2=${rsi2Val.toFixed(1)}`);
              if (hasCatalyst) reasons.push(`${star!.sector}:${star!.catalyst.slice(0, 40)}`);
              if (pctChange > 0) reasons.push(`premarket+${pctChange.toFixed(1)}%`);
              if (score > 0) reasons.push(`score=${score.toFixed(2)}`);

              // Act on research-backed early movers. RSI-2-only buys remain disabled.
              if (hasCatalyst && pctChange >= PREMARKET_MIN_MOVE_PCT && pctChange <= PREMARKET_MAX_CHASE_PCT) {
                confirmedBuys.push({ symbol: sym, price, preMarketPct: pctChange, hasRSI2, hasCatalyst, rsi2: rsi2Val, score, reason: reasons.join(' | ') });
              }
            }
          } catch {}
          await new Promise(r => setTimeout(r, 300));
        }

        // Sort: strongest research first, then confirmed move size.
        confirmedBuys.sort((a, b) => {
          const aRank = a.score + (a.hasRSI2 ? 0.03 : 0);
          const bRank = b.score + (b.hasRSI2 ? 0.03 : 0);
          if (aRank !== bRank) return bRank - aRank;
          return b.preMarketPct - a.preMarketPct;
        });

        console.log(`  [PREP] Confirmed buys: ${confirmedBuys.length}`);
        for (const b of confirmedBuys.slice(0, 8)) {
          console.log(`    ${b.symbol}: ${b.reason}`);
        }

        // Place extended-hours limit orders for top picks so we can catch the early move.
        // The heartbeat auto-stop loop places broker stops as soon as positions appear.
        let placed = 0;
        for (const b of confirmedBuys) {
          if (placed >= MAX_POSITIONS - equityPos.length) break;
          if (placed >= PREMARKET_MAX_ORDERS_PER_RUN) break;
          if (!isAutoBuyAllowedSymbol(b.symbol)) {
            console.log(`  [MORNING SKIP] ${b.symbol} not in auto-buy universe — ${b.reason}`);
            continue;
          }
          const bought = await this.buyExtendedHoursLimitPosition(b.symbol, b.price, b.reason);
          if (bought) placed++;
        }

        const summary = JSON.stringify({
          time: new Date().toISOString(),
          slot: `${mkt.etHour}:${String(preMarketSlotMin).padStart(2, '0')}`,
          rsi2Signals: rsi2Signals.length,
          catalysts: researchStars.size,
          confirmed: confirmedBuys.length,
          placed,
          picks: confirmedBuys.slice(0, 10).map(b => `${b.symbol}(${b.reason.slice(0, 40)})`),
        });
        this.store.set(preMarketKey, summary);
        this.store.set(preMarketLatestKey, summary);

        brain.recordRule(
          `MORNING PREP ${today} ${mkt.etHour}:${String(preMarketSlotMin).padStart(2, '0')}: ${rsi2Signals.length} RSI-2 signals + ${researchStars.size} catalysts → ${confirmedBuys.length} confirmed → ${placed} placed. Top: ${confirmedBuys.slice(0, 5).map(b => `${b.symbol}(${b.reason.slice(0, 30)})`).join(', ')}`,
          'morning:prep',
        ).catch(() => {});

        if (placed > 0) {
          await postToDiscord(`MORNING PREP: ${placed} pre-market limit orders — ${confirmedBuys.slice(0, placed).map(b => `${b.symbol} ${b.reason.slice(0, 30)}`).join(', ')}`);
        } else {
          await postToDiscord(`MORNING PREP: ${confirmedBuys.length} candidates found, ${placed} placed (${rsi2Signals.length} RSI-2 + ${researchStars.size} catalysts)`);
        }

      } catch (e: any) {
        console.log(`  [PRE-MARKET] Error: ${e.message}`);
      }

      if (!this.store.get(preMarketKey)?.startsWith('{')) this.store.set(preMarketKey, 'done');
    }

    // ── 5b. SUNDAY EVENING PREP — scan Friday's data + research catalysts ──
    // Runs Sunday evening regardless of market status
    // Builds Monday watchlist: RSI-2 signals from Friday + weekend news/catalysts.
    // ORB will use this watchlist to prioritize Monday morning candidates.
    const isSunday = mkt.etDay === 'Sun';
    const isSundayPrepTime = isSunday && mkt.etHour >= 17 && mkt.etHour <= 23;
    const sundayPrepKey = `sunday_prep_${today}`;

    if (isSundayPrepTime && !this.store.get(sundayPrepKey)) {
      this.store.set(sundayPrepKey, 'running');
      console.log(`  [SUNDAY PREP] Building Monday watchlist...`);

      const creds0 = loadCredentials();
      const prepHeaders = { 'APCA-API-KEY-ID': creds0.alpaca?.apiKey || '', 'APCA-API-SECRET-KEY': creds0.alpaca?.apiSecret || '' };

      // 1. Run RSI-2 scan on Friday's closing data
      const { buys: fridayBuys, shorts: fridayShorts, diag: fridayDiag } = await scanRSI2(SP500_UNIVERSE, prepHeaders, new Set());
      console.log(`  [SUNDAY PREP] Friday RSI-2: ${fridayBuys.length} longs, ${fridayShorts.length} shorts (scanned: ${fridayDiag.scannedCount})`);

      // 2. Pull research worker catalysts (news from weekend scanning)
      const catalysts = new Set<string>();
      try {
        const stars = await getActiveResearchStars({ includeRelated: true });
        for (const s of stars) catalysts.add(s.symbol);
      } catch {}

      // 3. Detect regime (SPY vs SMA20)
      const regime = await detectRegime(prepHeaders);
      const regimeStr = regime ? (regime.bearish ? 'BEARISH' : 'BULLISH') : 'UNKNOWN';

      // 4. Build watchlist: RSI-2 signals boosted by research catalysts
      const watchlist = [
        ...fridayBuys.map(b => ({
          symbol: b.symbol, rsi2: b.rsi2, direction: 'long' as const, price: b.price,
          hasCatalyst: catalysts.has(b.symbol),
          priority: catalysts.has(b.symbol) ? 1 : 2,
        })),
        ...fridayShorts.map(s => ({
          symbol: s.symbol, rsi2: s.rsi2, direction: 'short' as const, price: s.price,
          hasCatalyst: catalysts.has(s.symbol),
          priority: catalysts.has(s.symbol) ? 1 : 2,
        })),
      ].sort((a, b) => a.priority - b.priority);

      // 5. Store watchlist for Monday
      const mondayDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const prepResult = {
        preparedAt: new Date().toISOString(),
        forDate: mondayDate,
        regime: regimeStr,
        spyPrice: regime?.spyPrice,
        spySma20: regime?.spySma20,
        catalysts: [...catalysts].slice(0, 20),
        watchlist: watchlist.slice(0, 15),
        fridayDiag,
      };
      this.store.set('monday_watchlist', JSON.stringify(prepResult));
      this.store.set(sundayPrepKey, 'done');

      // Record to Trident
      brain.recordRule(
        `SUNDAY PREP ${today}: Regime=${regimeStr} | ${fridayBuys.length} longs, ${fridayShorts.length} shorts | ${catalysts.size} catalysts | Top: ${watchlist.slice(0, 5).map(w => `${w.symbol} RSI=${w.rsi2.toFixed(1)} ${w.direction}${w.hasCatalyst ? ' +catalyst' : ''}`).join(', ')}`,
        'rsi2:sunday_prep',
      ).catch(() => {});

      await postToDiscord(`📋 **MONDAY PREP** | Regime: ${regimeStr} | ${watchlist.length} watchlist picks\nTop: ${watchlist.slice(0, 5).map(w => `${w.symbol} RSI=${w.rsi2.toFixed(1)} ${w.direction}${w.hasCatalyst ? ' ⭐' : ''}`).join(', ')}`);

      console.log(`  [SUNDAY PREP] Done — ${watchlist.length} picks, regime=${regimeStr}, ${catalysts.size} catalysts`);
    }

    // Everything below requires market open or pre-market
    if (!mkt.isMarketOpen && !isPreMarket) {
      this.writeStatus(t0);
      return;
    }

    // ── 5c. SECTOR INVERSE — detect sector drops, buy inverse ETFs ─────
    if (ENABLE_SECTOR_INTRADAY_INVERSE_BUYS && mkt.isMarketOpen && mkt.etHour >= 10 && (mkt.etHour < 15 || (mkt.etHour === 15 && mkt.etMin < 30)) && this.hbCount % 5 === 0) {
      // Check every 5th heartbeat (~10 min) to avoid API spam
      try {
        const heldSyms = new Set(equityPos.map(p => p.ticker));
        const allLeaders = new Set<string>();
        for (const sec of Object.values(SECTOR_INVERSE)) {
          for (const l of sec.leaders) allLeaders.add(l);
        }
        // Fetch all leader prices in one call
        const leaderSyms = [...allLeaders].filter(s => s !== 'SPY' && s !== 'DIA').join(',');
        const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=SPY,DIA,${leaderSyms}&feed=iex`, {
          headers: alpacaHeaders, signal: AbortSignal.timeout(8000),
        });
        if (snapRes.ok) {
          const snapData = await snapRes.json() as any;
          const dayChanges = new Map<string, number>();
          for (const [sym, snap] of Object.entries(snapData) as any) {
            const price = snap?.latestTrade?.p;
            const prev = snap?.prevDailyBar?.c;
            if (price && prev) dayChanges.set(sym, ((price - prev) / prev) * 100);
          }

          // Check each sector
          for (const [sectorName, sector] of Object.entries(SECTOR_INVERSE)) {
            if (heldSyms.has(sector.etf)) continue; // Already holding this inverse
            if (this._recentBuys.has(sector.etf)) continue; // Already bought today

            const changes = sector.leaders.map(l => dayChanges.get(l)).filter(c => c !== undefined) as number[];
            if (changes.length < 2) continue;
            const avgChange = changes.reduce((s, c) => s + c, 0) / changes.length;

            // Sector down 1.5%+ average → buy the inverse
            if (avgChange < -1.5) {
              console.log(`  [SECTOR SHORT] ${sectorName} avg ${avgChange.toFixed(1)}% — buying ${sector.etf}`);
              const etfPrice = await this.fetchPrice(sector.etf);
              if (etfPrice && etfPrice > 0) {
                await this.buyPosition(sector.etf, etfPrice, `SECTOR ${sectorName} avg ${avgChange.toFixed(1)}%`);
              }
            }
          }
        }
      } catch {}

      // CORE HOLDING HEDGE — if any core holding is down 3%+, buy its sector inverse
      try {
        for (const pos of equityPos) {
          if (!CORE_HOLDINGS.has(pos.ticker)) continue;
          if (pos.unrealizedPnlPercent <= -3) {
            // Find which sector this stock belongs to
            for (const [sectorName, sector] of Object.entries(SECTOR_INVERSE)) {
              const heldTickers2 = new Set(equityPos.map(p => p.ticker));
              if (sector.leaders.includes(pos.ticker) && !heldTickers2.has(sector.etf) && !this._recentBuys.has(sector.etf)) {
                console.log(`  [CORE HEDGE] ${pos.ticker} -${Math.abs(pos.unrealizedPnlPercent).toFixed(1)}% — buying ${sector.etf} to hedge`);
                const etfPrice = await this.fetchPrice(sector.etf);
                if (etfPrice && etfPrice > 0) {
                  await this.buyPosition(sector.etf, etfPrice, `HEDGE ${pos.ticker} -${Math.abs(pos.unrealizedPnlPercent).toFixed(1)}%`);
                  await postToDiscord(`🛡️ HEDGE: bought ${sector.etf} because ${pos.ticker} is down ${Math.abs(pos.unrealizedPnlPercent).toFixed(1)}%`);
                }
                break;
              }
            }
          }
        }
      } catch {}
    }

    // ── 5d. PRIORITY WATCHLIST — check top stocks every heartbeat ──────

    if (ENABLE_PRIORITY_WATCHLIST_BUYS && mkt.isMarketOpen && mkt.etHour >= 10 && (mkt.etHour < 15 || (mkt.etHour === 15 && mkt.etMin < 30))) {
      try {
        const heldSet = new Set(equityPos.map(p => p.ticker));
        const freshPos = await this.executor.getPositions();
        let openSlots = MAX_POSITIONS - freshPos.filter(p => !isCrypto(p.ticker)).length;

        if (openSlots > 0) {
          // Check watchlist stocks — are any up 1%+ today?
          const watchSyms = PRIORITY_WATCHLIST.filter(s => !heldSet.has(s) && !this._recentBuys.has(s) && !this._sessionSells.has(s));
          if (watchSyms.length > 0) {
            const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${watchSyms.join(',')}&feed=iex`, {
              headers: alpacaHeaders, signal: AbortSignal.timeout(5000),
            });
            if (snapRes.ok) {
              const snapData = await snapRes.json() as any;
              const movers: Array<{ symbol: string; price: number; dayPct: number }> = [];
              for (const sym of watchSyms) {
                const snap = snapData[sym];
                if (!snap) continue;
                const price = snap.latestTrade?.p;
                const prevClose = snap.prevDailyBar?.c;
                if (!price || !prevClose || price < 10) continue;
                const dayPct = ((price - prevClose) / prevClose) * 100;
                if (dayPct > 1.0) movers.push({ symbol: sym, price, dayPct });
              }
              movers.sort((a, b) => b.dayPct - a.dayPct);

              for (const m of movers) {
                if (openSlots <= 0) break;
                console.log(`  [WATCHLIST] ${m.symbol} +${m.dayPct.toFixed(1)}% — buying`);
                const bought = await this.buyPosition(m.symbol, m.price, `WATCHLIST +${m.dayPct.toFixed(1)}% today`);
                if (bought) openSlots--;
              }
            }
          }
        }
      } catch {}
    }

    // ── 5d. CATALYST BUYS — research worker finds it, engine buys it. Every heartbeat. ──

    // Read research stars and buy high-conviction catalysts that are moving up today
    if (ENABLE_CATALYST_BUYS && mkt.isMarketOpen && mkt.etHour >= 10 && mkt.etHour < NEW_BUY_CUTOFF_HOUR) {
      try {
        const stars = await getActiveResearchStars({ includeRelated: true });
        const heldSet = new Set(equityPos.map(p => p.ticker));
        const freshPos = await this.executor.getPositions();
        let openSlots = MAX_POSITIONS - freshPos.filter(p => !isCrypto(p.ticker)).length;

        // Filter: high score (>0.95) + not already held + not sold today
        // No SP500 filter — research worker + Biz Insider already handle quality
        const catalystBuys = stars
          .filter(s => (s.sector || '') !== 'short_candidate') // longs only here
          .filter(s => s.score >= 0.95)
          .filter(s => !heldSet.has(s.symbol))
          .filter(s => !this._sessionSells.has(s.symbol))
          .filter(s => !this._recentBuys.has(s.symbol))
          .sort((a: any, b: any) => b.score - a.score);

        if (catalystBuys.length > 0 && openSlots > 0) {
          // Verify they're actually up today before buying (don't buy falling knives)
          for (const star of catalystBuys.slice(0, openSlots)) {
            if (openSlots <= 0) break;
            try {
              const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${star.symbol}&feed=iex`, {
                headers: alpacaHeaders, signal: AbortSignal.timeout(5000),
              });
              if (!snapRes.ok) continue;
              const snapData = await snapRes.json() as any;
              const snap = snapData[star.symbol];
              if (!snap) continue;
              const price = snap.latestTrade?.p;
              const prevClose = snap.prevDailyBar?.c;
              if (!price || !prevClose || price < 10) continue;
              const dayChange = ((price - prevClose) / prevClose) * 100;

              // Must be up today — confirms the catalyst is driving price action
              if (dayChange > 1.0) {
                console.log(`  [CATALYST BUY] ${star.symbol} +${dayChange.toFixed(1)}% today | ${star.catalyst?.slice(0, 60)} | score=${star.score.toFixed(2)}`);
                const bought = await this.buyPosition(star.symbol, price, `CATALYST +${dayChange.toFixed(1)}% ${star.catalyst?.slice(0, 30)}`);
                if (bought) openSlots--;
              }
            } catch {}
          }
        }
      } catch {}

    }

    // ── 5d2. BIZ INSIDER DOWNSIDE SHORTS — short confirmed S&P 500 losers ──
    // Only open shorts 10 AM - 2 PM ET — gives time to manage and cover before close.
    // The BI S&P 500 movers page is the source of truth for "obvious list" names;
    // Alpaca snapshots verify the move is still live before sending an order.
    if (ENABLE_CATALYST_BUYS && mkt.isMarketOpen && mkt.etHour >= 10 && mkt.etHour < 14) {
      const shortScanSlot = Math.floor(mkt.etMin / 15) * 15;
      const shortScanKey = `intraday_short_scan_${today}_${mkt.etHour}${String(shortScanSlot).padStart(2, '0')}`;

      if (!this.store.get(shortScanKey)) {
        this.store.set(shortScanKey, 'running');
        try {
		          const stars = await getActiveResearchStars({ includeRelated: true });
	          const heldSet = new Set(equityPos.map(p => p.ticker));
	          const freshPos = await this.executor.getPositions();
            const equityPositions = freshPos.filter(p => !isCrypto(p.ticker));
		        const existingShorts = equityPositions.filter(p => p.shares < 0).length;
            const longExposure = equityPositions
              .filter(p => p.shares > 0)
              .reduce((s, p) => s + Math.abs(p.marketValue), 0);
            const shortExposure = equityPositions
              .filter(p => p.shares < 0)
              .reduce((s, p) => s + Math.abs(p.marketValue), 0);
            const grossExposure = longExposure + shortExposure;
            const coreLongExposure = equityPositions
              .filter(p => p.shares > 0 && CORE_HOLDINGS.has(p.ticker))
              .reduce((s, p) => s + Math.abs(p.marketValue), 0);
            const weakLongRotationCandidates = equityPositions
              .filter(p => p.shares > 0)
              .filter(p => !CORE_HOLDINGS.has(p.ticker))
              .filter(p => p.unrealizedPnlPercent <= ROTATE_WEAK_LONG_MAX_PNL_PCT || p.unrealizedPnl <= ROTATE_WEAK_LONG_MAX_DOLLAR_PNL)
              .sort((a, b) => a.unrealizedPnlPercent - b.unrealizedPnlPercent);
            const shortTarget = await computeMarketShortTarget(alpacaHeaders, this.store);
            const currentShortRatio = grossExposure > 0 ? shortExposure / grossExposure : 0;
            const targetShortDollars = BUDGET_MAX * shortTarget.targetShortRatio;
            const targetShortCapacity = Math.max(0, targetShortDollars - shortExposure);
            let budgetCapacity = Math.max(0, BUDGET_MAX - grossExposure);
            let remainingShortBudget = Math.min(targetShortCapacity, budgetCapacity);

          const summary: any = {
	            time: new Date().toISOString(),
	            scanned: 0,
	            existingShorts,
              longExposure: Math.round(longExposure),
              shortExposure: Math.round(shortExposure),
              grossExposure: Math.round(grossExposure),
              coreLongExposure: Math.round(coreLongExposure),
              currentShortRatio: Number(currentShortRatio.toFixed(3)),
              targetShortRatio: Number(shortTarget.targetShortRatio.toFixed(3)),
              targetShortDollars: Math.round(targetShortDollars),
              targetShortCapacity: Math.round(targetShortCapacity),
              budgetCapacity: Math.round(budgetCapacity),
              remainingShortBudget: Math.round(remainingShortBudget),
              marketTargetReason: shortTarget.reason,
              weakLongRotationCandidates: weakLongRotationCandidates.map(p => `${p.ticker}:${p.unrealizedPnlPercent.toFixed(1)}%:$${p.unrealizedPnl.toFixed(0)}`),
	            candidates: 0,
	            placed: 0,
              rotated: [] as string[],
	            topDown: [],
	            skipped: [] as string[],
	          };

	          if (targetShortCapacity < MIN_SHORT_NOTIONAL) {
	            summary.blocked = `short_target_met_${Math.round(shortExposure)}/${Math.round(targetShortDollars)}`;
	            this.store.set(shortScanKey, JSON.stringify(summary));
	            this.store.set('intraday_short_scan_latest', JSON.stringify(summary));
	          } else {

            type DownsideCandidate = {
              symbol: string;
              price: number;
              dayChange: number;
              score: number;
              catalyst: string;
              source: string;
            };

            const candidateMap = new Map<string, DownsideCandidate>();
            const addCandidate = (candidate: DownsideCandidate) => {
              const existing = candidateMap.get(candidate.symbol);
              if (!existing || candidate.dayChange < existing.dayChange || candidate.score > existing.score) {
                candidateMap.set(candidate.symbol, candidate);
              }
            };

            const shortStars = stars
              .filter(s => s.sector === 'short_candidate' && String(s.catalyst || '').startsWith('BI LOSER'))
              .filter(s => s.score >= 0.85)
              .filter(s => !heldSet.has(s.symbol))
              .filter(s => !this._sessionSells.has(s.symbol))
              .filter(s => !this._recentBuys.has(s.symbol))
              .sort((a: any, b: any) => b.score - a.score);

            const biSymbols = new Map<string, { pct: number; catalyst: string; score: number }>();
            for (const star of shortStars) {
              biSymbols.set(star.symbol, {
                pct: -3,
                catalyst: star.catalyst || 'BI loser research star',
                score: star.score,
              });
            }

            try {
              const biRes = await fetch(BIZ_INSIDER_MOVERS_URL, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
                signal: AbortSignal.timeout(8000),
              });
              if (biRes.ok) {
                const html = await biRes.text();
                const biMovers = parseBizInsiderMovers(html);
                const losers = biMovers
                  .filter(m => m.list === 'loser' && m.pct <= MIN_DOWNSIDE_SHORT_MOVE)
                  .sort((a, b) => a.pct - b.pct);
                summary.scanned = biMovers.length;
                summary.bizInsiderLosers = losers.map(m => `${m.symbol}${m.pct.toFixed(1)}%`);
                for (const loser of losers) {
                  biSymbols.set(loser.symbol, {
                    pct: loser.pct,
                    catalyst: `BI S&P 500 loser ${loser.pct.toFixed(1)}% ${loser.name}`,
                    score: Math.min(0.86 + Math.abs(loser.pct) / 100, 0.97),
                  });
                }
              }
            } catch (e: any) {
              summary.skipped.push(`bi_fetch_error:${e?.message || String(e)}`);
            }

            const biList = [...biSymbols.entries()]
              .filter(([symbol]) => !heldSet.has(symbol))
              .filter(([symbol]) => !this._sessionSells.has(symbol))
              .filter(([symbol]) => !this._recentBuys.has(symbol))
              .sort((a, b) => a[1].pct - b[1].pct);

            for (let i = 0; i < biList.length; i += 50) {
              const batchSymbols = biList.slice(i, i + 50).map(([symbol]) => symbol);
              const batch = batchSymbols.join(',');
              try {
                const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${batch}&feed=iex`, {
                  headers: alpacaHeaders, signal: AbortSignal.timeout(8000),
                });
                if (!snapRes.ok) continue;
                const snapData = await snapRes.json() as any;
                for (const symbol of batchSymbols) {
                  const snap = snapData[symbol];
                  const price = snap?.latestTrade?.p;
                  const prevClose = snap?.prevDailyBar?.c;
                  if (!price || !prevClose || price < 10) continue;
                  const dayChange = ((price - prevClose) / prevClose) * 100;
                  const bi = biSymbols.get(symbol)!;
                  if (dayChange <= MIN_DOWNSIDE_SHORT_MOVE) {
                    addCandidate({
                      symbol,
                      price,
                      dayChange,
                      score: bi.score,
                      catalyst: bi.catalyst,
                      source: 'biz_insider',
                    });
                  } else {
                    summary.skipped.push(`${symbol}:alpaca_not_red_enough_${dayChange.toFixed(1)}%`);
                  }
                }
              } catch {}
              await new Promise(r => setTimeout(r, 150));
            }

          const candidates = [...candidateMap.values()]
            .filter(c => !heldSet.has(c.symbol))
            .filter(c => !this._sessionSells.has(c.symbol))
            .filter(c => !this._recentBuys.has(c.symbol))
            .sort((a, b) => a.dayChange - b.dayChange || b.score - a.score);

          summary.candidates = candidates.length;
          summary.topDown = candidates.slice(0, 10).map(c => `${c.symbol}${c.dayChange.toFixed(1)}%:${c.source}`);
          console.log(`  [BI SHORT SCAN] ${candidates.length} confirmed BI downside candidates. Top: ${summary.topDown.slice(0, 5).join(', ') || 'none'}`);

          if (candidates.length > 0 && remainingShortBudget < MIN_SHORT_NOTIONAL && budgetCapacity < MIN_SHORT_NOTIONAL) {
            for (const weakLong of weakLongRotationCandidates) {
              if (remainingShortBudget >= MIN_SHORT_NOTIONAL) break;
              const need = Math.min(PER_POSITION, targetShortCapacity) - remainingShortBudget;
              if (need <= 0) break;
              console.log(`  [ROTATE] Freeing capital from weak non-core long ${weakLong.ticker} (${weakLong.unrealizedPnlPercent.toFixed(1)}%, $${weakLong.unrealizedPnl.toFixed(0)}) for BI loser shorts`);
              const sold = await this.sellPosition(
                weakLong.ticker,
                weakLong.shares,
                `rotate_to_bi_shorts_target_${(shortTarget.targetShortRatio * 100).toFixed(0)}pct`,
                weakLong.unrealizedPnl,
                weakLong.avgPrice,
                weakLong.currentPrice,
              );
              if (sold) {
                const freed = Math.abs(weakLong.marketValue);
                budgetCapacity += freed;
                remainingShortBudget = Math.min(targetShortCapacity, budgetCapacity);
                summary.rotated.push(`${weakLong.ticker}:$${Math.round(freed)}`);
                summary.budgetCapacity = Math.round(budgetCapacity);
                summary.remainingShortBudget = Math.round(remainingShortBudget);
              }
            }
          }

          if (remainingShortBudget < MIN_SHORT_NOTIONAL) {
            summary.blocked = `budget_cap_${Math.round(grossExposure)}/${BUDGET_MAX}`;
          }

          for (const candidate of candidates) {
            if (remainingShortBudget < MIN_SHORT_NOTIONAL || remainingShortBudget < candidate.price) break;
            if (candidate.dayChange > MIN_DOWNSIDE_SHORT_MOVE) {
              summary.skipped.push(`${candidate.symbol}:not_red_enough_${candidate.dayChange.toFixed(1)}%`);
              continue;
            }
            console.log(`  [BI SHORT] ${candidate.symbol} ${candidate.dayChange.toFixed(1)}% today | ${candidate.catalyst.slice(0, 60)}`);
            const shortNotional = Math.min(PER_POSITION, remainingShortBudget);
            const shorted = await this.shortPosition(
              candidate.symbol,
              candidate.price,
              `BI_SHORT ${candidate.dayChange.toFixed(1)}%`,
              shortNotional,
            );
            if (shorted) {
              const estimatedNotional = Math.floor(shortNotional / candidate.price) * candidate.price;
              remainingShortBudget = Math.max(0, remainingShortBudget - estimatedNotional);
              summary.remainingShortBudget = Math.round(remainingShortBudget);
              summary.placed++;
              brain.recordRule(
                `BI SHORT: ${candidate.symbol} ${candidate.dayChange.toFixed(1)}% @ $${candidate.price.toFixed(2)}`,
                'autonomous_decision',
              ).catch(() => {});
            } else {
              summary.skipped.push(`${candidate.symbol}:order_blocked`);
            }
          }

          this.store.set(shortScanKey, JSON.stringify(summary));
          this.store.set('intraday_short_scan_latest', JSON.stringify(summary));
          if (summary.placed > 0) {
            await postToDiscord(`BI SHORT: opened ${summary.placed} downside short(s). Top scan: ${summary.topDown.slice(0, 5).join(', ')}`);
          }
          }
        } catch (e: any) {
          const summary = { time: new Date().toISOString(), error: e?.message || String(e) };
          this.store.set(shortScanKey, JSON.stringify(summary));
          this.store.set('intraday_short_scan_latest', JSON.stringify(summary));
        }
      }
    }

    // ── 5e. MIDDAY MOMENTUM — buy top S&P 500 movers (11:00-11:15 AM ET) ──
    // Scans entire S&P 500, ranks by % gain, buys top movers with Trident gate.
    // This catches CSCO +14%, F +7% days the RSI-2 strategy misses.
    const isMiddayMomentum = mkt.etHour === 11 && mkt.etMin >= 0 && mkt.etMin <= 15;
    const middayKey = `midday_momentum_${today}`;

    if (ENABLE_MIDDAY_MOMENTUM && isMiddayMomentum && mkt.isMarketOpen && !this.store.get(middayKey)) {
      this.store.set(middayKey, 'running');
      console.log(`  [MIDDAY MOMENTUM] 11 AM — scanning S&P 500 for top movers...`);

      try {
        const heldSet = new Set(equityPos.map(p => p.ticker));
        const freshPos = await this.executor.getPositions();
        let openSlots = MAX_POSITIONS - freshPos.filter(p => !isCrypto(p.ticker)).length;
        const deployed = freshPos.reduce((s, p) => s + Math.abs(p.marketValue), 0);

        if (openSlots > 0 && deployed + PER_POSITION <= BUDGET_MAX) {
          // Scan S&P 500 in batches of 50
          const allMovers: Array<{ symbol: string; price: number; pctChange: number; volume: number }> = [];
          for (let i = 0; i < SP500_UNIVERSE.length; i += 50) {
            const batch = SP500_UNIVERSE.slice(i, i + 50).join(',');
            try {
              const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${batch}&feed=iex`, {
                headers: alpacaHeaders, signal: AbortSignal.timeout(8000),
              });
              if (!snapRes.ok) continue;
              const snapData = await snapRes.json() as any;
              for (const [sym, snap] of Object.entries(snapData) as any) {
                const price = snap?.latestTrade?.p;
                const prev = snap?.prevDailyBar?.c;
                const vol = snap?.minuteBar?.v || snap?.dailyBar?.v || 0;
                if (!price || !prev || price < 10) continue;
                const pctChange = ((price - prev) / prev) * 100;
                if (pctChange >= 3) { // Only care about 3%+ movers
                  allMovers.push({ symbol: sym, price, pctChange, volume: vol });
                }
              }
            } catch {}
            await new Promise(r => setTimeout(r, 200));
          }

          // Rank by % change, filter out held + sold today
          allMovers.sort((a, b) => b.pctChange - a.pctChange);
          const candidates = allMovers
            .filter(m => !heldSet.has(m.symbol))
            .filter(m => !this._sessionSells.has(m.symbol))
            .filter(m => !this._recentBuys.has(m.symbol));

          console.log(`  [MIDDAY] Found ${allMovers.length} movers (3%+), ${candidates.length} buyable. Top: ${candidates.slice(0, 5).map(m => `${m.symbol}+${m.pctChange.toFixed(1)}%`).join(', ')}`);

          // Buy top movers up to open slots (max 2 per scan to avoid over-concentration)
          let placed = 0;
          for (const mover of candidates.slice(0, Math.min(openSlots, 2))) {
            if (placed >= 2) break;
            console.log(`  [MIDDAY BUY] ${mover.symbol} +${mover.pctChange.toFixed(1)}% today @ $${mover.price.toFixed(2)}`);
            const bought = await this.buyPosition(mover.symbol, mover.price, `MIDDAY_MOMENTUM +${mover.pctChange.toFixed(1)}%`);
            if (bought) {
              placed++;
              openSlots--;
              brain.recordRule(
                `MIDDAY MOMENTUM BUY: ${mover.symbol} +${mover.pctChange.toFixed(1)}% @ $${mover.price.toFixed(2)}`,
                'autonomous_decision',
              ).catch(() => {});
            }
          }

          this.store.set(middayKey, JSON.stringify({
            time: new Date().toISOString(),
            scanned: SP500_UNIVERSE.length,
            movers: allMovers.length,
            candidates: candidates.length,
            placed,
            top5: candidates.slice(0, 5).map(m => `${m.symbol}+${m.pctChange.toFixed(1)}%`),
          }));

          if (placed > 0) {
            await postToDiscord(`🚀 MIDDAY MOMENTUM: Bought ${placed} top S&P 500 movers — ${candidates.slice(0, placed).map(m => `${m.symbol} +${m.pctChange.toFixed(1)}%`).join(', ')}`);
          } else {
            await postToDiscord(`📊 MIDDAY MOMENTUM: ${allMovers.length} movers found, ${candidates.length} buyable — no slots/budget available`);
          }
        }
      } catch (e: any) {
        console.log(`  [MIDDAY MOMENTUM ERR] ${e.message}`);
      }
    }

    // ── 5f. MORNING RSI-2 EXECUTION — rescan at 10:15 AM ──

    const isMorningBuyTime = mkt.etHour === 10 && mkt.etMin >= 13 && mkt.etMin <= 20;
    const morningBuyKey = `morning_rsi2_buy_${today}`;

    if (ENABLE_MORNING_RSI2_BUYS && isMorningBuyTime && !this.store.get(morningBuyKey)) {
      this.store.set(morningBuyKey, 'running');
      console.log(`  [MORNING RSI-2] 10:15 AM — scanning for oversold buys...`);

      // Fresh scan with live data (not stale prep)
      const heldLongSet = new Set(equityPos.filter(p => !isShortPosition(p)).map(p => p.ticker));
      const heldShortSet = new Set(equityPos.filter(p => isShortPosition(p)).map(p => p.ticker));
      const researchStars = new Set<string>();
      try { const stars = await getActiveResearchStars({ includeRelated: true }); for (const s of stars) researchStars.add(s.symbol); } catch {}

      const scanResult = await scanRSI2(SP500_UNIVERSE, alpacaHeaders, heldLongSet, heldShortSet, researchStars);
      const { buys, shorts, diag } = scanResult;
      console.log(`  [MORNING RSI-2] ${buys.length} longs, ${shorts.length} shorts | Scanned: ${diag.scannedCount}, Failed: ${diag.failedCount}`);

      // Execute longs — fill available slots
      const freshPos = await this.executor.getPositions();
      const freshEquity = freshPos.filter(p => !isCrypto(p.ticker));
      let openSlots = MAX_POSITIONS - freshEquity.length;

      for (const buy of buys) {
        if (openSlots <= 0) break;
        if (this._sessionSells.has(buy.symbol)) continue;

        console.log(`  [MORNING BUY] ${buy.symbol} RSI(2)=${buy.rsi2.toFixed(1)} price=$${buy.price.toFixed(2)}`);
        const bought = await this.buyPosition(buy.symbol, buy.price, `RSI2=${buy.rsi2.toFixed(1)} morning_scan`);
        if (bought) openSlots--;
      }

      this.store.set(morningBuyKey, 'done');
      this.store.set('rsi2_scan', JSON.stringify({ date: today, buys: buys.slice(0, 10), shorts: shorts.slice(0, 10), exits: [], covers: [], diag, scanTime: 'morning' }));
      await postToDiscord(`📊 Morning RSI-2: ${buys.length} longs, ${shorts.length} shorts. Bought: ${buys.slice(0, 3).map(b => `${b.symbol} RSI=${b.rsi2.toFixed(1)}`).join(', ') || 'none (full)'}`);
    }

    // ── 6a. ORB — Morning session (9:48-10:00 AM ET: scan, 10:00-11:30: manage) ──

    // ORB Scan: 9:48-10:00 AM — find gap-ups that broke above opening range
    const isOrbScanTime = mkt.etHour === 9 && mkt.etMin >= 48;
    if (isOrbScanTime && this._orbScannedToday !== today) {
      // Circuit breaker only blocks buy execution, not the scan itself
      this._orbScannedToday = today;
      const heldSet = new Set(equityPos.map(p => p.ticker));
      const orbCandidates = await scanORB(alpacaHeaders, heldSet);
      const breakouts = orbCandidates.filter(c => c.breakout);

      console.log(`  [ORB SCAN] ${orbCandidates.length} gap-ups (${ORB_GAP_MIN}-${ORB_GAP_MAX}%), ${breakouts.length} broke above OR`);
      this.store.set('orb_scan', JSON.stringify({ date: today, candidates: orbCandidates.slice(0, 10) }));

      // Buy breakouts — max 2 ORB positions to leave room for RSI-2
      const freshPos = await this.executor.getPositions();
      let orbSlots = Math.min(2, MAX_POSITIONS - freshPos.filter(p => !isCrypto(p.ticker)).length);

      if (circuitBreakerTripped) {
        console.log(`  [ORB] Circuit breaker — ${breakouts.length} breakouts found but NOT buying`);
      } else {
        for (const bo of breakouts) {
          if (orbSlots <= 0) break;
          if (this._sessionSells.has(bo.symbol)) continue;

          const risk = bo.currentPrice - bo.orLow;
          if (risk <= 0 || risk > bo.currentPrice * 0.05) continue;
          const stopPrice = Math.round(bo.orLow * 100) / 100;
          const target = Math.round((bo.currentPrice + 2 * risk) * 100) / 100;

          console.log(`  [ORB BUY] ${bo.symbol} gap+${bo.gapPct.toFixed(1)}% price=$${bo.currentPrice.toFixed(2)} OR=${bo.orLow.toFixed(2)}-${bo.orHigh.toFixed(2)} stop=$${stopPrice.toFixed(2)} target=$${target.toFixed(2)}`);
          const bought = await this.buyPosition(bo.symbol, bo.currentPrice, `ORB gap+${bo.gapPct.toFixed(1)}%`, stopPrice);
          if (bought) {
            this._orbTrades.set(bo.symbol, { orLow: bo.orLow, orHigh: bo.orHigh, target, boughtAt: Date.now() });
            orbSlots--;
          }
        }
      }

      brain.recordRule(
        `ORB SCAN ${today}: ${breakouts.length} breakouts from ${orbCandidates.length} gap-ups. Bought: ${[...this._orbTrades.keys()].join(',')}`,
        'orb:scan',
      ).catch(() => {});
    }

    // ORB Management: check targets and time stops for active ORB trades
    if (this._orbTrades.size > 0) {
      for (const [ticker, orb] of this._orbTrades) {
        const pos = equityPos.find(p => p.ticker === ticker);
        if (!pos) { this._orbTrades.delete(ticker); continue; } // Position already closed

        // Target hit — sell
        if (pos.currentPrice >= orb.target) {
          console.log(`  [ORB TARGET] ${ticker} hit $${orb.target.toFixed(2)} — selling`);
          await this.sellPosition(pos.ticker, pos.shares, `orb_target_${orb.target.toFixed(0)}`, pos.unrealizedPnl, pos.avgPrice, pos.currentPrice);
          this._orbTrades.delete(ticker);
          continue;
        }

        // Time stop — flatten by 11:30 AM ET if no target
        if (mkt.etHour > ORB_FLATTEN_HOUR || (mkt.etHour === ORB_FLATTEN_HOUR && mkt.etMin >= ORB_FLATTEN_MIN)) {
          console.log(`  [ORB TIME] ${ticker} no target by 11:30 — flattening $${pos.unrealizedPnl.toFixed(2)}`);
          await this.sellPosition(pos.ticker, pos.shares, 'orb_time_stop', pos.unrealizedPnl, pos.avgPrice, pos.currentPrice);
          this._orbTrades.delete(ticker);
        }
      }
    }

    // ── 6b. RSI-2 SCAN — runs once at 3:50 PM ET ─────────────────────
    const isScanTime = mkt.etHour === 15 && mkt.etMin >= 48 && mkt.etMin <= 55;

    if (isScanTime && this._scannedToday !== today) {
      // NOTE: scan ALWAYS runs. Circuit breaker only blocks the buy execution below.
      this._scannedToday = today;
      console.log(`  [RSI-2 SCAN] Scanning ${SP500_UNIVERSE.length} S&P 500 stocks...`);
      const heldLongSet = new Set(equityPos.filter(p => !isShortPosition(p)).map(p => p.ticker));
      const heldShortSet = new Set(equityPos.filter(p => isShortPosition(p)).map(p => p.ticker));

      // Pull research stars — research worker writes these every 2 min
      const researchStars = new Set<string>();
      try {
        const stars = await getActiveResearchStars({ includeRelated: true });
        for (const s of stars) researchStars.add(s.symbol);
        if (researchStars.size > 0) console.log(`  [RESEARCH] ${researchStars.size} active stars: ${[...researchStars].slice(0, 8).join(', ')}`);
      } catch {}

      const scanResult = await scanRSI2(SP500_UNIVERSE, alpacaHeaders, heldLongSet, heldShortSet, researchStars);
      const { buys, exits, shorts, covers, diag } = scanResult;
      console.log(`  [RSI-2] ${buys.length} longs, ${shorts.length} shorts, ${exits.length} exits, ${covers.length} covers | Scanned: ${diag.scannedCount}, Failed: ${diag.failedCount}, NoData: ${diag.insufficientBars}`);

      // Record scan to Trident
      brain.recordRule(
        `RSI2 SCAN ${today}: ${buys.length} longs [${buys.slice(0, 5).map(b => `${b.symbol} RSI=${b.rsi2.toFixed(1)}`).join(', ')}] | ${shorts.length} shorts [${shorts.slice(0, 5).map(s => `${s.symbol} RSI=${s.rsi2.toFixed(1)}`).join(', ')}] | ${exits.length} exits, ${covers.length} covers`,
        'rsi2:scan',
      ).catch(() => {});
      this.store.set('rsi2_scan', JSON.stringify({ date: today, buys: buys.slice(0, 10), shorts: shorts.slice(0, 10), exits, covers, diag }));

      // Execute exits first
      for (const exit of exits) {
        const pos = equityPos.find(p => p.ticker === exit.symbol);
        if (pos && !isShortPosition(pos)) {
          console.log(`  [RSI-2 EXIT] ${exit.symbol} RSI(2)=${exit.rsi2.toFixed(1)} > ${RSI_EXIT}`);
          await this.sellPosition(pos.ticker, pos.shares, `rsi2_exit_${exit.rsi2.toFixed(0)}`, pos.unrealizedPnl, pos.avgPrice, pos.currentPrice);
        }
      }

      // RSI-2 buys DISABLED — scan data saved for morning prep but no 3:50 PM entries.
      // Reason: RSI-2 buys at EOD consistently go red after hours (UNP -$639, GWW -$101).
      // Morning prep uses the scan data to identify bounce candidates for next-day open.
      if (buys.length > 0) {
        console.log(`  [RSI-2] ${buys.length} buy signals saved for morning prep (NOT buying at 3:50 PM). Top: ${buys.slice(0, 5).map(b => `${b.symbol} RSI=${b.rsi2.toFixed(1)}`).join(', ')}`);
      }

      // Execute covers (close short positions)
      for (const cover of covers) {
        const pos = equityPos.find(p => p.ticker === cover.symbol);
        if (pos && isShortPosition(pos)) {
          console.log(`  [RSI-2 COVER] ${cover.symbol} RSI(2)=${cover.rsi2.toFixed(1)} < ${RSI_SHORT_EXIT}`);
          await this.sellPosition(pos.ticker, Math.abs(pos.shares), `rsi2_cover_${cover.rsi2.toFixed(0)}`, pos.unrealizedPnl, pos.avgPrice, pos.currentPrice, 'short');
        }
      }

      // Execute shorts — use remaining slots
      if (circuitBreakerTripped) {
        if (shorts.length > 0) console.log(`  [RSI-2] Circuit breaker — ${shorts.length} short signals found but NOT shorting. Top: ${shorts.slice(0, 3).map(s => `${s.symbol} RSI=${s.rsi2.toFixed(1)}`).join(', ')}`);
      } else {
        // Max 1 auto-short at a time, only the most extreme signal
        const freshPos2 = await this.executor.getPositions();
        const existingShorts = freshPos2.filter(p => isShortPosition(p)).length;
        if (existingShorts === 0 && shorts.length > 0) {
          const best = shorts[0]; // Highest RSI = most overbought
          if (best.rsi2 >= 96) { // Only extreme overbought
            console.log(`  [RSI-2 SHORT] ${best.symbol} RSI(2)=${best.rsi2.toFixed(1)} — extreme overbought, shorting`);
            await this.shortPosition(best.symbol, best.price, `RSI2=${best.rsi2.toFixed(1)} extreme_overbought`);
          }
        }
      }

      const longStr = buys.slice(0, 3).map(b => `${b.symbol} RSI=${b.rsi2.toFixed(1)}`).join(', ') || 'none';
      const shortStr = shorts.slice(0, 3).map(s => `${s.symbol} RSI=${s.rsi2.toFixed(1)}`).join(', ') || 'none';
      await postToDiscord(`📊 RSI-2 scan: ${buys.length} longs (${longStr}) | ${shorts.length} shorts (${shortStr}) | ${exits.length} exits, ${covers.length} covers`);
    }

    // ── 6c. REGIME + INVERSE ETF — runs EVERY HEARTBEAT, not just at 3:50 ──
    // If we hold inverse ETFs and the market flips, dump them immediately.
    // If market is tanking and we don't hold, buy at 3:50 (not intraday — avoid whipsaw).
    {
      const INVERSE_TICKERS = new Set([INVERSE_ETF, INVERSE_ETF_1X, 'TSDD', 'TSLQ', 'SPXS', 'SDOW', 'TZA', 'FAZ', 'SDS']);
      const heldInverse = equityPos.filter(p => INVERSE_TICKERS.has(p.ticker));

      if (heldInverse.length > 0) {
        // We hold inverse ETFs — check if market is rallying and we need to exit
        try {
          const spySnap = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=SPY&feed=iex`, {
            headers: alpacaHeaders, signal: AbortSignal.timeout(5000),
          });
          if (spySnap.ok) {
            const snapData = await spySnap.json() as any;
            const spyPrice = snapData.SPY?.latestTrade?.p || snapData.SPY?.latestQuote?.ap;
            const spyPrevClose = snapData.SPY?.prevDailyBar?.c;
            if (spyPrice && spyPrevClose) {
              const spyDayChange = ((spyPrice - spyPrevClose) / spyPrevClose) * 100;
              // If SPY is up 1%+ today, market has flipped — dump inverse ETFs
              if (spyDayChange > 1.0) {
                console.log(`  [REGIME] SPY +${spyDayChange.toFixed(1)}% today — BULLISH FLIP, selling inverse ETFs`);
                for (const pos of heldInverse) {
                  await this.sellPosition(pos.ticker, Math.abs(pos.shares), `regime_flip_spy+${spyDayChange.toFixed(1)}%`, pos.unrealizedPnl, pos.avgPrice, pos.currentPrice);
                }
                await postToDiscord(`📊 REGIME FLIP: SPY +${spyDayChange.toFixed(1)}% — sold ${heldInverse.map(p => p.ticker).join(', ')}`);
              } else {
                if (this.hbCount % 10 === 0) console.log(`  [REGIME] SPY ${spyDayChange >= 0 ? '+' : ''}${spyDayChange.toFixed(1)}% — holding inverse ETFs`);
              }
            }
          }
        } catch {}
      }

      // Buy inverse ETF when SPY drops 0.5%+ intraday and we're heavy in tech — hedge the core
      // Runs once per day between 10 AM and 2 PM (morning action, not EOD)
      const hedgeKey = `hedge_inverse_${today}`;
      if (heldInverse.length === 0 && !this.store.get(hedgeKey) && mkt.isMarketOpen && mkt.etHour >= 10 && mkt.etHour < NEW_BUY_CUTOFF_HOUR) {
        try {
          const spySnap2 = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=SPY&feed=iex`, {
            headers: alpacaHeaders, signal: AbortSignal.timeout(5000),
          });
          if (spySnap2.ok) {
            const snapData2 = await spySnap2.json() as any;
            const spyPrice2 = snapData2.SPY?.latestTrade?.p;
            const spyPrev2 = snapData2.SPY?.prevDailyBar?.c;
            if (spyPrice2 && spyPrev2) {
              const spyDrop = ((spyPrice2 - spyPrev2) / spyPrev2) * 100;
              // SPY down 0.5%+ and we hold core tech (NVDA/AMZN) = buy SQQQ hedge
              const holdsCoretech = equityPos.some(p => CORE_HOLDINGS.has(p.ticker));
              if (spyDrop < -0.5 && holdsCoretech) {
                const price = await this.fetchPrice(INVERSE_ETF);
                if (price && price > 0) {
                  const freshPos3 = await this.executor.getPositions();
                  if (freshPos3.filter(p => !isCrypto(p.ticker)).length < MAX_POSITIONS) {
                    console.log(`  [HEDGE] SPY ${spyDrop.toFixed(1)}% + core tech exposed — buying ${INVERSE_ETF} @$${price.toFixed(2)}`);
                    const stopPrice = Math.round(price * (1 - INVERSE_STOP_PCT) * 100) / 100;
                    await this.buyPosition(INVERSE_ETF, price, `HEDGE SPY${spyDrop.toFixed(1)}% core_exposed`, stopPrice);
                    this.store.set(hedgeKey, 'placed');
                    await postToDiscord(`🛡️ HEDGE: SPY ${spyDrop.toFixed(1)}% — bought ${INVERSE_ETF} to offset core tech losses`);
                  }
                }
              }
            }
          }
        } catch {}
      }
    }

    // ── 6d. DAILY MOVER CAPTURE (3:55 PM) — top S&P 500 winners/losers ──
    const isMoverCaptureTime = mkt.etHour === 15 && mkt.etMin >= 53 && mkt.etMin <= 58;
    const moverCaptureKey = `daily_movers_${today}`;
    if (isMoverCaptureTime && !this.store.get(moverCaptureKey)) {
      try {
        const topSyms = SP500_UNIVERSE.slice(0, 150).join(',');
        const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${topSyms}&feed=iex`, {
          headers: alpacaHeaders, signal: AbortSignal.timeout(10000),
        });
        if (snapRes.ok) {
          const snapData = await snapRes.json() as any;
          const dayMovers: Array<{ symbol: string; pct: number; price: number }> = [];
          for (const [sym, snap] of Object.entries(snapData) as any) {
            const price = snap?.latestTrade?.p;
            const prev = snap?.prevDailyBar?.c;
            if (price && prev) dayMovers.push({ symbol: sym, pct: ((price - prev) / prev) * 100, price });
          }
          dayMovers.sort((a, b) => b.pct - a.pct);
          const winners = dayMovers.slice(0, 14);
          const losers = dayMovers.slice(-14).reverse();

          this.store.set(moverCaptureKey, JSON.stringify({ date: today, winners, losers }));

          // Record to Trident
          const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://trident.cetaceanlabs.com';
          const apiKey = process.env.BRAIN_API_KEY || '';
          if (apiKey) {
            fetch(`${BRAIN_URL}/v1/train`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({
                input: `S&P 500 movers ${today}: Winners: ${winners.slice(0, 7).map(w => `${w.symbol}+${w.pct.toFixed(1)}%`).join(', ')}. Losers: ${losers.slice(0, 7).map(l => `${l.symbol}${l.pct.toFixed(1)}%`).join(', ')}`,
                output: 'daily_movers',
                metadata: { domain: 'market_data', date: today },
              }),
              signal: AbortSignal.timeout(5000),
            }).catch(() => {});
          }

          console.log(`  [MOVERS] Top: ${winners.slice(0, 5).map(w => `${w.symbol}+${w.pct.toFixed(1)}%`).join(', ')} | Bottom: ${losers.slice(0, 5).map(l => `${l.symbol}${l.pct.toFixed(1)}%`).join(', ')}`);
          await postToDiscord(`📊 S&P 500 Movers ${today}:\n🟢 ${winners.slice(0, 7).map(w => `${w.symbol}+${w.pct.toFixed(1)}%`).join(', ')}\n🔴 ${losers.slice(0, 7).map(l => `${l.symbol}${l.pct.toFixed(1)}%`).join(', ')}`);
        }
      } catch {}
    }

    // ── 7. STATUS ────────────────────────────────────────────────────
    this.writeStatus(t0);
  }

  private _dailySummarySent = '';

  private writeStatus(t0: number): void {
    const dur = Date.now() - t0;
    try {
      this.store.set('trade_engine_status', JSON.stringify({
        heartbeatNumber: this.hbCount, lastHeartbeat: new Date(t0).toISOString(),
        durationMs: dur, mode: 'RSI2_CONNORS', errors: [], recentActivity: [],
      }));
    } catch {}

    // Trident daily summary near close
    const mkt = getMarketContext();
    const today = new Date().toISOString().slice(0, 10);
    if (mkt.etHour === 15 && mkt.etMin >= 55 && this._dailySummarySent !== today) {
      this._dailySummarySent = today;
      const trades = this.store.getTodayTrades();
      const wins = trades.filter(t => t.pnl > 0).length;
      const losses = trades.filter(t => t.pnl <= 0).length;
      const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
      brain.recordDailySummary(today, totalPnl, trades.length, wins, losses).catch(() => {});

      // SONA daily training — teach pattern of wins/losses for the day
      try {
        const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://trident.cetaceanlabs.com';
        const apiKey = process.env.BRAIN_API_KEY || '';
        if (apiKey) {
          const bh = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
          const topWins = trades.filter(t => t.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 3);
          const topLosses = trades.filter(t => t.pnl <= 0).sort((a, b) => a.pnl - b.pnl).slice(0, 3);
          fetch(`${BRAIN_URL}/v1/train`, {
            method: 'POST', headers: bh,
            body: JSON.stringify({
              input: `Daily summary ${today}: $${totalPnl.toFixed(0)} P&L, ${wins}W/${losses}L. Best: ${topWins.map(t => `${t.ticker}+$${t.pnl.toFixed(0)}`).join(',')}. Worst: ${topLosses.map(t => `${t.ticker}$${t.pnl.toFixed(0)}`).join(',')}`,
              output: totalPnl > 0 ? 'green_day' : 'red_day',
              metadata: { domain: 'daily_learning', pnl: totalPnl, wins, losses, date: today },
            }),
            signal: AbortSignal.timeout(5000),
          });
        }
      } catch {}

      // NOVA training — reinforce winning patterns, flag gaps
      try {
        const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://trident.cetaceanlabs.com';
        const apiKey = process.env.BRAIN_API_KEY || '';
        if (apiKey) {
          const bh = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
          // Train NOVA with today's outcomes
          fetch(`${BRAIN_URL}/v1/nova/train`, {
            method: 'POST', headers: bh,
            body: JSON.stringify({
              input: `AWB daily ${today}: $${totalPnl.toFixed(0)} P&L, ${wins}W/${losses}L, ${trades.length} trades`,
              output: totalPnl > 0 ? 'profitable_day' : 'losing_day',
              metadata: { domain: 'awb_daily', pnl: totalPnl, wins, losses },
            }),
            signal: AbortSignal.timeout(5000),
          }).catch(() => {});

          // Check NOVA gaps — what does it need more data on?
          fetch(`${BRAIN_URL}/v1/nova/gaps`, { headers: bh, signal: AbortSignal.timeout(5000) })
            .then(async (r) => {
              if (r.ok) {
                const gaps = await r.json();
                if (gaps.gaps?.length > 0) {
                  console.log(`  [NOVA] Knowledge gaps: ${JSON.stringify(gaps.gaps).slice(0, 100)}`);
                }
              }
            }).catch(() => {});
        }
      } catch {}
    }

    console.log(`[TE] === #${this.hbCount} done === ${dur}ms`);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  getRecentResults(): any[] { return []; }

  async start(): Promise<void> {
    console.log(`[TE] RSI-2 Connors engine starting — scan at 3:50 PM ET, ${MAX_POSITIONS} max, 5% stop, ${MAX_HOLD_DAYS}d time stop`);
    this.stopping = false;
    await this.heartbeat();
    this.timer = setInterval(() => { this.heartbeat().catch(e => console.error('[TE] Error:', e)); }, HEARTBEAT_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    console.log('[TE] Stopped.');
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

let _engine: TradeEngine | null = null;

export function createTradeEngine(sharedStore?: GatewayStateStore): TradeEngine {
  _engine = new TradeEngine(sharedStore);
  return _engine;
}

export async function start(sharedStore?: GatewayStateStore): Promise<TradeEngine> {
  const engine = createTradeEngine(sharedStore);
  await engine.start();
  return engine;
}

// Standalone mode: auto-start when run directly as a child process or script
if (process.argv[1]?.match(/trade-engine\.[tj]s$/)) {
  const engine = new TradeEngine();
  const shutdown = async () => { await engine.stop(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  engine.start().catch((e) => { console.error('[TE] Fatal:', e); process.exit(1); });
}

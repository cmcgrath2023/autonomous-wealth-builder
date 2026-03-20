/**
 * Research Worker — Standalone process that continuously scans markets
 * and writes research stars to the shared SQLite state store.
 *
 * 120-second loop: RSS news scan, 5-sector FACT analysis, Alpaca prices,
 * write stars + reports, expire stale stars (>4h).
 */

import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { MarketFACTCache } from '../../shared/src/fact-cache.js';
import { CredentialVault } from '../../qudag/src/vault.js';

const CYCLE_MS = 120_000;
const STAR_EXPIRY_HOURS = 4;
const MIN_USEFUL_SCORE = 0.68;
const DATA_URL = 'https://data.alpaca.markets';
const FETCH_TIMEOUT = 10_000;

const RSS_FEEDS = [
  { name: 'Yahoo SP500',  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US' },
  { name: 'Yahoo DJI',    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EDJI&region=US&lang=en-US' },
  { name: 'Yahoo Oil',    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=CL%3DF&region=US&lang=en-US' },
  { name: 'Yahoo Gold',   url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC%3DF&region=US&lang=en-US' },
  { name: 'Yahoo BTC',    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD&region=US&lang=en-US' },
  { name: 'Yahoo VIX',    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EVIX&region=US&lang=en-US' },
  { name: 'CNBC Top',     url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
  { name: 'CNBC Market',  url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
  { name: 'SA Currents',  url: 'https://seekingalpha.com/market_currents.xml' },
];

interface SectorDef { name: string; key: string; tickers: string[]; catalystKeywords: string[] }

const ETF_SET = new Set(['USO', 'UNG', 'XLE', 'GLD', 'COPX', 'CPER']);

const SECTORS: SectorDef[] = [
  { name: 'Energy', key: 'energy', tickers: ['XOM', 'HAL', 'CVX', 'KOS', 'OXY', 'SLB', 'USO', 'UNG', 'XLE'],
    catalystKeywords: ['oil', 'crude', 'iran', 'opec', 'energy', 'pipeline', 'lng', 'petroleum'] },
  { name: 'Defense', key: 'defense', tickers: ['RTX', 'LMT', 'NOC', 'GD', 'BA'],
    catalystKeywords: ['war', 'military', 'defense', 'iran', 'missile', 'conflict', 'pentagon'] },
  { name: 'Metals', key: 'metals', tickers: ['FCX', 'AA', 'MP', 'NEM', 'GLD', 'COPX', 'CPER'],
    catalystKeywords: ['gold', 'copper', 'aluminum', 'rare earth', 'mining', 'metal', 'silver'] },
  { name: 'AI/DC', key: 'ai_infrastructure', tickers: ['NVDA', 'VRT', 'NRG', 'EQIX', 'NET', 'SMCI'],
    catalystKeywords: ['ai', 'data center', 'gpu', 'semiconductor', 'nvidia', 'chip', 'cloud'] },
  { name: 'Crypto', key: 'crypto_macro', tickers: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOT-USD'],
    catalystKeywords: ['bitcoin', 'crypto', 'ethereum', 'defi', 'regulation', 'sec', 'etf'] },
];

// --- RSS ---

interface NewsItem { title: string; tickers: string[]; sentiment: 'bullish' | 'bearish' | 'neutral'; source: string }

const BULL_RE = /surge|rally|soar|jump|gain|climb|beat|record|high|upgrade|bull|boom|strong/gi;
const BEAR_RE = /crash|drop|plunge|fall|sink|miss|low|downgrade|bear|bust|weak|cut|fear|risk|war/gi;
const TICKER_RE = /\b([A-Z]{1,5}(?:-USD)?)\b/g;
const KNOWN_TICKERS = new Set(SECTORS.flatMap((s) => s.tickers));

function sentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const bull = (text.match(BULL_RE) || []).length;
  const bear = (text.match(BEAR_RE) || []).length;
  return bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral';
}

function extractTickers(text: string): string[] {
  return [...new Set((text.match(TICKER_RE) || []).filter((t) => KNOWN_TICKERS.has(t)))];
}

function parseRss(xml: string): string[] {
  const titles: string[] = [];
  const re = /<item>[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const t = m[0].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    if (t) titles.push(t[1].trim());
  }
  return titles;
}

async function scanRssFeeds(): Promise<NewsItem[]> {
  const all: NewsItem[] = [];
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const r = await fetch(feed.url, {
        headers: { 'User-Agent': 'MTWM-ResearchWorker/2.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!r.ok) return [];
      return parseRss(await r.text()).map((title) => ({
        title, tickers: extractTickers(title), sentiment: sentiment(title), source: feed.name,
      }));
    }),
  );
  for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);
  return all;
}

// --- Alpaca Prices ---

function getAlpacaHeaders(): Record<string, string> | null {
  const key = process.env.ALPACA_API_KEY || process.env.APCA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET || process.env.APCA_API_SECRET_KEY;
  if (key && secret) return { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
  try {
    const pw = process.env.MTWM_VAULT_KEY || process.env.VAULT_MASTER_PASSWORD || 'mtwm-local-dev-key';
    if (!pw) return null;
    const v = new CredentialVault(pw);
    const k = v.retrieve('alpaca-api-key'), s = v.retrieve('alpaca-api-secret');
    v.close();
    if (k && s) return { 'APCA-API-KEY-ID': k, 'APCA-API-SECRET-KEY': s };
  } catch { /* vault unavailable */ }
  return null;
}

const isCrypto = (t: string) => t.includes('-USD') || t.includes('/USD');

interface Snap { price: number; changePercent: number }

function parseSnap(snap: { latestTrade?: { p: number }; dailyBar?: { o: number; c: number } }): Snap | null {
  const price = snap.latestTrade?.p || snap.dailyBar?.c || 0;
  if (price <= 0) return null;
  const open = snap.dailyBar?.o || price;
  return { price, changePercent: open > 0 ? ((price - open) / open) * 100 : 0 };
}

async function fetchSnapshots(tickers: string[], headers: Record<string, string>): Promise<Map<string, Snap>> {
  const prices = new Map<string, Snap>();
  const stocks = tickers.filter((t) => !isCrypto(t));
  const crypto = tickers.filter(isCrypto);

  if (stocks.length > 0) {
    try {
      const r = await fetch(`${DATA_URL}/v2/stocks/snapshots?symbols=${stocks.join(',')}&feed=iex`,
        { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (r.ok) {
        const data = (await r.json()) as Record<string, any>;
        for (const [sym, s] of Object.entries(data)) { const p = parseSnap(s); if (p) prices.set(sym, p); }
      }
    } catch (e) { console.error('[Research] Stock snapshot failed:', e); }
  }

  if (crypto.length > 0) {
    try {
      const syms = crypto.map((t) => t.replace('-', '/')).join(',');
      const r = await fetch(`${DATA_URL}/v1beta3/crypto/us/snapshots?symbols=${syms}`,
        { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (r.ok) {
        const data = (await r.json()) as { snapshots?: Record<string, any> };
        for (const [sym, s] of Object.entries(data.snapshots || {})) {
          const p = parseSnap(s); if (p) prices.set(sym.replace('/', '-'), p);
        }
      }
    } catch (e) { console.error('[Research] Crypto snapshot failed:', e); }
  }

  return prices;
}

// --- Sector Analysis ---

function analyzeSector(sector: SectorDef, prices: Map<string, Snap>, news: NewsItem[], fc: MarketFACTCache) {
  const movers = sector.tickers
    .map((t) => { const s = prices.get(t); return s ? { ticker: t, price: s.price, change: s.changePercent } : null; })
    .filter(Boolean) as Array<{ ticker: string; price: number; change: number }>;
  movers.sort((a, b) => b.change - a.change);

  const posCount = movers.filter((m) => m.change > 0).length;
  const condition = posCount > movers.length * 0.6 ? 'bullish' : posCount < movers.length * 0.4 ? 'bearish' : 'mixed';

  const sectorNews = news.filter((n) =>
    n.tickers.some((t) => sector.tickers.includes(t)) ||
    sector.catalystKeywords.some((kw) => n.title.toLowerCase().includes(kw)));
  const bullN = sectorNews.filter((n) => n.sentiment === 'bullish').length;
  const bearN = sectorNews.filter((n) => n.sentiment === 'bearish').length;
  const newsSent = bullN > bearN ? 'bullish' : bearN > bullN ? 'bearish' : 'neutral';

  const cat0 = sector.catalystKeywords[0] || 'general';
  const cache = fc.lookup(sector.name, cat0, condition);

  // Build instrument list
  const instruments: string[] = [];
  if (cache.hit && cache.pattern) {
    for (const t of cache.pattern.instruments) if (sector.tickers.includes(t) && !instruments.includes(t)) instruments.push(t);
  }
  const topMovers = movers.filter((m) => m.change > 0 && !ETF_SET.has(m.ticker)).slice(0, 4);
  for (const m of topMovers) if (!instruments.includes(m.ticker)) instruments.push(m.ticker);

  // Score: bullish news + keyword match => 0.85, sector bullish => 0.80, mixed => 0.72
  const hasKeywordNews = newsSent === 'bullish' && sector.catalystKeywords.some((kw) =>
    sectorNews.some((n) => n.title.toLowerCase().includes(kw)));
  const baseScore = hasKeywordNews ? 0.85 : condition === 'bullish' ? 0.80 : condition === 'mixed' ? 0.72 : 0.55;
  const scores = new Map(instruments.map((t) => [t, baseScore]));

  // FACT cache store/update
  if (!cache.hit && instruments.length > 0) {
    const act = condition === 'bullish' ? 'BUY' : condition === 'bearish' ? 'DEFENSIVE' : 'SELECTIVE';
    fc.store(sector.name, cat0, condition, `${act}: ${instruments.join(', ')}`, instruments,
      `${sector.name} ${condition}, ${sectorNews.length} news, movers: ${topMovers.map((m) => m.ticker).join(', ')}`);
  } else if (cache.hit) {
    fc.recordOutcome(sector.name, cat0, condition,
      condition === 'bullish' || (condition === 'mixed' && movers.some((m) => m.change > 1)));
  }

  const catParts = [sectorNews.length > 0 ? `${sectorNews.length} news (${newsSent})` : '', `sector ${condition}`, cache.hit ? `FACT ${cache.tier}` : ''].filter(Boolean);
  const topStr = movers.slice(0, 3).map((m) => `${m.ticker} ${m.change > 0 ? '+' : ''}${m.change.toFixed(1)}%`).join(', ');
  const narrative = `${sector.name}: ${condition} | ${movers.length} tracked | Top: ${topStr || 'no data'} | News: ${sectorNews.length}`;

  return { instruments, condition, catalyst: catParts.join('; '), scores, narrative };
}

// --- Main Cycle ---

async function runCycle(store: GatewayStateStore, factCache: MarketFACTCache): Promise<void> {
  const t0 = Date.now();
  const errors: string[] = [];
  let starsWritten = 0, reportsWritten = 0;

  // 1. RSS
  let news: NewsItem[] = [];
  try { news = await scanRssFeeds(); console.log(`[Research] RSS: ${news.length} items`); }
  catch (e) { errors.push(`RSS: ${e}`); console.error('[Research] RSS failed:', e); }

  // 2. Prices
  const headers = getAlpacaHeaders();
  const allTickers = [...new Set(SECTORS.flatMap((s) => s.tickers))];
  let prices = new Map<string, Snap>();
  if (headers) {
    try { prices = await fetchSnapshots(allTickers, headers); console.log(`[Research] Prices: ${prices.size}/${allTickers.length}`); }
    catch (e) { errors.push(`Prices: ${e}`); console.error('[Research] Price fetch failed:', e); }
  } else { console.warn('[Research] No Alpaca credentials -- skipping prices'); }

  // 3. Sectors (each independent -- one failure does not stop others)
  for (const sector of SECTORS) {
    try {
      const r = analyzeSector(sector, prices, news, factCache);
      for (const t of r.instruments) {
        const sc = r.scores.get(t) || 0;
        if (sc >= MIN_USEFUL_SCORE) { store.saveResearchStar(t, sector.name, `${r.catalyst} | ${r.condition}`, sc); starsWritten++; }
      }
      store.saveReport({
        id: `research-${sector.key}-${Date.now()}`, agent: 'research-worker', type: `sector_${sector.key}`,
        timestamp: new Date().toISOString(), summary: r.narrative,
        findings: [r.narrative, `Instruments: ${r.instruments.join(', ') || 'none'}`,
          ...r.instruments.map((t) => { const s = prices.get(t); return s ? `${t}: $${s.price.toFixed(2)} (${s.changePercent > 0 ? '+' : ''}${s.changePercent.toFixed(1)}%)` : t; })],
        signals: r.instruments.map((t) => ({ symbol: t, direction: r.condition === 'bearish' ? 'short' : 'long', score: r.scores.get(t) || 0 })),
      });
      reportsWritten++;
      console.log(`[Research] ${sector.name}: ${r.condition} | ${r.instruments.length} instruments`);
    } catch (e) { errors.push(`${sector.name}: ${e}`); console.error(`[Research] ${sector.name} failed:`, e); }
  }

  // 4. Promote high-conviction direct news hits
  for (const item of news) {
    if (item.sentiment === 'bullish' && item.tickers.length > 0) {
      for (const t of item.tickers) {
        const s = prices.get(t);
        if (s && s.changePercent > 0.5) { store.saveResearchStar(t, 'news', `NEWS: ${item.title.substring(0, 80)}`, 0.85); starsWritten++; }
      }
    }
  }

  // 5. Expire stale stars
  const expired = store.clearExpiredStars(STAR_EXPIRY_HOURS);
  console.log(`[Research] Cycle ${Date.now() - t0}ms | stars=${starsWritten} expired=${expired} reports=${reportsWritten} news=${news.length} prices=${prices.size} errors=${errors.length}`);
}

// --- Lifecycle ---

let running = false;
let cycleTimer: ReturnType<typeof setTimeout> | undefined;
let store: GatewayStateStore | undefined;

async function scheduleCycle(fc: MarketFACTCache): Promise<void> {
  if (!running || !store) return;
  try { await runCycle(store, fc); } catch (e) { console.error('[Research] Cycle error (non-fatal):', e); }
  if (running) cycleTimer = setTimeout(() => scheduleCycle(fc), CYCLE_MS);
}

export async function start(dbPath?: string): Promise<void> {
  if (running) return;
  running = true;
  const db = dbPath || process.env.GATEWAY_DB_PATH || 'data/gateway-state.db';
  store = new GatewayStateStore(db);
  console.log(`[Research] Worker starting (db=${db}, cycle=${CYCLE_MS / 1000}s)`);
  await scheduleCycle(new MarketFACTCache());
}

export function stop(): void {
  running = false;
  if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = undefined; }
  store?.close(); store = undefined;
  console.log('[Research] Worker stopped');
}

// --- Standalone entry ---

if (process.argv[1]?.match(/research-worker\.[tj]s$/)) {
  const shutdown = () => { console.log('[Research] Shutting down'); stop(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  start().catch((e) => { console.error('[Research] Fatal:', e); process.exit(1); });
}

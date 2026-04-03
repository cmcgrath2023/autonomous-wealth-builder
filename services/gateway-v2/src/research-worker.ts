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
import { BayesianIntelligence } from '../../shared/intelligence/bayesian-intelligence.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { brain } from './brain-client.js';

// FIX 1 & 3: Bayesian filter for research stars — adjust scores based on trade outcomes
let _bayesian: BayesianIntelligence | null = null;
eventBus.on('intelligence:ready' as any, (bi: BayesianIntelligence) => { _bayesian = bi; });

function bayesianAdjustScore(ticker: string, rawScore: number): number {
  if (!_bayesian) return rawScore;
  const prior = _bayesian.getTickerPrior(ticker);
  if (prior.observations < 3) return rawScore; // not enough data
  // Penalize tickers with bad track records, boost proven winners
  return _bayesian.adjustSignalConfidence(ticker, rawScore, 'buy');
}

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
  { name: 'Bloomberg',   url: 'https://feeds.bloomberg.com/markets/news.rss' },
  { name: 'Barrons',     url: 'https://www.barrons.com/market-data/rss' },
  { name: 'MW TopStories', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
];

interface SectorDef { name: string; key: string; tickers: string[]; catalystKeywords: string[] }

const ETF_SET = new Set(['USO', 'UNG', 'XLE', 'GLD', 'COPX', 'CPER']);

const SECTORS: SectorDef[] = [
  { name: 'Energy', key: 'energy', tickers: ['XOM', 'HAL', 'CVX', 'KOS', 'OXY', 'SLB', 'USO', 'UNG', 'XLE', 'COP', 'EOG', 'DVN'],
    catalystKeywords: ['oil', 'crude', 'iran', 'opec', 'energy', 'pipeline', 'lng', 'petroleum', 'brent', 'wti'] },
  { name: 'Defense', key: 'defense', tickers: ['RTX', 'LMT', 'NOC', 'GD', 'BA', 'LHX', 'HII'],
    catalystKeywords: ['war', 'military', 'defense', 'iran', 'missile', 'conflict', 'pentagon', 'nato'] },
  { name: 'Metals', key: 'metals', tickers: ['FCX', 'AA', 'MP', 'NEM', 'GLD', 'COPX', 'CPER', 'SLV'],
    catalystKeywords: ['gold', 'copper', 'aluminum', 'rare earth', 'mining', 'metal', 'silver'] },
  { name: 'AI/DC', key: 'ai_infrastructure', tickers: ['NVDA', 'MRVL', 'AMD', 'VRT', 'NRG', 'EQIX', 'NET', 'SMCI', 'MSFT', 'GOOGL', 'PLTR', 'CRWV'],
    catalystKeywords: ['ai', 'data center', 'gpu', 'semiconductor', 'nvidia', 'chip', 'cloud', 'openai', 'marvel', 'marvell'] },
  { name: 'Nuclear/Uranium', key: 'nuclear', tickers: ['CCJ', 'LEU', 'URA', 'NNE', 'SMR', 'OKLO', 'DNN', 'UEC'],
    catalystKeywords: ['uranium', 'nuclear', 'reactor', 'enrichment', 'smr', 'fission', 'power plant'] },
  { name: 'Crypto', key: 'crypto_macro', tickers: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOT-USD', 'COIN', 'MARA', 'RIOT'],
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

  // 3. Dynamic discovery — scan Alpaca top movers and most actives
  if (headers) {
    try {
      const [moversRes, activesRes] = await Promise.allSettled([
        fetch('https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=20', { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) }),
        fetch('https://data.alpaca.markets/v1beta1/screener/stocks/most-actives?top=20&by=volume', { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) }),
      ]);

      // Top gainers — these are TODAY's actual movers
      if (moversRes.status === 'fulfilled' && moversRes.value.ok) {
        const data = await moversRes.value.json() as any;
        const gainers = (data.gainers || []).filter((m: any) => m.percent_change > 2 && m.price > 5 && m.price < 500);
        for (const g of gainers.slice(0, 10)) {
          const score = Math.min(0.90 + g.percent_change / 100, 0.99);
          store.saveResearchStar(g.symbol, 'momentum', `TOP MOVER +${g.percent_change.toFixed(1)}% | Vol: ${(g.trade_count || 0).toLocaleString()}`, bayesianAdjustScore(g.symbol, score));
          starsWritten++;
          // Also fetch the price so it's in our snapshot map
          if (!prices.has(g.symbol)) prices.set(g.symbol, { price: g.price, changePercent: g.percent_change });
        }
        console.log(`[Research] Movers: ${gainers.length} gainers (top: ${gainers.slice(0, 3).map((g: any) => `${g.symbol} +${g.percent_change.toFixed(0)}%`).join(', ')})`);
      }

      // Most actives by volume — high volume = institutional interest
      if (activesRes.status === 'fulfilled' && activesRes.value.ok) {
        const data = await activesRes.value.json() as any;
        const actives = (data.most_actives || []).filter((m: any) => m.price > 5 && m.price < 500 && m.trade_count > 10000);
        for (const a of actives.slice(0, 5)) {
          if (!prices.has(a.symbol)) {
            const score = 0.75; // active but unknown direction — lower than movers
            store.saveResearchStar(a.symbol, 'volume', `MOST ACTIVE | Vol: ${(a.trade_count || 0).toLocaleString()} | $${a.price.toFixed(2)}`, score);
            starsWritten++;
          }
        }
      }
    } catch (e) { errors.push(`Discovery: ${e}`); }
  }

  // 3b. Yahoo Finance gainers — supplements Alpaca with broader market coverage
  try {
    const yahooRes = await fetch('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=20', {
      headers: { 'User-Agent': 'MTWM/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (yahooRes.ok) {
      const yahooData = await yahooRes.json() as any;
      const quotes = yahooData?.finance?.result?.[0]?.quotes || [];
      const yahooGainers = quotes.filter((q: any) => q.regularMarketPrice > 5 && q.regularMarketPrice < 500 && q.regularMarketChangePercent > 5);
      let yahooAdded = 0;
      for (const q of yahooGainers.slice(0, 10)) {
        // Only add if not already a star from Alpaca (avoid duplicates)
        const existing = store.getResearchStars().find((s: any) => s.symbol === q.symbol);
        if (!existing) {
          const score = Math.min(0.85 + q.regularMarketChangePercent / 200, 0.95);
          store.saveResearchStar(q.symbol, 'momentum', `YAHOO GAINER +${q.regularMarketChangePercent.toFixed(1)}% | Vol: ${(q.regularMarketVolume || 0).toLocaleString()}`, bayesianAdjustScore(q.symbol, score));
          starsWritten++;
          yahooAdded++;
        }
      }
      if (yahooAdded > 0) console.log(`[Research] Yahoo: ${yahooAdded} new gainers added (${yahooGainers.length} total, ${yahooAdded} unique)`);
    }
  } catch (e) { errors.push(`Yahoo: ${e}`); }

  // 3c. Crypto — scan Alpaca crypto movers (24/7 market, 100% win rate historically)
  if (headers) {
    const CRYPTO_PAIRS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BCH/USD', 'AVAX/USD', 'LINK/USD', 'DOGE/USD', 'LTC/USD'];
    try {
      const symbols = CRYPTO_PAIRS.join(',');
      const cryptoRes = await fetch(`https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${symbols}`, {
        headers, signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (cryptoRes.ok) {
        const snapData = await cryptoRes.json() as any;
        const snapshots = snapData.snapshots || snapData;
        let cryptoAdded = 0;
        for (const pair of CRYPTO_PAIRS) {
          const snap = snapshots[pair];
          if (!snap) continue;
          const price = snap.latestTrade?.p || snap.latestQuote?.ap;
          const prevClose = snap.prevDailyBar?.c || snap.dailyBar?.o;
          if (!price || !prevClose) continue;
          const changePct = ((price - prevClose) / prevClose) * 100;
          // Only add if moving > 1% (crypto is volatile, lower threshold than equities)
          if (Math.abs(changePct) > 1) {
            const ticker = pair.replace('/', '-'); // BTC/USD → BTC-USD for Alpaca orders
            const direction = changePct > 0 ? 'UP' : 'DOWN';
            const score = Math.min(0.80 + Math.abs(changePct) / 50, 0.95);
            store.saveResearchStar(ticker, 'crypto', `CRYPTO ${direction} ${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}% | $${price.toFixed(2)}`, score);
            starsWritten++;
            cryptoAdded++;
          }
        }
        if (cryptoAdded > 0) console.log(`[Research] Crypto: ${cryptoAdded} pairs moving >1%`);
      }
    } catch (e) { errors.push(`Crypto: ${e}`); }
  }

  // 4. Research is dynamic from Alpaca movers, Yahoo gainers, crypto, most actives, and news
  console.log(`[Research] Dynamic discovery: ${starsWritten} stars from all sources`);

  // 5. Promote news-mentioned tickers — fetch prices for unknown tickers on the fly
  const ALL_STOCK_RE = /\b([A-Z]{2,5})\b/g;
  const NOISE_WORDS = new Set(['THE','AND','FOR','INC','NEW','CEO','IPO','ETF','SEC','FED','GDP','CPI','ECB','NYSE','API','USA','USD','FDA','CEO','CFO','CTO','LLC','LTD','BUY','PUT','GET','HAS','HAD','WAS','ARE','NOT','ALL','CAN','HER','HIS','HOW','ITS','MAY','OLD','OUR','OUT','OWN','SAY','SHE','TOO','USE','HIM','WAR','WHO','BOY','DID','OIL','RUN','TOP','TRY','TWO']);
  const newsTickersToFetch = new Set<string>();

  for (const item of news) {
    if (item.sentiment === 'bullish' || item.sentiment === 'neutral') {
      const mentioned = [...new Set((item.title.match(ALL_STOCK_RE) || []).filter(t => t.length >= 2 && t.length <= 5 && !NOISE_WORDS.has(t)))];
      for (const t of mentioned) {
        const s = prices.get(t);
        if (s && s.changePercent > 2) {
          store.saveResearchStar(t, 'news', `NEWS: ${item.title.substring(0, 80)}`, 0.90);
          starsWritten++;
        } else if (!s && !store.getResearchStars().find((st: any) => st.symbol === t)) {
          newsTickersToFetch.add(t);
        }
      }
    }
  }

  // Fetch prices for news-mentioned tickers not in our sector lists
  if (newsTickersToFetch.size > 0 && headers) {
    try {
      const syms = [...newsTickersToFetch].slice(0, 20).join(',');
      const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${syms}&feed=iex`, {
        headers, signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (snapRes.ok) {
        const snapData = await snapRes.json() as any;
        let newsAdded = 0;
        for (const [sym, snap] of Object.entries(snapData) as [string, any][]) {
          const price = snap?.latestTrade?.p;
          const prevClose = snap?.prevDailyBar?.c;
          if (!price || !prevClose || price < 5 || price > 500) continue;
          const pct = ((price - prevClose) / prevClose) * 100;
          if (pct > 2) {
            // Find the news headline that mentioned this ticker
            const headline = news.find(n => n.title.includes(sym))?.title || '';
            store.saveResearchStar(sym, 'news', `NEWS +${pct.toFixed(1)}%: ${headline.substring(0, 70)}`, 0.90);
            starsWritten++;
            newsAdded++;
          }
        }
        if (newsAdded > 0) console.log(`[Research] News tickers: ${newsAdded} new from headlines (fetched ${newsTickersToFetch.size})`);
      }
    } catch (e) { errors.push(`News ticker fetch: ${e}`); }
  }

  // 5b. Catalyst-driven stars — Liza's active_catalysts → sector tickers
  //     This closes the intelligence → action gap (Lesson 1 + 6)
  // Map catalyst categories to tradeable tickers (mirrors SECTORS)
  const CATALYST_TICKERS: Record<string, string[]> = {
    energy:          ['XOM', 'OXY', 'CVX', 'HAL', 'SLB', 'KOS', 'USO', 'UNG', 'COP', 'EOG'],
    tech_ai:         ['NVDA', 'MRVL', 'AMD', 'VRT', 'SMCI', 'MSFT', 'GOOGL', 'PLTR', 'CRWV'],
    ai_infrastructure: ['NVDA', 'MRVL', 'AMD', 'VRT', 'SMCI', 'MSFT', 'GOOGL', 'PLTR', 'CRWV'],
    crypto:          ['BTC-USD', 'ETH-USD', 'SOL-USD', 'COIN', 'MARA', 'RIOT'],
    crypto_macro:    ['BTC-USD', 'ETH-USD', 'SOL-USD', 'COIN', 'MARA', 'RIOT'],
    macro:           ['GLD', 'USO', 'UNG', 'SPY', 'QQQ'],
    defense:         ['LMT', 'RTX', 'NOC', 'GD', 'BA', 'LHX'],
    metals:          ['FCX', 'AA', 'NEM', 'GLD', 'SLV'],
    nuclear:         ['CCJ', 'LEU', 'URA', 'NNE', 'SMR', 'OKLO', 'UEC'],
  };
  try {
    const catalystRaw = store.get('active_catalysts');
    if (catalystRaw) {
      const { catalysts } = JSON.parse(catalystRaw) as { catalysts: string[] };
      let catalystAdded = 0;
      for (const cat of catalysts) {
        const tickers = CATALYST_TICKERS[cat] || [];
        for (const ticker of tickers) {
          // Only add if it's actually moving (have price data) and not already a star
          const existing = store.getResearchStars().find((s: any) => s.symbol === ticker);
          if (existing) continue; // already tracked
          const p = prices.get(ticker);
          if (p && p.changePercent > 1) {
            store.saveResearchStar(ticker, 'catalyst', `CATALYST(${cat}): ${ticker} +${p.changePercent.toFixed(1)}%`, 0.90);
            starsWritten++;
            catalystAdded++;
          }
        }
      }
      if (catalystAdded > 0) console.log(`[Research] Catalysts: ${catalystAdded} tickers from active catalysts [${catalysts.join(',')}]`);
    }
  } catch {}

  // 6. Expire stale stars
  const expired = store.clearExpiredStars(STAR_EXPIRY_HOURS);
  console.log(`[Research] Cycle ${Date.now() - t0}ms | stars=${starsWritten} expired=${expired} reports=${reportsWritten} news=${news.length} prices=${prices.size} errors=${errors.length}`);

  // 7. Record research to Trident — learning coherence across sessions
  if (starsWritten > 0) {
    try {
      const allStars = store.getResearchStars();
      const topStars = allStars.sort((a: any, b: any) => b.score - a.score).slice(0, 10);
      const summary = topStars.map((s: any) => `${s.symbol} (${s.sector}) score:${s.score.toFixed(2)} — ${s.catalyst || ''}`).join('\n');
      const newsHeadlines = news.filter(n => n.sentiment === 'bullish').slice(0, 5).map(n => `[${n.source}] ${n.title}`).join('\n');

      brain.recordResearchCycle({
        date: new Date().toISOString(),
        starsCount: allStars.length,
        topStars: topStars.map((s: any) => ({ symbol: s.symbol, sector: s.sector, score: s.score })),
        summary,
        newsHeadlines,
        errors,
      }).catch(e => console.error(`[Research] Trident write failed: ${e.message}`));
    } catch {}
  }
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
  // FIX 5: Persist FACT cache across restarts
  const factCache = new MarketFACTCache();
  try {
    const saved = store.get('fact_cache_state');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.patterns) {
        for (const [k, v] of data.patterns) (factCache as any).patterns.set(k, v);
        console.log(`[Research] FACT cache restored: ${data.patterns.length} patterns`);
      }
    }
  } catch {}
  // Save FACT cache every 5 minutes
  setInterval(() => {
    try {
      const patterns = [...(factCache as any).patterns.entries()];
      store!.set('fact_cache_state', JSON.stringify({ patterns }));
    } catch {}
  }, 300_000);

  await scheduleCycle(factCache);
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

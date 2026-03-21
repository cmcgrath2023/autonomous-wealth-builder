/**
 * Data Feed Worker — Standalone process that loads market data WITHOUT blocking.
 * Fix for old gateway hanging 30-60s: quotes refresh every 60s, historical bars
 * bootstrap in small batches with setTimeout between them, all written to state store.
 */

import { MidStream } from '../../midstream/src/index.js';
import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { loadCredentials } from './config-bus.js';

const QUOTE_INTERVAL_MS = 60_000;
const BOOTSTRAP_BATCH_SIZE = 5;
const BOOTSTRAP_BATCH_DELAY_MS = 100;
const HISTORY_DAYS_CRYPTO = 7;
const HISTORY_DAYS_STOCK = 14;
const DATA_URL = 'https://data.alpaca.markets';

let running = false;
let quoteTimer: ReturnType<typeof setInterval> | undefined;
let midstream: MidStream | undefined;
let store: GatewayStateStore | undefined;

function writeQuotesToStore(quotes: Array<{ ticker: string; [k: string]: unknown }>): void {
  if (!store || quotes.length === 0) return;
  for (const q of quotes) {
    try {
      store.set(`quote:${q.ticker}`, JSON.stringify(q));
    } catch (err) {
      console.error(`[DataFeed] Failed to write quote for ${q.ticker}:`, err);
    }
  }
  store.set('quotes:lastUpdated', new Date().toISOString());
  console.log(`[DataFeed] Wrote ${quotes.length} quotes to state store`);
}

async function refreshQuotes(): Promise<void> {
  if (!midstream) return;
  try {
    const quotes = await midstream.fetchQuotes();
    writeQuotesToStore(quotes);
  } catch (err) {
    console.error('[DataFeed] Quote refresh failed:', err);
  }
}

// --- Historical bootstrap (non-blocking batches) ---

function getAlpacaHeaders(): Record<string, string> | null {
  const creds = loadCredentials();
  const key = creds.alpaca?.apiKey || process.env.ALPACA_API_KEY || process.env.APCA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET || process.env.APCA_API_SECRET_KEY;
  if (!key || !secret) return null;
  return { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
}

async function fetchBars(
  symbol: string,
  isCrypto: boolean,
  headers: Record<string, string>,
): Promise<{ ticker: string; closes: number[]; highs: number[]; lows: number[]; volumes: number[] } | null> {
  const end = new Date().toISOString();
  const days = isCrypto ? HISTORY_DAYS_CRYPTO : HISTORY_DAYS_STOCK;
  const start = new Date(Date.now() - days * 86_400_000).toISOString();

  const url = isCrypto
    ? `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${symbol}&timeframe=1Hour&start=${start}&end=${end}&limit=200`
    : `${DATA_URL}/v2/stocks/bars?symbols=${symbol}&timeframe=1Hour&start=${start}&end=${end}&limit=200&feed=iex`;

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { bars?: Record<string, Array<{ c: number; h: number; l: number; v: number }>> };
    const bars = data.bars?.[symbol] || [];
    if (bars.length === 0) return null;
    const ticker = isCrypto ? symbol.replace('/', '-') : symbol;
    return {
      ticker,
      closes: bars.map((b) => b.c),
      highs: bars.map((b) => b.h),
      lows: bars.map((b) => b.l),
      volumes: bars.map((b) => b.v),
    };
  } catch {
    return null;
  }
}

async function bootstrapBatch(symbols: string[], isCrypto: boolean, headers: Record<string, string>): Promise<number> {
  let loaded = 0;
  for (const symbol of symbols) {
    if (!running) break;
    const result = await fetchBars(symbol, isCrypto, headers);
    if (result) {
      store?.set(`history:${result.ticker}`, JSON.stringify(result));
      loaded++;
    }
  }
  return loaded;
}

function scheduleBatches(allSymbols: string[], isCrypto: boolean, headers: Record<string, string>): void {
  let offset = 0;

  function nextBatch() {
    if (!running || offset >= allSymbols.length) return;
    const batch = allSymbols.slice(offset, offset + BOOTSTRAP_BATCH_SIZE);
    offset += BOOTSTRAP_BATCH_SIZE;

    bootstrapBatch(batch, isCrypto, headers).then((loaded) => {
      const label = isCrypto ? 'crypto' : 'stock';
      console.log(`[DataFeed] Bootstrap ${label} batch: ${loaded}/${batch.length} loaded (${offset}/${allSymbols.length} total)`);
      if (running && offset < allSymbols.length) {
        setTimeout(nextBatch, BOOTSTRAP_BATCH_DELAY_MS);
      }
    });
  }

  // Kick off first batch on next tick -- never synchronous
  setTimeout(nextBatch, 0);
}

function startBootstrap(): void {
  const headers = getAlpacaHeaders();
  if (!headers) {
    console.warn('[DataFeed] No Alpaca credentials -- skipping historical bootstrap');
    return;
  }

  const cryptoSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'LINK/USD', 'DOGE/USD'];
  const stockSymbols = [
    'TSLA', 'NVDA', 'AMD', 'COIN', 'MARA', 'RIOT', 'PLTR', 'SOFI',
    'LMT', 'RTX', 'NOC', 'GD', 'BA', 'LHX',
    'SQQQ', 'SPXS', 'UVXY', 'SH', 'PSQ',
    'USO', 'UNG', 'UGA', 'DBO', 'GSG', 'DBA',
    'SLV', 'GLD', 'SIVR', 'GDX', 'GDXJ',
    'SPY', 'QQQ', 'IWM',
  ];

  console.log(`[DataFeed] Starting historical bootstrap: ${cryptoSymbols.length} crypto, ${stockSymbols.length} stocks`);
  scheduleBatches(cryptoSymbols, true, headers);
  // Stagger stock bootstrap to avoid hammering the API
  setTimeout(() => scheduleBatches(stockSymbols, false, headers), 2_000);
}

// --- Lifecycle ---

export async function start(dbPath?: string): Promise<void> {
  if (running) return;
  running = true;
  console.log('[DataFeed] Worker starting');

  store = new GatewayStateStore(dbPath);

  const apiKey = process.env.ALPACA_API_KEY || process.env.APCA_API_KEY_ID;
  const apiSecret = process.env.ALPACA_API_SECRET || process.env.APCA_API_SECRET_KEY;

  midstream = new MidStream({
    alpacaApiKey: apiKey,
    alpacaApiSecret: apiSecret,
    refreshIntervalMs: QUOTE_INTERVAL_MS,
  });

  // Initial quote fetch -- awaited once so trade engine has data on first read
  await refreshQuotes();
  console.log('[DataFeed] Initial quotes loaded');

  // Periodic refresh -- not using MidStream's built-in interval since we need store writes
  quoteTimer = setInterval(() => refreshQuotes(), QUOTE_INTERVAL_MS);

  // Background historical bootstrap -- never blocks
  startBootstrap();

  console.log('[DataFeed] Worker ready');
}

export function stop(): void {
  running = false;
  if (quoteTimer) {
    clearInterval(quoteTimer);
    quoteTimer = undefined;
  }
  midstream?.stop();
  store?.close();
  console.log('[DataFeed] Worker stopped');
}

// --- Run as standalone process ---

if (process.argv[1] && (process.argv[1].endsWith('data-feed.ts') || process.argv[1].endsWith('data-feed.js'))) {
  process.on('SIGTERM', () => {
    console.log('[DataFeed] SIGTERM received, shutting down');
    stop();
  });
  process.on('SIGINT', () => {
    console.log('[DataFeed] SIGINT received, shutting down');
    stop();
  });
  start().catch((err) => {
    console.error('[DataFeed] Fatal error:', err);
    process.exit(1);
  });
}

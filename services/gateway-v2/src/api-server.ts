import express, { Request, Response } from 'express';
import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { CredentialVault } from '../../qudag/src/vault.js';

// ---------------------------------------------------------------------------
// Alpaca proxy config — vault first, env fallback
// ---------------------------------------------------------------------------
let _alpacaKey = process.env.ALPACA_API_KEY || '';
let _alpacaSec = process.env.ALPACA_API_SECRET || '';
let _alpacaBase = 'https://paper-api.alpaca.markets';

try {
  const vault = new CredentialVault(process.env.MTWM_VAULT_KEY || 'mtwm-local-dev-key');
  const vk = vault.retrieve('alpaca-api-key');
  const vs = vault.retrieve('alpaca-api-secret');
  const vm = vault.retrieve('alpaca-mode');
  if (vk && vs) {
    _alpacaKey = vk; _alpacaSec = vs;
    _alpacaBase = vm === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
    console.log(`[API] Vault: Alpaca ${vm || 'paper'}`);
  }
} catch { /* vault unavailable */ }

function alpacaHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': _alpacaKey,
    'APCA-API-SECRET-KEY': _alpacaSec,
    'Content-Type': 'application/json',
  };
}

function hasAlpacaCreds(): boolean {
  return !!(_alpacaKey && _alpacaSec);
}

const ALPACA_BASE = _alpacaBase;

// ---------------------------------------------------------------------------
// Response cache — stores last successful Alpaca response per endpoint key
// ---------------------------------------------------------------------------
const responseCache = new Map<string, { data: unknown; ts: number }>();

function setCache(key: string, data: unknown): void {
  responseCache.set(key, { data, ts: Date.now() });
}

function getCache(key: string): unknown | null {
  const entry = responseCache.get(key);
  return entry ? entry.data : null;
}

// ---------------------------------------------------------------------------
// Alpaca fetch with timeout + cache fallback
// ---------------------------------------------------------------------------
async function alpacaFetch(
  url: string,
  cacheKey: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<{ data: unknown; status: number; fromCache: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      ...init,
      headers: { ...alpacaHeaders(), ...(init?.headers || {}) },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await resp.json();
    if (resp.ok) setCache(cacheKey, data);
    return { data, status: resp.status, fromCache: false };
  } catch (err: unknown) {
    clearTimeout(timer);
    const cached = getCache(cacheKey);
    if (cached) return { data: cached, status: 200, fromCache: true };
    const message = err instanceof Error ? err.message : 'Alpaca request failed';
    return { data: { error: message }, status: 504, fromCache: false };
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

let stateStore: GatewayStateStore;

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------
app.get('/api/status', (_req: Request, res: Response) => {
  // Bayesian intelligence — read from patched stateStore.get
  let bayesianIntel = {};
  try { bayesianIntel = JSON.parse(stateStore.get('__bayesian_intel__') || '{}'); } catch {}
  let intelligenceMetrics = {};
  try { intelligenceMetrics = JSON.parse(stateStore.get('__bayesian_metrics__') || '{}'); } catch {}

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    workers: JSON.parse(stateStore.get('worker_statuses') || '{}') ?? {},
    bayesianIntel,
    intelligenceMetrics,
  });
});

// ---------------------------------------------------------------------------
// Broker proxy endpoints — talk to Alpaca, cache results
// ---------------------------------------------------------------------------

app.get('/api/broker/account', async (_req: Request, res: Response) => {
  if (!hasAlpacaCreds()) {
    return res.json({ cash: 0, portfolioValue: 0, buyingPower: 0, equity: 0, connected: false });
  }
  const { data, status, fromCache } = await alpacaFetch(
    `${ALPACA_BASE}/v2/account`,
    'broker:account',
    5000,
  );
  if (fromCache) (data as Record<string, unknown>)._cached = true;
  res.status(status).json(data);
});

app.get('/api/broker/positions', async (_req: Request, res: Response) => {
  if (!hasAlpacaCreds()) {
    return res.json({ positions: [], count: 0 });
  }
  const { data, status, fromCache } = await alpacaFetch(
    `${ALPACA_BASE}/v2/positions`,
    'broker:positions',
    5000,
  );
  if (fromCache) {
    return res.json({ positions: data, count: Array.isArray(data) ? data.length : 0, _cached: true });
  }
  if (status >= 400) return res.status(status).json(data);
  const positions = Array.isArray(data) ? data : [];
  res.json({ positions, count: positions.length });
});

app.post('/api/broker/order', async (req: Request, res: Response) => {
  if (!hasAlpacaCreds()) {
    return res.status(503).json({ error: 'No broker credentials' });
  }
  const { symbol, qty, side, type = 'market', time_in_force } = req.body;
  if (!symbol || !qty || !side) {
    return res.status(400).json({ error: 'symbol, qty, side required' });
  }
  const isCrypto = symbol.includes('/') || symbol.includes('-');
  const alpacaSymbol = symbol.replace('-', '/');
  const tif = time_in_force || (isCrypto ? 'gtc' : 'day');

  const { data, status } = await alpacaFetch(
    `${ALPACA_BASE}/v2/orders`,
    '', // no cache for orders
    10000,
    {
      method: 'POST',
      body: JSON.stringify({ symbol: alpacaSymbol, qty: String(qty), side, type, time_in_force: tif }),
    },
  );
  res.status(status).json(data);
});

app.delete('/api/broker/positions', async (_req: Request, res: Response) => {
  if (!hasAlpacaCreds()) {
    return res.status(503).json({ error: 'No broker credentials' });
  }
  const { data, status } = await alpacaFetch(
    `${ALPACA_BASE}/v2/positions`,
    '',
    10000,
    { method: 'DELETE' },
  );
  res.status(status).json({ closed: true, result: data });
});

app.get('/api/broker/history', async (req: Request, res: Response) => {
  if (!hasAlpacaCreds()) {
    return res.json({ error: 'unavailable' });
  }
  const period = (req.query.period as string) || '1M';
  const timeframe = (req.query.timeframe as string) || '1D';
  const { data, status, fromCache } = await alpacaFetch(
    `${ALPACA_BASE}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}`,
    `broker:history:${period}:${timeframe}`,
    5000,
  );
  if (fromCache) (data as Record<string, unknown>)._cached = true;
  res.status(status).json(data);
});

// ---------------------------------------------------------------------------
// Positions — read from state store
// ---------------------------------------------------------------------------

app.get('/api/positions/closed', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const trades = stateStore.getClosedTrades(limit);
  res.json({ trades });
});

app.get('/api/positions/performance', (_req: Request, res: Response) => {
  const stats = { totalTrades: stateStore.getClosedTrades(1000).length, ...(() => { const t = stateStore.getClosedTrades(1000); const w = t.filter(x => x.pnl > 0); return { wins: w.length, losses: t.length - w.length, winRate: t.length > 0 ? (w.length/t.length)*100 : 0 }; })() };
  res.json(stats);
});

// ---------------------------------------------------------------------------
// Autonomy — read/write state store
// ---------------------------------------------------------------------------

app.get('/api/autonomy/status', (_req: Request, res: Response) => {
  const status = JSON.parse(stateStore.get('trade_engine_status') || '{"enabled":true,"autonomyLevel":"act","heartbeatCount":0}');
  res.json(status);
});

app.post('/api/autonomy/toggle', (_req: Request, res: Response) => {
  const current = stateStore.get('autonomy_enabled');
  const next = current === 'true' ? 'false' : 'true';
  stateStore.set('autonomy_enabled', next);
  res.json({ enabled: next === 'true' });
});

// ---------------------------------------------------------------------------
// Intelligence — read from state store
// ---------------------------------------------------------------------------

app.get('/api/intelligence', (_req: Request, res: Response) => {
  const beliefs = stateStore.getBeliefsByDomain('');
  res.json(beliefs);
});

app.get('/api/intelligence/adaptive', (_req: Request, res: Response) => {
  const adaptive = stateStore.getAdaptiveState();
  res.json({ adaptive });
});

app.get('/api/intelligence/top-performers', (_req: Request, res: Response) => {
  const performers = stateStore.getTopPerformers();
  res.json({ performers });
});

app.get('/api/intelligence/worst-performers', (_req: Request, res: Response) => {
  const performers = stateStore.getWorstPerformers();
  res.json({ performers });
});

app.post('/api/intelligence/reset', (_req: Request, res: Response) => {
  stateStore.clearBeliefs();
  res.json({ cleared: true });
});

// ---------------------------------------------------------------------------
// Research — read from state store
// ---------------------------------------------------------------------------

app.get('/api/research/reports', (req: Request, res: Response) => {
  const agent = req.query.agent as string | undefined;
  const limit = parseInt(req.query.limit as string) || 20;
  const reports = stateStore.getReports(agent || undefined, limit);
  res.json({ reports, total: reports.length });
});

app.get('/api/research/latest', (_req: Request, res: Response) => {
  const crypto = stateStore.getLatestByAgent('crypto-researcher');
  const forex = stateStore.getLatestByAgent('forex-researcher');
  const equity = stateStore.getLatestByAgent('research-agent');
  res.json({ crypto: crypto || null, forex: forex || null, equity: equity || null });
});

// ---------------------------------------------------------------------------
// Strategy — read from state store
// ---------------------------------------------------------------------------

// Intelligence metrics
app.get('/api/intelligence/metrics', (_req: Request, res: Response) => {
  try {
    const metrics = JSON.parse(stateStore.get('__bayesian_metrics__') || '{}');
    res.json(metrics);
  } catch { res.json({}); }
});

// Traits
app.get('/api/traits', (_req: Request, res: Response) => {
  try {
    const raw = stateStore.get('trait_snapshot');
    res.json(raw ? JSON.parse(raw) : { traits: [], count: 0 });
  } catch { res.json({ traits: [], count: 0 }); }
});

app.get('/api/traits/history/snapshots', (_req: Request, res: Response) => {
  try {
    const raw = stateStore.get('trait_history');
    res.json(raw ? JSON.parse(raw) : { snapshots: [] });
  } catch { res.json({ snapshots: [] }); }
});

// Account — Alpaca proxy with connected status
app.get('/api/account', async (_req: Request, res: Response) => {
  if (!hasAlpacaCreds()) return res.json({ connected: false });
  try {
    const r = await fetch(`${ALPACA_BASE}/v2/account`, { headers: alpacaHeaders(), signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const acct = await r.json() as any;
      res.json({ connected: true, equity: parseFloat(acct.equity), cash: parseFloat(acct.cash), buyingPower: parseFloat(acct.buying_power), dayPnl: parseFloat(acct.equity) - parseFloat(acct.last_equity) });
    } else { res.json({ connected: false }); }
  } catch { res.json({ connected: false }); }
});

app.post('/api/strategy/morning-plan', (req: Request, res: Response) => {
  stateStore.set('morning_plan', JSON.stringify(req.body));
  console.log(`[API] Morning plan received: ${(req.body.tickers || []).length} tickers`);
  res.json({ status: 'ok' });
});

app.get('/api/strategy/morning-plan', (_req: Request, res: Response) => {
  const plan = JSON.parse(stateStore.get('morning_plan') || '{}');
  res.json(plan);
});

app.get('/api/strategy/daily', (_req: Request, res: Response) => {
  const strategy = JSON.parse(stateStore.get('daily_strategy') || '{"approach":"pending","narrative":"Waiting for heartbeat..."}');
  res.json(strategy || { approach: 'pending', narrative: 'Waiting for first heartbeat...' });
});

// ---------------------------------------------------------------------------
// Manual Trade Override — buy/sell specific tickers
// ---------------------------------------------------------------------------

app.post('/api/trade/buy', async (req: Request, res: Response) => {
  if (!hasAlpacaCreds()) return res.status(503).json({ error: 'No Alpaca credentials' });
  const { symbol, qty, notional } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const order: Record<string, unknown> = {
      symbol,
      side: 'buy',
      type: 'market',
      time_in_force: symbol.includes('/') || (symbol.includes('USD') && symbol.length > 5) ? 'gtc' : 'day',
    };
    if (qty) order.qty = String(qty);
    else if (notional) order.notional = String(notional);
    else order.notional = '500'; // default $500

    const r = await fetch(`${ALPACA_BASE}/v2/orders`, {
      method: 'POST',
      headers: alpacaHeaders(),
      body: JSON.stringify(order),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json();
    if (r.ok) {
      console.log(`[ManualTrade] BUY ${symbol} — ${data.status}`);
      res.json({ status: 'ok', order: data });
    } else {
      res.status(r.status).json({ error: data });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trade/sell', async (req: Request, res: Response) => {
  if (!hasAlpacaCreds()) return res.status(503).json({ error: 'No Alpaca credentials' });
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    // Close entire position
    const r = await fetch(`${ALPACA_BASE}/v2/positions/${symbol}`, {
      method: 'DELETE',
      headers: alpacaHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json();
    if (r.ok) {
      console.log(`[ManualTrade] SELL ${symbol} — closed`);
      res.json({ status: 'ok', order: data });
    } else {
      res.status(r.status).json({ error: data });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Error handler — catch any unhandled route errors
// ---------------------------------------------------------------------------
app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
  console.error('[api-server] Unhandled route error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Process-level crash protection — log and continue, never exit
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  console.error('[api-server] uncaughtException:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[api-server] unhandledRejection:', reason);
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.API_PORT || '3001', 10);

function start(store: GatewayStateStore): Promise<void> {
  stateStore = store;
  const t0 = Date.now();

  return new Promise((resolve) => {
    app.listen(PORT, () => {
      const elapsed = Date.now() - t0;
      console.log(`[api-server] Listening on port ${PORT} — started in ${elapsed}ms`);
      resolve();
    });
  });
}

export { app, start };

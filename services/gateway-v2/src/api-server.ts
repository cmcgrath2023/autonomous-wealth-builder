import express, { Request, Response } from 'express';
import { GatewayStateStore } from './state-store.js';

// ---------------------------------------------------------------------------
// Alpaca proxy config
// ---------------------------------------------------------------------------
const ALPACA_BASE = 'https://paper-api.alpaca.markets';

function alpacaHeaders(): Record<string, string> {
  const key = process.env.ALPACA_API_KEY || '';
  const secret = process.env.ALPACA_API_SECRET || '';
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    'Content-Type': 'application/json',
  };
}

function hasAlpacaCreds(): boolean {
  return !!(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET);
}

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

let stateStore: GatewayStateStore;

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------
app.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    workers: stateStore.getWorkerStatuses?.() ?? {},
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
  const stats = stateStore.getPerformanceStats();
  res.json(stats);
});

// ---------------------------------------------------------------------------
// Autonomy — read/write state store
// ---------------------------------------------------------------------------

app.get('/api/autonomy/status', (_req: Request, res: Response) => {
  const status = stateStore.getAutonomyStatus();
  res.json(status);
});

app.post('/api/autonomy/toggle', (_req: Request, res: Response) => {
  const current = stateStore.getConfig('autonomy_enabled');
  const next = current === 'true' ? 'false' : 'true';
  stateStore.setConfig('autonomy_enabled', next);
  res.json({ enabled: next === 'true' });
});

// ---------------------------------------------------------------------------
// Intelligence — read from state store
// ---------------------------------------------------------------------------

app.get('/api/intelligence', (_req: Request, res: Response) => {
  const beliefs = stateStore.getBeliefs();
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
  const reports = stateStore.getResearchReports({ agent, limit });
  res.json({ reports, total: reports.length });
});

app.get('/api/research/latest', (_req: Request, res: Response) => {
  const crypto = stateStore.getLatestReport('crypto-researcher');
  const forex = stateStore.getLatestReport('forex-researcher');
  const equity = stateStore.getLatestReport('research-agent');
  res.json({ crypto: crypto || null, forex: forex || null, equity: equity || null });
});

// ---------------------------------------------------------------------------
// Strategy — read from state store
// ---------------------------------------------------------------------------

app.get('/api/strategy/daily', (_req: Request, res: Response) => {
  const strategy = stateStore.getDailyStrategy();
  res.json(strategy || { approach: 'pending', narrative: 'Waiting for first heartbeat...' });
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

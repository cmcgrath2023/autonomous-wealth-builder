import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { ForexScanner } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../gateway/.env') });
config({ path: resolve(__dirname, '../../gateway/.env.local'), override: true });
config({ path: resolve(__dirname, '../../.env.webhook') });

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.FOREX_SERVICE_PORT || '3003');

const scanner = new ForexScanner({
  oandaApiKey: process.env.OANDA_API_KEY,
  oandaAccountId: process.env.OANDA_ACCOUNT_ID,
  oandaMode: (process.env.OANDA_MODE as 'live' | 'practice') || undefined,
});

// ── Track trade history for P&L reporting ──
interface TradeRecord {
  id: string;
  instrument: string;
  units: number;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice?: number;
  realizedPL?: number;
  openTime: string;
  closeTime?: string;
  status: 'open' | 'closed';
  strategy: string;
}
const tradeHistory: TradeRecord[] = [];

// ── OANDA helpers ──
const oandaBase = (process.env.OANDA_MODE === 'practice' || process.env.OANDA_ACCOUNT_ID?.startsWith('101-'))
  ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com';
const oandaHeaders = { Authorization: `Bearer ${process.env.OANDA_API_KEY}` };
const oandaAcct = process.env.OANDA_ACCOUNT_ID;

// ═══════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════

// Health
app.get('/api/forex/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'MTWM Forex Service v1.0',
    port: PORT,
    session: scanner.getActiveSession(),
    configured: !!(process.env.OANDA_API_KEY && process.env.OANDA_ACCOUNT_ID),
    quotesTracked: scanner.getQuotes().length,
    uptime: process.uptime(),
  });
});

// Account summary
app.get('/api/forex/account', async (_req, res) => {
  try {
    const resp = await fetch(`${oandaBase}/v3/accounts/${oandaAcct}/summary`, { headers: oandaHeaders });
    if (!resp.ok) return res.status(resp.status).json({ error: 'OANDA API error' });
    const data = await resp.json() as any;
    const a = data.account;
    res.json({
      balance: parseFloat(a.balance),
      nav: parseFloat(a.NAV),
      unrealizedPL: parseFloat(a.unrealizedPL),
      realizedPL: parseFloat(a.pl),
      openTradeCount: a.openTradeCount,
      marginUsed: parseFloat(a.marginUsed),
      marginAvailable: parseFloat(a.marginAvailable),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Available pairs
app.get('/api/forex/pairs', (_req, res) => {
  res.json({
    pairs: [
      { symbol: 'EUR/USD', category: 'major' },
      { symbol: 'GBP/USD', category: 'major' },
      { symbol: 'USD/JPY', category: 'major' },
      { symbol: 'AUD/JPY', category: 'carry' },
      { symbol: 'NZD/JPY', category: 'carry' },
      { symbol: 'EUR/GBP', category: 'cross' },
      { symbol: 'AUD/NZD', category: 'cross' },
      { symbol: 'EUR/JPY', category: 'cross' },
      { symbol: 'GBP/JPY', category: 'cross' },
      { symbol: 'USD/CAD', category: 'major' },
      { symbol: 'USD/CHF', category: 'major' },
      { symbol: 'XAU/USD', category: 'commodity' },
    ],
  });
});

// Current quotes
app.get('/api/forex/quotes', async (_req, res) => {
  try {
    const quotes = await scanner.fetchQuotes();
    res.json({
      session: scanner.getActiveSession(),
      quotes,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Session info
app.get('/api/forex/session', (_req, res) => {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  res.json({
    active: scanner.getActiveSession(),
    utcTime: `${utcH}:${String(utcM).padStart(2, '0')}`,
    sessions: {
      asian: scanner.isSessionOpen('asian'),
      london: scanner.isSessionOpen('london'),
      newyork: scanner.isSessionOpen('newyork'),
      overlap: scanner.isSessionOpen('overlap'),
    },
  });
});

// Generate signals (scan)
app.post('/api/forex/scan', async (_req, res) => {
  try {
    await scanner.fetchQuotes();
    const momentum = scanner.evaluateSessionMomentum();
    const carry = scanner.evaluateCarryTrades();
    res.json({
      session: scanner.getActiveSession(),
      signals: [...momentum, ...carry],
      total: momentum.length + carry.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Signals — seed history from OANDA candles, then evaluate
app.get('/api/forex/signals', async (_req, res) => {
  try {
    // Seed price history from OANDA 15-min candles if scanner has < 50 data points
    const pairs = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'AUD_JPY', 'NZD_JPY', 'EUR_GBP', 'AUD_NZD'];
    for (const inst of pairs) {
      const sym = inst.replace('_', '/');
      const existing = scanner.getPriceHistoryLength(sym);
      if (existing < 50) {
        try {
          const resp = await fetch(
            `${oandaBase}/v3/instruments/${inst}/candles?granularity=M15&count=100`,
            { headers: oandaHeaders, signal: AbortSignal.timeout(5000) },
          );
          if (resp.ok) {
            const data = await resp.json() as any;
            const candles = (data.candles || []).filter((c: any) => c.complete);
            for (const c of candles) {
              scanner.addPricePoint(sym, parseFloat(c.mid.c));
            }
          }
        } catch {}
      }
    }

    // Fetch live quotes
    await scanner.fetchQuotes();
    const signals = scanner.evaluateSessionMomentum();

    // Check Brain history for each signal's pair
    const brainUrl = process.env.BRAIN_SERVER_URL || 'https://trident.cetaceanlabs.com';
    const brainKey = process.env.BRAIN_API_KEY || '';
    const enriched = [];
    for (const sig of signals) {
      let approved = true;
      let reason = 'no history';
      try {
        const pair = sig.symbol.replace('/', '');
        const r = await fetch(`${brainUrl}/v1/memories/search?q=${encodeURIComponent(pair + ' trade outcome')}&limit=20`, {
          headers: { 'Content-Type': 'application/json', ...(brainKey ? { 'Authorization': `Bearer ${brainKey}` } : {}) },
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const results = await r.json() as any[];
          const pairTag = pair.toLowerCase();
          const outcomes = results.filter((m: any) => m.tags?.includes(pairTag) && m.tags?.includes('outcome'));
          const wins = outcomes.filter((m: any) => m.tags?.includes('win')).length;
          const losses = outcomes.filter((m: any) => m.tags?.includes('loss')).length;
          const total = wins + losses;
          if (total >= 3 && wins / total < 0.35) {
            approved = false;
            reason = `${wins}W/${losses}L — reject`;
          } else if (total > 0) {
            reason = `${wins}W/${losses}L — OK`;
          }
        }
      } catch (e: any) { reason = `Brain error: ${e.message?.substring(0, 40)}`; }

      if (approved) {
        enriched.push({ ...sig, brainApproved: true, brainReason: reason });
      } else {
        console.log(`[Forex] Brain REJECTED ${sig.direction} ${sig.symbol}: ${reason}`);
      }
    }

    res.json({
      session: scanner.getActiveSession(),
      signals: enriched,
      total: enriched.length,
      rejected: signals.length - enriched.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Refresh quotes
app.post('/api/forex/refresh', async (_req, res) => {
  try {
    await scanner.fetchQuotes();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Open positions
app.get('/api/forex/positions', async (_req, res) => {
  try {
    const trades = await scanner.getOpenTrades();
    const totalPL = trades.reduce((s: number, t: any) => s + parseFloat(t.unrealizedPL || '0'), 0);
    res.json({
      positions: trades.map((t: any) => ({
        id: t.id,
        instrument: t.instrument,
        units: parseInt(t.currentUnits),
        direction: parseInt(t.currentUnits) > 0 ? 'long' : 'short',
        entryPrice: parseFloat(t.price),
        unrealizedPL: parseFloat(t.unrealizedPL),
        openTime: t.openTime,
      })),
      count: trades.length,
      totalUnrealizedPL: totalPL,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Place order
app.post('/api/forex/order', async (req, res) => {
  try {
    const { instrument, units, stopLoss, takeProfit, strategy } = req.body;
    if (!instrument || !units) {
      return res.status(400).json({ error: 'instrument and units required' });
    }
    const result = await scanner.placeOrder(instrument, units, stopLoss, takeProfit);
    const fill = result.orderFillTransaction;

    if (fill) {
      tradeHistory.push({
        id: fill.id,
        instrument: fill.instrument,
        units: parseInt(fill.units),
        direction: parseInt(fill.units) > 0 ? 'long' : 'short',
        entryPrice: parseFloat(fill.price),
        openTime: fill.time,
        status: 'open',
        strategy: strategy || 'manual',
      });
    }

    res.json({ success: true, fill: fill ? { id: fill.id, price: fill.price, units: fill.units } : null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Close position
app.post('/api/forex/position/:instrument/close', async (req, res) => {
  try {
    const instrument = req.params.instrument.replace('-', '/');
    const result = await scanner.closePosition(instrument);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Trade history
app.get('/api/forex/history', async (_req, res) => {
  try {
    const resp = await fetch(
      `${oandaBase}/v3/accounts/${oandaAcct}/trades?state=CLOSED&count=20`,
      { headers: oandaHeaders },
    );
    if (!resp.ok) return res.status(resp.status).json({ error: 'OANDA API error' });
    const data = await resp.json() as any;
    const trades = (data.trades || []).map((t: any) => ({
      id: t.id,
      instrument: t.instrument,
      units: parseInt(t.initialUnits),
      direction: parseInt(t.initialUnits) > 0 ? 'long' : 'short',
      entryPrice: parseFloat(t.price),
      exitPrice: parseFloat(t.averageClosePrice || '0'),
      realizedPL: parseFloat(t.realizedPL),
      openTime: t.openTime,
      closeTime: t.closeTime,
      exitReason: t.stopLossOrder?.state === 'FILLED' ? 'stop_loss' : 'take_profit',
    }));

    const wins = trades.filter((t: any) => t.realizedPL >= 0);
    const losses = trades.filter((t: any) => t.realizedPL < 0);

    res.json({
      trades,
      stats: {
        total: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: trades.length > 0 ? (wins.length / trades.length * 100).toFixed(0) + '%' : '0%',
        grossWins: wins.reduce((s: number, t: any) => s + t.realizedPL, 0),
        grossLosses: losses.reduce((s: number, t: any) => s + t.realizedPL, 0),
        netPL: trades.reduce((s: number, t: any) => s + t.realizedPL, 0),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Candle data for a pair
app.get('/api/forex/candles/:instrument', async (req, res) => {
  try {
    const instrument = req.params.instrument.replace('-', '_').replace('/', '_');
    const granularity = (req.query.granularity as string) || 'H1';
    const count = parseInt((req.query.count as string) || '50');

    const resp = await fetch(
      `${oandaBase}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}`,
      { headers: oandaHeaders },
    );
    if (!resp.ok) return res.status(resp.status).json({ error: 'OANDA API error' });
    const data = await resp.json() as any;

    const candles = (data.candles || []).filter((c: any) => c.complete).map((c: any) => ({
      time: c.time,
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume,
    }));

    res.json({ instrument, granularity, candles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// P&L summary (for autonomy engine / dashboard)
app.get('/api/forex/pnl', async (_req, res) => {
  try {
    // Get account summary
    const acctResp = await fetch(`${oandaBase}/v3/accounts/${oandaAcct}/summary`, { headers: oandaHeaders });
    const acctData = await acctResp.json() as any;
    const account = acctData.account;

    // Get open trades
    const trades = await scanner.getOpenTrades();
    const unrealized = trades.reduce((s: number, t: any) => s + parseFloat(t.unrealizedPL || '0'), 0);

    // Get recent closed trades
    const closedResp = await fetch(
      `${oandaBase}/v3/accounts/${oandaAcct}/trades?state=CLOSED&count=10`,
      { headers: oandaHeaders },
    );
    const closedData = await closedResp.json() as any;
    const recentClosed = (closedData.trades || []).slice(0, 5);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayTrades = recentClosed.filter((t: any) => new Date(t.closeTime) >= todayStart);
    const todayPL = todayTrades.reduce((s: number, t: any) => s + parseFloat(t.realizedPL || '0'), 0);

    res.json({
      balance: parseFloat(account.balance),
      nav: parseFloat(account.NAV),
      totalPL: parseFloat(account.pl),
      unrealizedPL: unrealized,
      todayRealizedPL: todayPL,
      openPositions: trades.length,
      session: scanner.getActiveSession(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════

// Error handlers first
scanner.on('error', (err) => console.error('[Forex] Error:', err.message));
scanner.on('signal', (sig) => console.log(`[Forex] Signal: ${sig.direction.toUpperCase()} ${sig.symbol} (${sig.strategy}, conf: ${sig.confidence})`));
process.on('uncaughtException', (err) => console.error('[Forex] Uncaught:', err.message));
process.on('unhandledRejection', (err: any) => console.error('[Forex] Unhandled rejection:', err?.message || err));

// ── Bootstrap historical candles so indicators work immediately ──
// Without this, the scanner starts with 0 price history and produces
// 0 signals until ~50 quote fetches accumulate (50 × heartbeat interval
// = hours of dead time). This was why forex was dead since 2026-03-31.
async function bootstrapHistory(): Promise<void> {
  if (!oandaAcct || !process.env.OANDA_API_KEY) {
    console.log('[Forex Service] No OANDA creds — skipping bootstrap');
    return;
  }
  const pairs = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'AUD_JPY', 'NZD_JPY', 'EUR_GBP', 'AUD_NZD'];
  console.log(`[Forex Service] Bootstrapping ${pairs.length} pairs with 100 x 15-min candles...`);
  for (const inst of pairs) {
    try {
      const url = `${oandaBase}/v3/instruments/${inst}/candles?granularity=M15&count=100&price=M`;
      const res = await fetch(url, { headers: oandaHeaders, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) { console.log(`  [bootstrap] ${inst}: ${res.status}`); continue; }
      const data = await res.json() as any;
      const candles = data.candles || [];
      const symbol = inst.replace('_', '/');
      let loaded = 0;
      for (const c of candles) {
        if (c.complete === false) continue; // skip in-progress candle
        const mid = parseFloat(c.mid?.c || '0');
        if (mid > 0) { scanner.addPricePoint(symbol, mid); loaded++; }
      }
      console.log(`  [bootstrap] ${symbol}: ${loaded} candles loaded`);
    } catch (e: any) {
      console.log(`  [bootstrap] ${inst}: FAILED ${e.message}`);
    }
  }
  console.log('[Forex Service] Bootstrap complete — indicators ready');
}

// Store server ref to anchor event loop
const server = app.listen(PORT, async () => {
  console.log(`\n[Forex Service] Listening on http://localhost:${PORT}`);
  console.log(`[Forex Service] OANDA: ${process.env.OANDA_ACCOUNT_ID ? 'configured' : 'NOT configured'}`);
  console.log(`[Forex Service] Session: ${scanner.getActiveSession()}`);
  // Bootstrap BEFORE declaring ready so first signal scan has data
  await bootstrapHistory();
  console.log('[Forex Service] Ready.');
});

// Keep-alive: prevent Node from exiting if server handle gets GC'd
const keepAlive = setInterval(() => {}, 60_000);
process.on('SIGTERM', () => { clearInterval(keepAlive); server.close(); });
process.on('SIGINT', () => { clearInterval(keepAlive); server.close(); });

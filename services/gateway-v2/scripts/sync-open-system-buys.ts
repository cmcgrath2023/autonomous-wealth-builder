import { join } from 'path';
import Database from 'better-sqlite3';
import { loadCredentials } from '../src/config-bus.js';

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  side?: 'long' | 'short';
}

async function alpacaFetch<T>(path: string, creds: { apiKey: string; apiSecret: string; baseUrl: string }): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    headers: {
      'APCA-API-KEY-ID': creds.apiKey,
      'APCA-API-SECRET-KEY': creds.apiSecret,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${path} -> ${res.status} ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

const dryRun = !process.argv.includes('--apply');
const creds = loadCredentials();
if (!creds.alpaca) {
  console.error('No Alpaca credentials available from env or vault.');
  process.exit(1);
}
if (creds.alpaca.mode !== 'paper') {
  console.error(`Refusing to sync non-paper Alpaca mode: ${creds.alpaca.mode}`);
  process.exit(1);
}

const positions = await alpacaFetch<AlpacaPosition[]>('/v2/positions', creds.alpaca);
const db = new Database(join(process.cwd(), 'data', 'gateway-state.db'));

try {
  const openRows = db.prepare(`
    SELECT rowid, ticker, bought_at AS boughtAt, price, qty
      FROM system_buys
     WHERE status = 'open'
     ORDER BY bought_at ASC
  `).all() as Array<{ rowid: number; ticker: string; boughtAt: string; price: number; qty: number }>;

  const canonical = positions
    .map(p => ({
      ticker: p.symbol.toUpperCase(),
      qty: Math.abs(Number(p.qty)),
      price: Number(p.avg_entry_price),
      boughtAt: new Date().toISOString(),
      clientOrderId: `alpaca-position-sync-${new Date().toISOString()}`,
    }))
    .filter(p => p.ticker && isFinite(p.qty) && p.qty > 0 && isFinite(p.price) && p.price > 0);

  console.log(`[sync-open-system-buys] mode=${dryRun ? 'dry-run' : 'apply'}`);
  console.log(`[sync-open-system-buys] current open rows=${openRows.length}`);
  console.log(`[sync-open-system-buys] alpaca positions=${canonical.map(p => `${p.ticker}:${p.qty}@${p.price.toFixed(2)}`).join(', ') || 'none'}`);

  if (dryRun) {
    console.log('[sync-open-system-buys] would close every open system_buys row and recreate one canonical row per Alpaca position.');
    console.log('[sync-open-system-buys] rerun with --apply to mutate SQLite.');
    process.exit(0);
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE system_buys SET status = 'closed' WHERE status = 'open'`).run();
    const insert = db.prepare(`
      INSERT INTO system_buys (ticker, bought_at, price, qty, client_order_id, status)
      VALUES (?, ?, ?, ?, ?, 'open')
    `);
    for (const p of canonical) {
      insert.run(p.ticker, p.boughtAt, p.price, p.qty, p.clientOrderId);
    }
  });
  tx();

  const remaining = db.prepare(`SELECT ticker, price, qty FROM system_buys WHERE status = 'open' ORDER BY ticker`).all();
  console.log(`[sync-open-system-buys] synced open rows=${remaining.length}`);
  console.table(remaining);
} finally {
  db.close();
}

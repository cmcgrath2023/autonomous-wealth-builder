import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { loadCredentials } from '../src/config-bus.js';

interface AlpacaPosition {
  symbol: string;
  qty: string;
  side?: 'long' | 'short';
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
}

interface AlpacaOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  status: string;
  qty?: string;
  stop_price?: string;
  limit_price?: string;
  created_at: string;
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

function parseSnapshot(raw: string | null): Array<{ ticker: string; text: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const positions = Array.isArray(parsed.positions) ? parsed.positions : [];
    return positions.map((text: string) => ({
      ticker: String(text).split(':')[0]?.trim().toUpperCase(),
      text: String(text),
    })).filter((p: { ticker: string }) => p.ticker);
  } catch {
    return [];
  }
}

function fmtMoney(value: string | number | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return 'n/a';
  return `$${n.toFixed(2)}`;
}

function pct(value: string | number | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(2)}%`;
}

const creds = loadCredentials();
if (!creds.alpaca) {
  console.error('No Alpaca credentials available from env or vault.');
  process.exit(1);
}
if (creds.alpaca.mode !== 'paper') {
  console.error(`Refusing to reconcile non-paper Alpaca mode: ${creds.alpaca.mode}`);
  process.exit(1);
}

const store = new GatewayStateStore(join(process.cwd(), 'data', 'gateway-state.db'));

try {
  const [account, positions, orders] = await Promise.all([
    alpacaFetch<any>('/v2/account', creds.alpaca),
    alpacaFetch<AlpacaPosition[]>('/v2/positions', creds.alpaca),
    alpacaFetch<AlpacaOrder[]>('/v2/orders?status=open&limit=500&direction=desc', creds.alpaca),
  ]);

  const alpacaSymbols = new Set(positions.map(p => p.symbol.toUpperCase()));
  const localOpenBuys = store.getOpenSystemBuys();
  const localOpenSymbols = new Set(localOpenBuys.map(b => b.ticker.toUpperCase()));
  const localSnapshot = parseSnapshot(store.get('positions_snapshot'));
  const localSnapshotSymbols = new Set(localSnapshot.map(p => p.ticker));

  const missingLocalBuys = positions
    .map(p => p.symbol.toUpperCase())
    .filter(symbol => !localOpenSymbols.has(symbol));
  const staleLocalBuys = localOpenBuys
    .map(b => b.ticker.toUpperCase())
    .filter(symbol => !alpacaSymbols.has(symbol));
  const staleSnapshot = localSnapshot
    .map(p => p.ticker)
    .filter(symbol => !alpacaSymbols.has(symbol));
  const missingSnapshot = positions
    .map(p => p.symbol.toUpperCase())
    .filter(symbol => !localSnapshotSymbols.has(symbol));

  const stopOrders = orders.filter(o => o.type === 'stop' || o.stop_price);
  const stopBySymbol = new Map<string, AlpacaOrder[]>();
  for (const order of stopOrders) {
    const list = stopBySymbol.get(order.symbol.toUpperCase()) || [];
    list.push(order);
    stopBySymbol.set(order.symbol.toUpperCase(), list);
  }
  const positionsWithoutStops = positions
    .filter(p => Number(p.qty) !== 0)
    .map(p => p.symbol.toUpperCase())
    .filter(symbol => !stopBySymbol.has(symbol));

  const lines: string[] = [];
  lines.push(`# AWB Alpaca Reconciliation Report - ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Account');
  lines.push('');
  lines.push(`- Mode: paper`);
  lines.push(`- Status: ${account.status || 'unknown'}`);
  lines.push(`- Equity: ${fmtMoney(account.equity)}`);
  lines.push(`- Cash: ${fmtMoney(account.cash)}`);
  lines.push(`- Buying power: ${fmtMoney(account.buying_power)}`);
  lines.push('');
  lines.push('## Alpaca Positions');
  lines.push('');
  if (positions.length === 0) {
    lines.push('- None');
  } else {
    lines.push('| Symbol | Side | Qty | Avg Entry | Current | Market Value | Unrealized | Unrealized % |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const p of positions.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      lines.push(`| ${p.symbol} | ${p.side || 'long'} | ${p.qty} | ${fmtMoney(p.avg_entry_price)} | ${fmtMoney(p.current_price)} | ${fmtMoney(p.market_value)} | ${fmtMoney(p.unrealized_pl)} | ${pct(p.unrealized_plpc)} |`);
    }
  }
  lines.push('');
  lines.push('## Open Orders');
  lines.push('');
  if (orders.length === 0) {
    lines.push('- None');
  } else {
    lines.push('| Symbol | Side | Type | Status | Qty | Stop | Limit | Created |');
    lines.push('|---|---|---|---|---:|---:|---:|---|');
    for (const o of orders.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      lines.push(`| ${o.symbol} | ${o.side} | ${o.type} | ${o.status} | ${o.qty || ''} | ${o.stop_price || ''} | ${o.limit_price || ''} | ${o.created_at} |`);
    }
  }
  lines.push('');
  lines.push('## Local State Comparison');
  lines.push('');
  lines.push(`- Local open system buys: ${localOpenBuys.length ? localOpenBuys.map(b => `${b.ticker}@${fmtMoney(b.price)}`).join(', ') : 'none'}`);
  lines.push(`- Local positions snapshot: ${localSnapshot.length ? localSnapshot.map(p => p.text).join('; ') : 'none'}`);
  lines.push(`- Alpaca positions missing open local buy rows: ${missingLocalBuys.length ? missingLocalBuys.join(', ') : 'none'}`);
  lines.push(`- Local open buy rows absent from Alpaca: ${staleLocalBuys.length ? staleLocalBuys.join(', ') : 'none'}`);
  lines.push(`- Alpaca positions missing from local snapshot: ${missingSnapshot.length ? missingSnapshot.join(', ') : 'none'}`);
  lines.push(`- Local snapshot symbols absent from Alpaca: ${staleSnapshot.length ? staleSnapshot.join(', ') : 'none'}`);
  lines.push(`- Positions without open broker stop orders: ${positionsWithoutStops.length ? positionsWithoutStops.join(', ') : 'none'}`);
  lines.push('');
  lines.push('## Restart Gate');
  lines.push('');
  if (missingLocalBuys.length || staleLocalBuys.length || missingSnapshot.length || staleSnapshot.length || positionsWithoutStops.length) {
    lines.push('Result: HOLD. Reconcile the mismatches above before restarting AWB trading.');
  } else {
    lines.push('Result: CLEAN. Local state and Alpaca positions/orders are aligned enough for a controlled paper restart.');
  }

  const outPath = join(process.cwd(), '..', 'docs', 'history', `alpaca-reconcile-${new Date().toISOString().slice(0, 10)}.md`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  console.log(`\nWrote ${outPath}`);
} finally {
  store.close();
}

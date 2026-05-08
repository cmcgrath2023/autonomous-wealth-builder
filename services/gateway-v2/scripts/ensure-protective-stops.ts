import { loadCredentials } from '../src/config-bus.js';

interface AlpacaPosition {
  symbol: string;
  qty: string;
  side?: 'long' | 'short';
  avg_entry_price: string;
}

interface AlpacaOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  status: string;
  qty?: string;
  stop_price?: string;
}

async function alpacaFetch<T>(
  path: string,
  creds: { apiKey: string; apiSecret: string; baseUrl: string },
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'APCA-API-KEY-ID': creds.apiKey,
      'APCA-API-SECRET-KEY': creds.apiSecret,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function roundStop(price: number): string {
  return price >= 1 ? price.toFixed(2) : price.toFixed(4);
}

const dryRun = !process.argv.includes('--apply');
const stopPct = Number(process.env.AWB_PROTECTIVE_STOP_PCT || '0.05');
if (!isFinite(stopPct) || stopPct <= 0 || stopPct >= 0.5) {
  console.error(`Invalid AWB_PROTECTIVE_STOP_PCT: ${process.env.AWB_PROTECTIVE_STOP_PCT}`);
  process.exit(1);
}

const creds = loadCredentials();
if (!creds.alpaca) {
  console.error('No Alpaca credentials available from env or vault.');
  process.exit(1);
}
if (creds.alpaca.mode !== 'paper') {
  console.error(`Refusing to place stops in non-paper Alpaca mode: ${creds.alpaca.mode}`);
  process.exit(1);
}

const [positions, openOrders] = await Promise.all([
  alpacaFetch<AlpacaPosition[]>('/v2/positions', creds.alpaca),
  alpacaFetch<AlpacaOrder[]>('/v2/orders?status=open&limit=500&direction=desc', creds.alpaca),
]);

const existingStops = new Set(
  openOrders
    .filter(o => o.type === 'stop' || o.stop_price)
    .map(o => `${o.symbol.toUpperCase()}:${o.side}`),
);

const missing = positions
  .map(p => {
    const side = p.side === 'short' ? 'buy' as const : 'sell' as const;
    const avg = Number(p.avg_entry_price);
    const qty = Math.abs(Number(p.qty));
    const stopPrice = p.side === 'short' ? avg * (1 + stopPct) : avg * (1 - stopPct);
    return {
      symbol: p.symbol.toUpperCase(),
      positionSide: p.side || 'long',
      orderSide: side,
      qty,
      stopPrice,
      hasStop: existingStops.has(`${p.symbol.toUpperCase()}:${side}`),
    };
  })
  .filter(p => !p.hasStop && p.qty > 0 && isFinite(p.stopPrice));

console.log(`[ensure-protective-stops] mode=${dryRun ? 'dry-run' : 'apply'} stopPct=${(stopPct * 100).toFixed(1)}%`);
if (missing.length === 0) {
  console.log('[ensure-protective-stops] all positions already have matching open stop orders.');
  process.exit(0);
}

for (const p of missing) {
  console.log(`[ensure-protective-stops] ${p.symbol} ${p.positionSide} qty=${p.qty} -> ${p.orderSide} stop @ ${roundStop(p.stopPrice)}`);
}

if (dryRun) {
  console.log('[ensure-protective-stops] rerun with --apply to place paper Alpaca stop orders.');
  process.exit(0);
}

for (const p of missing) {
  const order = await alpacaFetch<any>('/v2/orders', creds.alpaca, {
    method: 'POST',
    body: JSON.stringify({
      symbol: p.symbol,
      qty: String(p.qty),
      side: p.orderSide,
      type: 'stop',
      time_in_force: 'gtc',
      stop_price: roundStop(p.stopPrice),
    }),
  });
  console.log(`[ensure-protective-stops] placed ${p.symbol} stop order ${order.id || '(no id)'}`);
}

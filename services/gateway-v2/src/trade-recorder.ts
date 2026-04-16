/**
 * Trade Recorder + Alpaca Reconciler
 *
 * Single source of truth for writing closed trades into the gateway state store.
 * Every sell path in trade-engine and fin MUST go through `recordClosedTrade`
 * so the closed_trades table never diverges from reality again.
 *
 * In addition, `reconcileWithAlpaca` pulls Alpaca's own activity log (the
 * authoritative record of fills) and upserts any missing rows. This guarantees
 * the store catches up even if a write path is missed or a process crashes
 * mid-sell.
 *
 * Why this exists: the prior implementation had six separate sell paths and
 * only two of them wrote to the store. The circuit breaker, SL-dominance halt,
 * and P&L dashboards all read from the store, so three failsafes were blind
 * for the entire run. See commit history / trident-report.md for the incident.
 */

import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { brain } from './brain-client.js';

export interface ClosedTradeInput {
  ticker: string;
  direction: 'long' | 'short';
  reason: string;
  qty: number;
  entryPrice?: number | null;
  exitPrice: number;
  pnl: number;
  openedAt?: string | null;
  closedAt?: string;
  orderId?: string | null;
  source?: string;
}

/**
 * Writes a closed trade to every consumer that needs to know about it:
 *   - SQLite closed_trades (for circuit breaker, SL dominance, daily P&L)
 *   - Trident brain memory (for LoRA learning)
 *   - post_exit_tracking (for sold-too-early feedback loop)
 *   - system_buys (marks the buy as closed so manual-detection stays accurate)
 *
 * All writes are best-effort and swallow their own errors — a failure in one
 * consumer must never block the others.
 */
export function recordClosedTrade(
  store: GatewayStateStore,
  trade: ClosedTradeInput,
): void {
  const closedAt = trade.closedAt ?? new Date().toISOString();
  const source = trade.source ?? 'engine';
  const returnPct = trade.entryPrice && trade.entryPrice > 0
    ? (trade.exitPrice - trade.entryPrice) / trade.entryPrice * (trade.direction === 'short' ? -1 : 1)
    : trade.pnl / Math.max(1, Math.abs(trade.entryPrice ?? trade.exitPrice) * trade.qty);

  // 1. Persist to SQLite — this is the signal every failsafe reads from.
  try {
    store.recordTrade({
      ticker: trade.ticker,
      pnl: trade.pnl,
      direction: trade.direction,
      reason: trade.reason,
      openedAt: trade.openedAt ?? '',
      closedAt,
      exitPrice: trade.exitPrice,
      entryPrice: trade.entryPrice ?? null,
      qty: trade.qty,
      source,
      orderId: trade.orderId ?? null,
    });
  } catch (e) {
    console.error(`[trade-recorder] store.recordTrade failed for ${trade.ticker}:`, (e as Error).message);
  }

  // 2. Mark the corresponding system_buy as closed (if any) — keeps the
  //    persistent "we still own it" set accurate for manual-trade detection.
  try {
    store.closeSystemBuy(trade.ticker);
  } catch {}

  // 3. Schedule post-exit tracking — the daily follower job will fill in
  //    T+1/T+3/T+5 prices and compute a regret score.
  try {
    store.recordPostExit({
      ticker: trade.ticker,
      exitAt: closedAt,
      exitPrice: trade.exitPrice,
      exitReason: trade.reason,
    });
  } catch {}

  // 4. Push to Trident memory for LoRA learning (fire-and-forget).
  brain.recordTradeClose(
    trade.ticker,
    trade.pnl,
    returnPct,
    trade.reason,
    trade.direction,
  ).catch(() => { /* Trident is best-effort from here */ });
}

// ────────────────────────────────────────────────────────────────────────────
// Alpaca activities reconciler
// ────────────────────────────────────────────────────────────────────────────

interface AlpacaActivity {
  id: string;
  activity_type: string;      // 'FILL'
  transaction_time: string;   // ISO timestamp
  type: string;               // 'fill' | 'partial_fill'
  price: string;
  qty: string;
  side: string;               // 'buy' | 'sell' | 'sell_short' | 'buy_to_cover'
  symbol: string;
  order_id: string;
  cum_qty?: string;
  leaves_qty?: string;
}

export interface ReconcilerResult {
  buysRecorded: number;
  sellsRecorded: number;
  tickersProcessed: string[];
  errors: string[];
}

/**
 * Pulls Alpaca fill activities for the last `daysBack` calendar days and
 * reconciles them against the local store:
 *   - Every BUY with no matching system_buy row becomes one (so overnight
 *     holds stay tagged as system-bought after midnight).
 *   - Every SELL with no matching closed_trades row becomes one, with PnL
 *     computed from the nearest unmatched BUY of the same ticker (FIFO).
 *
 * Safe to run on every heartbeat; writes use `INSERT OR IGNORE` semantics.
 */
export async function reconcileWithAlpaca(
  store: GatewayStateStore,
  creds: { apiKey: string; apiSecret: string; baseUrl: string },
  daysBack = 3,
): Promise<ReconcilerResult> {
  const result: ReconcilerResult = {
    buysRecorded: 0,
    sellsRecorded: 0,
    tickersProcessed: [],
    errors: [],
  };

  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const headers = {
    'APCA-API-KEY-ID': creds.apiKey,
    'APCA-API-SECRET-KEY': creds.apiSecret,
  };

  // Alpaca's /v2/account/activities caps at page_size=100 per request. With
  // direction=asc, pass the last row's `id` as `page_token` to walk forward.
  // Without this, busy days silently truncate and the reconciler misses fills.
  const activities: AlpacaActivity[] = [];
  const MAX_PAGES = 20;         // hard ceiling: 2000 fills per reconcile pass
  let pageToken: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        activity_types: 'FILL',
        after: since,
        direction: 'asc',
        page_size: '100',
      });
      if (pageToken) qs.set('page_token', pageToken);
      const url = `${creds.baseUrl}/v2/account/activities?${qs.toString()}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        result.errors.push(`activities fetch page ${page}: ${res.status}`);
        break;
      }
      const pageData = await res.json() as AlpacaActivity[];
      if (!Array.isArray(pageData) || pageData.length === 0) break;
      activities.push(...pageData);
      if (pageData.length < 100) break;   // last page
      pageToken = pageData[pageData.length - 1].id;
    }
  } catch (e: any) {
    result.errors.push(`activities fetch: ${e.message}`);
    if (activities.length === 0) return result;
  }

  // Group fills by (ticker, order_id) so partial fills get aggregated into a
  // single effective fill before we try to pair buys with sells.
  interface Fill {
    ticker: string;
    orderId: string;
    side: 'buy' | 'sell';
    qty: number;
    price: number;       // volume-weighted
    time: string;        // last fill time for the order
  }
  const byOrder = new Map<string, Fill>();
  for (const a of activities) {
    if (a.activity_type !== 'FILL') continue;
    const side = a.side === 'buy' || a.side === 'buy_to_cover' ? 'buy' as const
               : (a.side === 'sell' || a.side === 'sell_short') ? 'sell' as const
               : null;
    if (!side) continue;
    const qty = parseFloat(a.qty);
    const price = parseFloat(a.price);
    if (!isFinite(qty) || !isFinite(price) || qty <= 0) continue;
    const key = `${a.symbol}::${a.order_id}`;
    const existing = byOrder.get(key);
    if (existing) {
      const totalQty = existing.qty + qty;
      existing.price = (existing.price * existing.qty + price * qty) / totalQty;
      existing.qty = totalQty;
      existing.time = a.transaction_time;
    } else {
      byOrder.set(key, {
        ticker: a.symbol.replace('/', ''), // "BTC/USD" → "BTCUSD"
        orderId: a.order_id,
        side,
        qty,
        price,
        time: a.transaction_time,
      });
    }
  }

  // Stable ordering: oldest fills first.
  const fills = [...byOrder.values()].sort((a, b) => a.time.localeCompare(b.time));

  // Per-ticker FIFO stack of open buy lots from this reconciliation window.
  // We also seed with any open system_buys so a buy that happened before the
  // reconcile window still pairs with a newer sell.
  const openBuys = new Map<string, Array<{ qty: number; price: number; time: string; orderId: string }>>();
  for (const b of store.getOpenSystemBuys()) {
    const list = openBuys.get(b.ticker) ?? [];
    list.push({ qty: b.qty, price: b.price, time: b.boughtAt, orderId: '' });
    openBuys.set(b.ticker, list);
  }

  const seenTickers = new Set<string>();

  for (const fill of fills) {
    seenTickers.add(fill.ticker);

    if (fill.side === 'buy') {
      // Record as a system buy if we don't already have this exact order_id.
      try {
        store.recordSystemBuy({
          ticker: fill.ticker,
          price: fill.price,
          qty: fill.qty,
          clientOrderId: fill.orderId,
          boughtAt: fill.time,
        });
        result.buysRecorded++;
      } catch (e: any) {
        result.errors.push(`buy ${fill.ticker}: ${e.message}`);
      }
      const list = openBuys.get(fill.ticker) ?? [];
      list.push({ qty: fill.qty, price: fill.price, time: fill.time, orderId: fill.orderId });
      openBuys.set(fill.ticker, list);
      continue;
    }

    // SELL — skip if we've already recorded this exact order_id.
    if (store.hasTrade(fill.ticker, fill.time, fill.orderId)) continue;

    // Delete any engine-sourced duplicate writes for this ticker within a
    // 120-second window around the fill time. The engine writes with its
    // estimated unrealizedPnl at sell time, which can be stale and wrong;
    // the reconciler walks Alpaca's fill log and produces the authoritative
    // realized P&L. Reconciler wins.
    try {
      const removed = store.deleteEngineDuplicates(fill.ticker, fill.time, 120);
      if (removed > 0) {
        console.log(`[reconciler] removed ${removed} engine-sourced duplicate(s) for ${fill.ticker} around ${fill.time}`);
      }
    } catch {}

    // FIFO-pair against open buy lots to compute realized PnL.
    const lots = openBuys.get(fill.ticker) ?? [];
    let remainingQty = fill.qty;
    let realizedPnl = 0;
    let totalCost = 0;
    let matchedQty = 0;
    let earliestBuyTime: string | null = null;
    while (remainingQty > 0 && lots.length > 0) {
      const lot = lots[0];
      const useQty = Math.min(remainingQty, lot.qty);
      realizedPnl += (fill.price - lot.price) * useQty;
      totalCost += lot.price * useQty;
      matchedQty += useQty;
      if (earliestBuyTime === null || lot.time < earliestBuyTime) earliestBuyTime = lot.time;
      lot.qty -= useQty;
      remainingQty -= useQty;
      if (lot.qty <= 1e-9) lots.shift();
    }
    openBuys.set(fill.ticker, lots);

    const avgEntry = matchedQty > 0 ? totalCost / matchedQty : null;
    try {
      recordClosedTrade(store, {
        ticker: fill.ticker,
        direction: 'long',
        reason: 'alpaca_reconcile',
        qty: fill.qty,
        entryPrice: avgEntry,
        exitPrice: fill.price,
        pnl: realizedPnl,
        openedAt: earliestBuyTime ?? '',
        closedAt: fill.time,
        orderId: fill.orderId,
        source: 'alpaca_reconcile',
      });
      result.sellsRecorded++;
    } catch (e: any) {
      result.errors.push(`sell ${fill.ticker}: ${e.message}`);
    }
  }

  result.tickersProcessed = [...seenTickers];
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Post-exit follower — fills in T+1/T+3/T+5 prices and scores regret
// ────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * Walks unresolved post_exit_tracking rows, fetches any T+N price that is now
 * due, and once T+5 is available writes a final regret score + verdict back
 * to Trident. The verdict becomes a training signal:
 *
 *   sold_early_strong : price > exit * 1.10 at T+5  → should have held
 *   sold_early        : price > exit * 1.03 at T+5  → could have held
 *   sold_right        : price < exit * 0.97 at T+5  → exit was correct
 *   neutral           : between those thresholds    → no clear signal
 *
 * Uses Alpaca's latest-trade endpoint as the price oracle (same source the
 * engine already uses for live pricing, so no new creds needed).
 */
export async function runPostExitFollower(
  store: GatewayStateStore,
  creds: { apiKey: string; apiSecret: string },
): Promise<{ updated: number; resolved: number; errors: string[] }> {
  const out = { updated: 0, resolved: 0, errors: [] as string[] };
  const rows = store.getUnresolvedPostExits();
  if (rows.length === 0) return out;

  const headers = {
    'APCA-API-KEY-ID': creds.apiKey,
    'APCA-API-SECRET-KEY': creds.apiSecret,
  };
  const dataUrl = 'https://data.alpaca.markets';

  for (const row of rows) {
    const ageMs = Date.now() - new Date(row.exitAt).getTime();
    const dueFor = (n: number, current: number | null) => current === null && ageMs >= n * DAY_MS;
    const needed: Array<'t1' | 't3' | 't5'> = [];
    if (dueFor(1, row.t1Price)) needed.push('t1');
    if (dueFor(3, row.t3Price)) needed.push('t3');
    if (dueFor(5, row.t5Price)) needed.push('t5');
    if (needed.length === 0) continue;

    let latestPrice: number | null = null;
    try {
      const url = `${dataUrl}/v2/stocks/${encodeURIComponent(row.ticker)}/trades/latest`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const data = await res.json() as any;
        const p = data?.trade?.p;
        if (typeof p === 'number' && isFinite(p)) latestPrice = p;
      }
    } catch (e: any) {
      out.errors.push(`${row.ticker}: ${e.message}`);
    }
    if (latestPrice === null) continue;

    for (const which of needed) {
      store.updatePostExitPrice(row.id, which, latestPrice);
      out.updated++;
    }

    // If T+5 just landed, finalize.
    const t5 = needed.includes('t5') ? latestPrice : row.t5Price;
    if (t5 !== null) {
      const regretPct = (t5 - row.exitPrice) / row.exitPrice;
      let verdict: string;
      if (regretPct > 0.10) verdict = 'sold_early_strong';
      else if (regretPct > 0.03) verdict = 'sold_early';
      else if (regretPct < -0.03) verdict = 'sold_right';
      else verdict = 'neutral';

      store.finalizePostExit(row.id, regretPct, verdict);
      out.resolved++;

      // Push regret signal to Trident — but ALSO amend the original trade memory
      // so shouldBuy doesn't block a ticker that was a CORRECT PICK with WRONG EXIT.
      //
      // A human trader who sold BIRD at $10.51 and watched it hit $19 thinks:
      // "I was right about the pick. My exit was wrong."
      // Trident should think the same way.
      if (verdict === 'sold_early_strong' || verdict === 'sold_early') {
        // Write an AMENDED memory that tells shouldBuy "this was a correct pick"
        const regretPctFmt = (regretPct * 100).toFixed(1);
        await brainFetch('/v1/memories', {
          method: 'POST',
          body: JSON.stringify({
            category: 'finance',
            title: `Trade WIN: ${row.ticker} long $0.00`,
            content: `TRADE AMENDED: ${row.ticker} was recorded as a LOSS but the post-exit analysis shows the stock ran +${regretPctFmt}% after we exited. The PICK was correct — the EXIT was wrong (sold too early). Pattern: the entry signal was valid, the exit timing was not. Next time: HOLD through initial volatility on this type of setup. Original exit: $${row.exitPrice.toFixed(2)}. Verdict: ${verdict}. | ${new Date().toISOString()}`,
            tags: ['trade', 'outcome', 'win', row.ticker.toLowerCase(), 'regret_amended', 'long'],
            source: 'mtwm-gateway:regret-amendment',
          }),
        }).catch(() => {});
        console.log(`[REGRET AMENDMENT] ${row.ticker}: loss AMENDED to win — stock ran +${regretPctFmt}% after exit (${verdict})`);
      } else {
        // sold_right or neutral — the original LOSS memory is correct, reinforce it
        brain.recordTradeClose(
          row.ticker,
          0,
          regretPct,
          `regret:${verdict}`,
          'long',
        ).catch(() => {});
      }
    }
  }
  return out;
}

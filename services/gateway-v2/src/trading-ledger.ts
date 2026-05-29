export type TradeLotSide = 'long' | 'short';

export interface TradeLot {
  ticker: string;
  boughtAt: string;
  price: number;
  qty: number;
  orderId: string;
  source: string;
  side: TradeLotSide;
}

async function pgQuery<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const { query } = await import('../../research-db/src/index.js');
  return query<T>(text, params);
}

export async function recordTradeLot(lot: {
  ticker: string;
  openedAt?: string;
  entryPrice: number;
  qty: number;
  brokerOrderId?: string | null;
  side: TradeLotSide;
  source: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const openedAt = lot.openedAt ?? new Date().toISOString();
  await pgQuery(`
    INSERT INTO trade_lots
      (ticker, opened_at, entry_price, qty, broker_order_id, side, source, status, metadata)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, 'open', $8::jsonb)
    ON CONFLICT (broker_order_id) WHERE broker_order_id IS NOT NULL DO UPDATE SET
      ticker = EXCLUDED.ticker,
      opened_at = EXCLUDED.opened_at,
      entry_price = EXCLUDED.entry_price,
      qty = EXCLUDED.qty,
      side = EXCLUDED.side,
      source = EXCLUDED.source,
      status = 'open',
      metadata = trade_lots.metadata || EXCLUDED.metadata
  `, [
    lot.ticker,
    openedAt,
    lot.entryPrice,
    lot.qty,
    lot.brokerOrderId ?? null,
    lot.side,
    lot.source,
    JSON.stringify(lot.metadata ?? {}),
  ]);
}

export async function getOpenTradeLots(): Promise<TradeLot[]> {
  const { rows } = await pgQuery<{
    ticker: string;
    opened_at: Date | string;
    entry_price: number;
    qty: number;
    broker_order_id: string | null;
    source: string;
    side: TradeLotSide;
  }>(`
    SELECT ticker, opened_at, entry_price, qty, broker_order_id, source, side
      FROM trade_lots
     WHERE status = 'open'
     ORDER BY opened_at ASC
  `);
  return rows.map((r) => ({
    ticker: r.ticker,
    boughtAt: new Date(r.opened_at).toISOString(),
    price: Number(r.entry_price),
    qty: Number(r.qty),
    orderId: r.broker_order_id ?? '',
    source: r.source,
    side: r.side,
  }));
}

export async function getTradeLotByOrderId(orderId: string | null | undefined): Promise<TradeLot | null> {
  if (!orderId) return null;
  const { rows } = await pgQuery<{
    ticker: string;
    opened_at: Date | string;
    entry_price: number;
    qty: number;
    broker_order_id: string | null;
    source: string;
    side: TradeLotSide;
  }>(`
    SELECT ticker, opened_at, entry_price, qty, broker_order_id, source, side
      FROM trade_lots
     WHERE broker_order_id = $1
     ORDER BY opened_at ASC
     LIMIT 1
  `, [orderId]);
  const r = rows[0];
  if (!r) return null;
  return {
    ticker: r.ticker,
    boughtAt: new Date(r.opened_at).toISOString(),
    price: Number(r.entry_price),
    qty: Number(r.qty),
    orderId: r.broker_order_id ?? '',
    source: r.source,
    side: r.side,
  };
}

export async function closeTradeLot(ticker: string, side: TradeLotSide, closedAt: string): Promise<void> {
  await pgQuery(`
    UPDATE trade_lots
       SET status = 'closed', closed_at = $3
     WHERE id = (
       SELECT id
         FROM trade_lots
        WHERE ticker = $1 AND side = $2 AND status = 'open'
        ORDER BY opened_at ASC
        LIMIT 1
     )
  `, [ticker, side, closedAt]);
}

export async function recordTradeClosePg(trade: {
  ticker: string;
  direction: TradeLotSide;
  reason: string;
  qty: number;
  entryPrice?: number | null;
  exitPrice: number;
  pnl: number;
  openedAt?: string | null;
  closedAt: string;
  orderId?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pgQuery(`
    INSERT INTO trade_closes
      (ticker, direction, reason, qty, entry_price, exit_price, pnl, opened_at, closed_at, broker_order_id, source, metadata)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
    ON CONFLICT DO NOTHING
  `, [
    trade.ticker,
    trade.direction,
    trade.reason,
    trade.qty,
    trade.entryPrice ?? null,
    trade.exitPrice,
    trade.pnl,
    trade.openedAt || null,
    trade.closedAt,
    trade.orderId ?? null,
    trade.source,
    JSON.stringify(trade.metadata ?? {}),
  ]);
}

export async function recordPostExitPg(entry: {
  ticker: string;
  exitAt: string;
  exitPrice: number;
  exitReason: string;
}): Promise<void> {
  await pgQuery(`
    INSERT INTO trade_post_exit_tracking
      (ticker, exit_at, exit_price, exit_reason)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (ticker, exit_at) DO NOTHING
  `, [entry.ticker, entry.exitAt, entry.exitPrice, entry.exitReason]);
}

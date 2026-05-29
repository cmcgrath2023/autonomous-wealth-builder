-- 008: Trading ledger in PostgreSQL.
-- Raw broker fills and realized trade outcomes live here. Trident/RuVector gets
-- selected learning memories derived from this ledger, not the other way around.

CREATE TABLE IF NOT EXISTS trade_lots (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  entry_price NUMERIC(18, 6) NOT NULL DEFAULT 0,
  qty NUMERIC(18, 6) NOT NULL DEFAULT 0,
  broker_order_id TEXT,
  side TEXT NOT NULL DEFAULT 'long'
    CHECK (side IN ('long', 'short')),
  source TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_lots_order
  ON trade_lots(broker_order_id)
  WHERE broker_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_lots_ticker_status ON trade_lots(ticker, status);
CREATE INDEX IF NOT EXISTS idx_trade_lots_opened ON trade_lots(opened_at);

CREATE TABLE IF NOT EXISTS trade_closes (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  reason TEXT NOT NULL DEFAULT '',
  qty NUMERIC(18, 6) NOT NULL DEFAULT 0,
  entry_price NUMERIC(18, 6),
  exit_price NUMERIC(18, 6) NOT NULL,
  pnl NUMERIC(18, 6) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ NOT NULL,
  broker_order_id TEXT,
  source TEXT NOT NULL DEFAULT 'engine',
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_closes_dedup
  ON trade_closes(ticker, closed_at, COALESCE(broker_order_id, ''));
CREATE INDEX IF NOT EXISTS idx_trade_closes_closed ON trade_closes(closed_at);
CREATE INDEX IF NOT EXISTS idx_trade_closes_ticker ON trade_closes(ticker);
CREATE INDEX IF NOT EXISTS idx_trade_closes_source ON trade_closes(source);

CREATE TABLE IF NOT EXISTS trade_post_exit_tracking (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  exit_at TIMESTAMPTZ NOT NULL,
  exit_price NUMERIC(18, 6) NOT NULL,
  exit_reason TEXT NOT NULL DEFAULT '',
  t1_price NUMERIC(18, 6),
  t3_price NUMERIC(18, 6),
  t5_price NUMERIC(18, 6),
  regret_pct NUMERIC(18, 6),
  verdict TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE(ticker, exit_at)
);

CREATE INDEX IF NOT EXISTS idx_trade_post_exit_ticker ON trade_post_exit_tracking(ticker);
CREATE INDEX IF NOT EXISTS idx_trade_post_exit_resolved ON trade_post_exit_tracking(resolved_at);

-- 003: Momentum tracking + catalyst history
-- Migrated from SQLite — these grow fast and benefit from PG's
-- concurrent writes, partitioning, and query optimizer.

CREATE TABLE IF NOT EXISTS momentum_snapshots (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT '',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price REAL NOT NULL,
  change_1d REAL NOT NULL DEFAULT 0,
  change_5d REAL NOT NULL DEFAULT 0,
  avg_volume REAL NOT NULL DEFAULT 0,
  momentum TEXT NOT NULL DEFAULT 'weak'
    CHECK (momentum IN ('strong', 'moderate', 'weak')),
  source TEXT NOT NULL DEFAULT 'scanner'
);

CREATE INDEX IF NOT EXISTS idx_mom_symbol ON momentum_snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_mom_sector ON momentum_snapshots(sector);
CREATE INDEX IF NOT EXISTS idx_mom_scanned ON momentum_snapshots(scanned_at);
CREATE INDEX IF NOT EXISTS idx_mom_change5d ON momentum_snapshots(change_5d);
-- Partition hint: if this table exceeds 10M rows, partition by scanned_at month


CREATE TABLE IF NOT EXISTS sector_momentum (
  id SERIAL PRIMARY KEY,
  sector TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ticker_count INTEGER NOT NULL DEFAULT 0,
  avg_change_1d REAL NOT NULL DEFAULT 0,
  avg_change_5d REAL NOT NULL DEFAULT 0,
  top_ticker TEXT,
  top_change_5d REAL,
  trend TEXT NOT NULL DEFAULT 'flat'
    CHECK (trend IN ('accelerating', 'decelerating', 'flat', 'reversing'))
);

CREATE INDEX IF NOT EXISTS idx_sec_mom_sector ON sector_momentum(sector);
CREATE INDEX IF NOT EXISTS idx_sec_mom_scanned ON sector_momentum(scanned_at);


CREATE TABLE IF NOT EXISTS catalyst_history (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  catalyst_type TEXT NOT NULL,
  headline TEXT NOT NULL,
  detail TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price_at_detection REAL,
  price_1d_after REAL,
  price_3d_after REAL,
  price_5d_after REAL,
  return_1d REAL,                                -- computed: (price_1d - price_at_detection) / price_at_detection
  return_5d REAL,
  outcome TEXT DEFAULT 'pending'
    CHECK (outcome IN ('strong_hit', 'hit', 'miss', 'strong_miss', 'pending')),
  source TEXT NOT NULL DEFAULT 'catalyst_hunter',
  resolved_at TIMESTAMPTZ,
  -- pgvector: "find similar past catalysts"
  embedding vector(384)
);

CREATE INDEX IF NOT EXISTS idx_cat_symbol ON catalyst_history(symbol);
CREATE INDEX IF NOT EXISTS idx_cat_type ON catalyst_history(catalyst_type);
CREATE INDEX IF NOT EXISTS idx_cat_detected ON catalyst_history(detected_at);
CREATE INDEX IF NOT EXISTS idx_cat_outcome ON catalyst_history(outcome);
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_cat_embedding ON catalyst_history
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN undefined_object THEN NULL; END $$;

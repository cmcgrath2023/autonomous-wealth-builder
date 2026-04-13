-- 002: Research signals + theses + outcomes
-- The pipeline: signals → theses → outcomes → performance tracking
-- This is what turns raw data into actionable conviction.

-- A signal is a single data point: "GS beat earnings by 8%"
-- Multiple signals can support one thesis: "Financials are in a cyclical upswing"
CREATE TABLE IF NOT EXISTS research_signals (
  id SERIAL PRIMARY KEY,
  symbol TEXT,                                   -- NULL for macro/sector signals
  sector TEXT,
  signal_type TEXT NOT NULL
    CHECK (signal_type IN (
      'earnings_beat', 'earnings_miss', 'fda_approval', 'fda_rejection',
      'upgrade', 'downgrade', 'insider_buy', 'insider_sell',
      'contract_win', 'partnership', 'acquisition', 'guidance_raise',
      'guidance_lower', 'short_squeeze', 'momentum_breakout',
      'sector_rotation', 'macro_shift', 'geopolitical',
      'technical_breakout', 'volume_surge', 'institutional_accumulation'
    )),
  headline TEXT NOT NULL,
  detail TEXT,                                   -- longer description
  source TEXT NOT NULL DEFAULT 'catalyst_hunter', -- who found it
  confidence REAL NOT NULL DEFAULT 0.5
    CHECK (confidence >= 0 AND confidence <= 1),
  price_at_signal REAL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                        -- signals have a shelf life
  -- pgvector: semantic search over signal content
  embedding vector(384)
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol ON research_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_sector ON research_signals(sector);
CREATE INDEX IF NOT EXISTS idx_signals_type ON research_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_detected ON research_signals(detected_at);
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_signals_embedding ON research_signals
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN undefined_object THEN NULL; END $$;


-- A thesis is an investment idea supported by one or more signals.
-- "Buy GS because financials are cycling up + earnings beat + analyst upgrades"
-- Theses get scored by conviction and tracked to outcomes.
CREATE TABLE IF NOT EXISTS research_theses (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short', 'avoid')),
  thesis TEXT NOT NULL,                          -- human-readable investment thesis
  conviction REAL NOT NULL DEFAULT 0.5
    CHECK (conviction >= 0 AND conviction <= 1),
  supporting_signals INTEGER[] NOT NULL DEFAULT '{}',  -- array of research_signals.id
  sector TEXT,
  timeframe TEXT NOT NULL DEFAULT 'intraday'
    CHECK (timeframe IN ('scalp', 'intraday', 'swing', 'position')),
  entry_target REAL,
  stop_target REAL,
  profit_target REAL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'triggered', 'expired', 'invalidated')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  triggered_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_theses_symbol ON research_theses(symbol);
CREATE INDEX IF NOT EXISTS idx_theses_status ON research_theses(status);
CREATE INDEX IF NOT EXISTS idx_theses_conviction ON research_theses(conviction);
CREATE INDEX IF NOT EXISTS idx_theses_sector ON research_theses(sector);


-- When a thesis leads to a trade, track the outcome.
-- This is how the system learns which types of theses produce profit.
CREATE TABLE IF NOT EXISTS thesis_outcomes (
  id SERIAL PRIMARY KEY,
  thesis_id INTEGER NOT NULL REFERENCES research_theses(id),
  trade_ticker TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  qty REAL NOT NULL,
  pnl REAL,
  return_pct REAL,
  hold_duration_minutes INTEGER,
  entry_at TIMESTAMPTZ NOT NULL,
  exit_at TIMESTAMPTZ,
  exit_reason TEXT,
  thesis_conviction_at_entry REAL,    -- what was the conviction when we entered?
  -- Did the thesis play out as expected?
  thesis_correct BOOLEAN,             -- NULL = still open, TRUE = thesis was right, FALSE = wrong
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_outcomes_thesis ON thesis_outcomes(thesis_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_ticker ON thesis_outcomes(trade_ticker);
CREATE INDEX IF NOT EXISTS idx_outcomes_correct ON thesis_outcomes(thesis_correct);


-- Aggregate performance of different signal types over time.
-- "Do FDA approval signals lead to profitable trades?"
-- Updated nightly by the post-mortem / thesis resolution job.
CREATE TABLE IF NOT EXISTS signal_performance (
  id SERIAL PRIMARY KEY,
  signal_type TEXT NOT NULL,
  sector TEXT,                                   -- NULL = all sectors
  period TEXT NOT NULL DEFAULT 'all_time'
    CHECK (period IN ('7d', '30d', '90d', 'all_time')),
  total_signals INTEGER NOT NULL DEFAULT 0,
  signals_traded INTEGER NOT NULL DEFAULT 0,     -- how many led to a trade
  avg_conviction REAL,
  trades_won INTEGER NOT NULL DEFAULT 0,
  trades_lost INTEGER NOT NULL DEFAULT 0,
  win_rate REAL,
  avg_return_pct REAL,
  total_pnl REAL,
  best_trade_pnl REAL,
  worst_trade_pnl REAL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (signal_type, sector, period)
);

CREATE INDEX IF NOT EXISTS idx_sig_perf_type ON signal_performance(signal_type);
CREATE INDEX IF NOT EXISTS idx_sig_perf_sector ON signal_performance(sector);

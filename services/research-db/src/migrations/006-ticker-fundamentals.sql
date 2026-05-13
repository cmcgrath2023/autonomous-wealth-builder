-- 006: Ticker fundamentals from deep research analyst
-- Analyst targets, earnings, insider activity, key financials.
-- Foundation for probabilistic conviction scoring.

CREATE TABLE IF NOT EXISTS ticker_fundamentals (
  symbol TEXT PRIMARY KEY,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Analyst consensus
  analyst_target_mean REAL,
  analyst_target_median REAL,
  analyst_target_high REAL,
  analyst_target_low REAL,
  analyst_count INTEGER DEFAULT 0,
  recommendation_key TEXT,              -- strongBuy, buy, hold, sell, strongSell
  recommendation_score REAL,            -- 1.0 (strong buy) to 5.0 (strong sell)

  -- Upgrades/downgrades (last 90 days)
  recent_upgrades INTEGER DEFAULT 0,
  recent_downgrades INTEGER DEFAULT 0,

  -- Earnings
  next_earnings_date TEXT,
  earnings_surprise_pct REAL,

  -- Insider activity (last 6 months)
  insider_buy_count INTEGER DEFAULT 0,
  insider_sell_count INTEGER DEFAULT 0,
  insider_net_shares BIGINT DEFAULT 0,

  -- Key financials
  revenue_growth REAL,
  profit_margin REAL,
  operating_margin REAL,
  return_on_equity REAL,
  debt_to_equity REAL,
  free_cash_flow BIGINT,
  current_price REAL,

  -- Derived
  fundamental_score INTEGER DEFAULT 50  -- 0-100 composite
);

CREATE INDEX IF NOT EXISTS idx_fundamentals_score ON ticker_fundamentals(fundamental_score DESC);
CREATE INDEX IF NOT EXISTS idx_fundamentals_rec ON ticker_fundamentals(recommendation_key);

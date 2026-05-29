-- 007: Research stars as durable opportunity records.
-- SQLite may cache these for the hot trading loop, but PG is the research
-- source of truth tied to company/fundamental profiles and downstream memory.

CREATE TABLE IF NOT EXISTS research_stars (
  symbol TEXT PRIMARY KEY,
  sector TEXT NOT NULL DEFAULT '',
  catalyst TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  direction TEXT NOT NULL DEFAULT 'long'
    CHECK (direction IN ('long', 'short', 'watch', 'avoid')),
  source TEXT NOT NULL DEFAULT 'gateway_v2',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_research_stars_score ON research_stars(score DESC);
CREATE INDEX IF NOT EXISTS idx_research_stars_sector ON research_stars(sector);
CREATE INDEX IF NOT EXISTS idx_research_stars_direction ON research_stars(direction);
CREATE INDEX IF NOT EXISTS idx_research_stars_active ON research_stars(active, updated_at DESC);

CREATE OR REPLACE VIEW v_research_stars_enriched AS
SELECT
  rs.symbol,
  rs.sector AS star_sector,
  COALESCE(NULLIF(c.sector, ''), rs.sector) AS company_sector,
  c.name,
  c.industry,
  c.market_cap_tier,
  c.last_price,
  tf.fundamental_score,
  tf.recommendation_key,
  tf.analyst_target_mean,
  tf.next_earnings_date,
  rs.catalyst,
  rs.score,
  rs.direction,
  rs.source,
  rs.first_seen_at,
  rs.updated_at,
  rs.expires_at,
  rs.active,
  rs.metadata
FROM research_stars rs
LEFT JOIN companies c ON c.symbol = rs.symbol
LEFT JOIN ticker_fundamentals tf ON tf.symbol = rs.symbol;

-- 004: Opus spec enhancements — sector hierarchy, relationship propagation,
-- signal decay, materialized views, enhanced fields

-- ────────────────────────────────────────────────────────────
-- SECTOR HIERARCHY (custom groupings beyond S&P)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sector_hierarchy (
  id            SERIAL PRIMARY KEY,
  sector        TEXT NOT NULL,
  industry      TEXT NOT NULL,
  sub_industry  TEXT NOT NULL DEFAULT '',
  custom_group  TEXT,  -- e.g. 'ai_infrastructure', 'defense_prime', 'copper_complex'
  UNIQUE(sector, industry, sub_industry)
);

-- ────────────────────────────────────────────────────────────
-- RELATIONSHIP PROPAGATION LOG (learning loop)
-- Tracks how signals travel through the knowledge graph.
-- When INTC announces and AMAT moves 2 days later, this logs it.
-- Over time, tunes relationship strength + lag_days.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relationship_propagation (
  id              SERIAL PRIMARY KEY,
  source_ticker   TEXT NOT NULL,
  target_ticker   TEXT NOT NULL,
  relationship_id INTEGER REFERENCES company_relationships(id),
  source_event    TEXT NOT NULL,       -- 'earnings_beat'|'price_spike'|'news'
  source_date     TIMESTAMPTZ NOT NULL,
  target_move_date TIMESTAMPTZ,
  observed_lag_days REAL,
  source_magnitude REAL,               -- % move in source
  target_magnitude REAL,               -- % move in target
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_source ON relationship_propagation(source_ticker);
CREATE INDEX IF NOT EXISTS idx_prop_target ON relationship_propagation(target_ticker);
CREATE INDEX IF NOT EXISTS idx_prop_rel ON relationship_propagation(relationship_id);

-- ────────────────────────────────────────────────────────────
-- ENHANCE EXISTING TABLES (add Opus fields)
-- ────────────────────────────────────────────────────────────

-- companies: add avg_volume_20d, next_earnings, index_membership
ALTER TABLE companies ADD COLUMN IF NOT EXISTS avg_volume_20d REAL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_earnings DATE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS index_membership TEXT[] DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sub_industry TEXT NOT NULL DEFAULT '';

-- company_relationships: add lag_days, revenue_pct, confidence
ALTER TABLE company_relationships ADD COLUMN IF NOT EXISTS lag_days INTEGER DEFAULT 0;
ALTER TABLE company_relationships ADD COLUMN IF NOT EXISTS revenue_pct REAL;
ALTER TABLE company_relationships ADD COLUMN IF NOT EXISTS confidence REAL NOT NULL DEFAULT 0.5;
ALTER TABLE company_relationships ADD COLUMN IF NOT EXISTS last_validated TIMESTAMPTZ;

-- research_signals: add decay_hours, related_tickers, metadata
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS decay_hours REAL NOT NULL DEFAULT 48;
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS related_tickers TEXT[] DEFAULT '{}';
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'nanobot';

-- research_theses: add Opus's conviction breakdown fields
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS narrative TEXT NOT NULL DEFAULT '';
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS bear_case TEXT NOT NULL DEFAULT '';
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS invalidation TEXT NOT NULL DEFAULT '';
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS trident_memory_id TEXT;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS signal_density_score REAL DEFAULT 0;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS relationship_leverage_score REAL DEFAULT 0;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS temporal_alignment_score REAL DEFAULT 0;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS pattern_match_score REAL DEFAULT 0;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS bayesian_context_score REAL DEFAULT 0;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS sector_momentum_score REAL DEFAULT 0;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS routed_to TEXT;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS authority_action TEXT;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
ALTER TABLE research_theses ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- thesis_outcomes: add max_favorable, max_adverse, invalidation_hit
ALTER TABLE thesis_outcomes ADD COLUMN IF NOT EXISTS max_favorable REAL;
ALTER TABLE thesis_outcomes ADD COLUMN IF NOT EXISTS max_adverse REAL;
ALTER TABLE thesis_outcomes ADD COLUMN IF NOT EXISTS invalidation_hit BOOLEAN DEFAULT FALSE;
ALTER TABLE thesis_outcomes ADD COLUMN IF NOT EXISTS thesis_conviction_at_entry REAL;

-- catalyst_history: add thesis_id link, metadata, return calculations
ALTER TABLE catalyst_history ADD COLUMN IF NOT EXISTS thesis_id INTEGER REFERENCES research_theses(id);
ALTER TABLE catalyst_history ADD COLUMN IF NOT EXISTS price_3d_after REAL;
ALTER TABLE catalyst_history ADD COLUMN IF NOT EXISTS return_1d REAL;
ALTER TABLE catalyst_history ADD COLUMN IF NOT EXISTS return_5d REAL;
ALTER TABLE catalyst_history ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- sector_momentum: add avg_change_20d, bottom_ticker, custom_group
ALTER TABLE sector_momentum ADD COLUMN IF NOT EXISTS avg_change_20d REAL;
ALTER TABLE sector_momentum ADD COLUMN IF NOT EXISTS bottom_ticker TEXT;
ALTER TABLE sector_momentum ADD COLUMN IF NOT EXISTS bottom_change_5d REAL;
ALTER TABLE sector_momentum ADD COLUMN IF NOT EXISTS custom_group TEXT;

-- momentum_snapshots: add change_20d, rel_volume
ALTER TABLE momentum_snapshots ADD COLUMN IF NOT EXISTS change_20d REAL;
ALTER TABLE momentum_snapshots ADD COLUMN IF NOT EXISTS rel_volume REAL;

-- signal_performance: rename to match Opus fields
ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS signals_in_winning_theses INTEGER DEFAULT 0;
ALTER TABLE signal_performance ADD COLUMN IF NOT EXISTS avg_return_contribution REAL DEFAULT 0;

-- ────────────────────────────────────────────────────────────
-- MATERIALIZED VIEWS
-- ────────────────────────────────────────────────────────────

-- 1-hop neighbors precomputed (bidirectional)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_relationship_hops AS
SELECT
  cr.symbol_a AS symbol,
  cr.symbol_b AS neighbor,
  cr.relationship,
  cr.strength,
  cr.lag_days,
  cr.revenue_pct,
  c.sector AS neighbor_sector,
  c.market_cap_tier AS neighbor_market_cap
FROM company_relationships cr
JOIN companies c ON c.symbol = cr.symbol_b
WHERE cr.strength >= 0.3
UNION ALL
SELECT
  cr.symbol_b AS symbol,
  cr.symbol_a AS neighbor,
  cr.relationship,
  cr.strength,
  cr.lag_days,
  cr.revenue_pct,
  c.sector AS neighbor_sector,
  c.market_cap_tier AS neighbor_market_cap
FROM company_relationships cr
JOIN companies c ON c.symbol = cr.symbol_a
WHERE cr.strength >= 0.3;

-- Active signals with decay applied
-- Uses 'confidence' (from migration 002) as the raw strength value
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_active_signals AS
SELECT *,
  confidence * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (NOW() - detected_at)) / (decay_hours * 3600)) AS decayed_strength
FROM research_signals
WHERE detected_at > NOW() - INTERVAL '7 days'
  AND confidence * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (NOW() - detected_at)) / (decay_hours * 3600)) > 0.05;

-- Upcoming earnings ranked by graph centrality (cascade potential)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_earnings_cascade AS
SELECT
  c.symbol,
  c.name,
  c.next_earnings,
  c.sector,
  COUNT(DISTINCT cr.symbol_b) AS downstream_count,
  AVG(cr.strength) AS avg_edge_strength,
  COUNT(DISTINCT cr.symbol_b) * AVG(cr.strength) AS cascade_score
FROM companies c
JOIN company_relationships cr ON cr.symbol_a = c.symbol
WHERE c.next_earnings IS NOT NULL
  AND c.next_earnings >= CURRENT_DATE
  AND c.next_earnings <= CURRENT_DATE + INTERVAL '14 days'
GROUP BY c.symbol, c.name, c.next_earnings, c.sector
ORDER BY cascade_score DESC;

-- 001: Companies + relationships
-- The knowledge graph of what we trade and how things connect.
-- When Intel announces, the system knows AAPL/MSFT/TSM/AMAT are related.

CREATE TABLE IF NOT EXISTS companies (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  sub_industry TEXT NOT NULL DEFAULT '',
  market_cap_usd BIGINT,                         -- in dollars, not millions
  market_cap_tier TEXT NOT NULL DEFAULT 'unknown'  -- mega|large|mid|small|micro
    CHECK (market_cap_tier IN ('mega','large','mid','small','micro','unknown')),
  exchange TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'US',
  avg_daily_volume BIGINT,
  last_price REAL,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  -- pgvector embedding for semantic similarity
  -- "find me companies similar to INTC" → cosine distance on this column
  embedding vector(384)                           -- all-MiniLM-L6-v2 dimension
);

CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies(sector);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);
CREATE INDEX IF NOT EXISTS idx_companies_cap ON companies(market_cap_tier);
-- Vector index for similarity search (HNSW is faster than IVFFlat for <1M rows)
-- Only created if pgvector is available
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_companies_embedding ON companies
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN undefined_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS company_relationships (
  id SERIAL PRIMARY KEY,
  symbol_a TEXT NOT NULL REFERENCES companies(symbol) ON DELETE CASCADE,
  symbol_b TEXT NOT NULL REFERENCES companies(symbol) ON DELETE CASCADE,
  relationship TEXT NOT NULL
    CHECK (relationship IN (
      'supplier', 'customer', 'competitor', 'partner',
      'sector_peer', 'parent', 'subsidiary', 'acquisition_target',
      'joint_venture', 'licensor', 'licensee'
    )),
  strength REAL NOT NULL DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
  evidence TEXT,                                  -- why we think this relationship exists
  source TEXT NOT NULL DEFAULT 'manual',           -- 'manual'|'catalyst_hunter'|'news'|'filing'
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  last_validated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (symbol_a, symbol_b, relationship)
);

CREATE INDEX IF NOT EXISTS idx_rel_a ON company_relationships(symbol_a);
CREATE INDEX IF NOT EXISTS idx_rel_b ON company_relationships(symbol_b);
CREATE INDEX IF NOT EXISTS idx_rel_type ON company_relationships(relationship);

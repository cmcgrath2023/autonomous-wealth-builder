# AWB Research System — Claude Code Executable Specification v1.0

**Codename:** Orca Phase 2 — Knowledge Graph \+ Thesis Pipeline

**Depends on:** Wave 1-2 shipped (Risk Manager, Post-Mortem, Catalyst Hunter, Macro Analyst). Wave 3 in progress (Exit Analyst, Sector Rotator).

**Architecture:** Postgres (knowledge graph \+ research) alongside existing SQLite (hot-path trading) alongside Trident Brain/RuVector (reasoning \+ patterns \+ SONA/LoRA)

---

## 1\. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AWB Gateway-V2 (port 3001)                       │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────────┐  │
│  │ state-store  │   │  pg-store    │   │  brain-client          │  │
│  │ (SQLite)     │   │  (Postgres)  │   │  (Trident Brain API)   │  │
│  │              │   │              │   │                        │  │
│  │ beliefs      │   │ companies    │   │ POST /v1/memories      │  │
│  │ closed_trades│   │ company_rels │   │ GET  /v1/memories/search│  │
│  │ system_buys  │   │ research_    │   │ POST /v1/train         │  │
│  │ post_exit    │   │   signals    │   │ shouldBuy/shouldSell   │  │
│  │ risk_rules   │   │ research_    │   │ (local logic + search) │  │
│  │ adaptive_    │   │   theses     │   │                        │  │
│  │   state      │   │ thesis_      │   │ 8000+ patterns         │  │
│  │ config       │   │   outcomes   │   │ 123+ LoRA epochs       │  │
│  │ reports      │   │ signal_perf  │   │ SONA continuous learn  │  │
│  │              │   │ catalyst_hist│   │                        │  │
│  │ HOT-PATH     │   │ sector_mom   │   │ REASONING ENGINE       │  │
│  │ TRADING OPS  │   │ momentum_snp │   │ PATTERN MEMORY         │  │
│  └──────────────┘   └──────────────┘   └────────────────────────┘  │
│         │                  │                       │                │
│         │ synchronous      │ async pooled          │ HTTPS          │
│         │ file-local       │ localhost:5432         │ remote         │
│         │ <1ms reads       │ <5ms queries           │ ~200ms calls   │
└─────────────────────────────────────────────────────────────────────┘
```

**Separation of concerns:**

- **SQLite** — Hot-path trading tables. Single-writer is fine because only the heartbeat writes. Survives Postgres being down. Never migrated, never changed.  
- **Postgres** — Knowledge graph, signals, theses, momentum. Concurrent reads/writes from heartbeat \+ Nanobot \+ thesis generator. Graph traversals. Materialized views. pgvector for company embeddings.  
- **Trident Brain** — Semantic reasoning, pattern memory, LoRA-trained buy/sell gating, SONA training. Called via HTTPS. Same 11 endpoints as today, no changes.

---

## 2\. Postgres Setup

### 2.1 Prerequisites

```shell
# macOS (iMac deployment)
brew install postgresql@16
brew services start postgresql@16

# Create database
createdb awb_research

# Enable pgvector extension
psql awb_research -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 2.2 Environment Variables

Add to `services/gateway/.env.local`:

```shell
# Postgres (Research System)
PG_HOST=127.0.0.1
PG_PORT=5432
PG_DATABASE=awb_research
PG_USER=cmcgrath
PG_PASSWORD=           # local trust auth, no password needed
PG_MAX_CONNECTIONS=10  # pool size
```

### 2.3 Connection Pool

**File: `services/gateway-v2/src/pg-store.ts`**

```ts
/**
 * pg-store.ts — Postgres connection for Research System
 * Coexists with state-store.ts (SQLite). Does NOT replace it.
 *
 * SQLite: beliefs, closed_trades, system_buys, post_exit_tracking,
 *         risk_rules, adaptive_state, config, reports
 * Postgres: companies, company_relationships, research_signals,
 *           research_theses, thesis_outcomes, signal_performance,
 *           catalyst_history, sector_momentum, momentum_snapshots
 */

import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function getPgPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PG_HOST || '127.0.0.1',
      port: parseInt(process.env.PG_PORT || '5432'),
      database: process.env.PG_DATABASE || 'awb_research',
      user: process.env.PG_USER || 'cmcgrath',
      password: process.env.PG_PASSWORD || '',
      max: parseInt(process.env.PG_MAX_CONNECTIONS || '10'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[pg-store] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

export async function initPgSchema(): Promise<void> {
  const client = await getPgPool().connect();
  try {
    await client.query(SCHEMA_SQL);
    await client.query(INDEXES_SQL);
    await client.query(MATERIALIZED_VIEWS_SQL);
    console.log('[pg-store] Schema initialized');
  } finally {
    client.release();
  }
}

export async function shutdownPg(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

---

## 3\. Postgres DDL — Knowledge Graph \+ Research Pipeline

### 3.1 Core Schema

```sql
-- ============================================================
-- AWB Research System — Postgres Schema
-- Run via: psql awb_research -f migrations/001_research_system.sql
-- ============================================================

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ────────────────────────────────────────────────────────────
-- 1. COMPANIES (migrated from SQLite, enhanced)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  symbol        TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  sector        TEXT NOT NULL DEFAULT '',
  industry      TEXT NOT NULL DEFAULT '',
  sub_industry  TEXT NOT NULL DEFAULT '',
  market_cap    TEXT NOT NULL DEFAULT '',    -- 'mega'|'large'|'mid'|'small'|'micro'
  last_price    REAL,
  avg_volume_20d REAL,                       -- 20-day average volume
  next_earnings  DATE,                       -- upcoming earnings date
  index_membership TEXT[] DEFAULT '{}',      -- e.g. {'SPY','QQQ','DIA'}
  embedding     vector(384),                 -- all-MiniLM-L6-v2 company description embedding
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 2. COMPANY RELATIONSHIPS (migrated from SQLite, enhanced)
-- The alpha table. This is the knowledge graph.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_relationships (
  id            SERIAL PRIMARY KEY,
  symbol_a      TEXT NOT NULL REFERENCES companies(symbol) ON DELETE CASCADE,
  symbol_b      TEXT NOT NULL REFERENCES companies(symbol) ON DELETE CASCADE,
  relationship  TEXT NOT NULL,  -- 'supplier'|'customer'|'competitor'|'partner'|
                                -- 'sector_peer'|'parent'|'subsidiary'|'spin_off'|
                                -- 'licensor'|'joint_venture'
  strength      REAL NOT NULL DEFAULT 0.5,   -- 0.0-1.0, tuned by feedback loop
  lag_days      INTEGER DEFAULT 0,            -- observed signal propagation delay
  revenue_pct   REAL,                         -- % of B's revenue tied to A (if known)
  confidence    REAL NOT NULL DEFAULT 0.5,    -- how certain: 1.0=SEC-confirmed, 0.3=inferred
  source        TEXT NOT NULL DEFAULT 'manual', -- 'manual'|'sec_filing'|'trident_inferred'|
                                                -- 'earnings_propagation'|'analyst'
  evidence      TEXT,                          -- filing reference, article, etc.
  last_validated TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(symbol_a, symbol_b, relationship)
);

-- ────────────────────────────────────────────────────────────
-- 3. SECTOR HIERARCHY (custom groupings beyond S&P)
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
-- 4. RESEARCH SIGNALS (from all detection pipelines)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_signals (
  id            SERIAL PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_type   TEXT NOT NULL,  -- 'options_flow'|'insider'|'filing_13f'|'filing_13d'|
                                -- 'earnings_beat'|'earnings_miss'|'macro'|'news'|
                                -- 'analyst_scan'|'sector_rotation'|'catalyst'
  ticker        TEXT NOT NULL,
  related_tickers TEXT[] DEFAULT '{}',  -- populated from company_relationships lookup
  signal_type   TEXT NOT NULL,          -- e.g. 'unusual_call_volume', 'insider_cluster_buy'
  raw_strength  REAL NOT NULL DEFAULT 0.5,  -- 0.0-1.0 normalized
  decay_hours   REAL NOT NULL DEFAULT 48,   -- how fast this signal loses value
  sector        TEXT NOT NULL DEFAULT '',
  metadata      JSONB NOT NULL DEFAULT '{}', -- source-specific details
  created_by    TEXT NOT NULL DEFAULT 'nanobot'
);

-- ────────────────────────────────────────────────────────────
-- 5. RESEARCH THESES (synthesized from signal clusters)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_theses (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  narrative       TEXT NOT NULL,              -- human-readable investment thesis
  primary_ticker  TEXT NOT NULL,
  related_tickers TEXT[] DEFAULT '{}',
  catalyst_type   TEXT NOT NULL,
  catalyst_start  DATE,                       -- expected catalyst window start
  catalyst_end    DATE,                       -- expected catalyst window end
  expected_magnitude REAL,                    -- expected % move
  bear_case       TEXT NOT NULL DEFAULT '',   -- adversarial review from Trident
  invalidation    TEXT NOT NULL DEFAULT '',   -- what would kill this thesis
  signal_ids      INTEGER[] DEFAULT '{}',     -- references to research_signals.id
  trident_memory_id TEXT,                     -- Trident memory ID for audit trail
  conviction_score  REAL NOT NULL DEFAULT 0,  -- 0-100 composite score
  -- Scoring breakdown
  signal_density_score      REAL DEFAULT 0,
  relationship_leverage_score REAL DEFAULT 0,
  temporal_alignment_score  REAL DEFAULT 0,
  pattern_match_score       REAL DEFAULT 0,
  bayesian_context_score    REAL DEFAULT 0,
  sector_momentum_score     REAL DEFAULT 0,
  -- Lifecycle
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active'|'promoted'|'expired'|'invalidated'
  routed_to       TEXT,   -- 'CommoditiesTrader'|'NeuralTrader'|'OptionsTrader'|'REITTrader'|'ForexScanner'
  authority_action TEXT,  -- 'observe'|'suggest'|'act'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  promoted_at     TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────
-- 6. THESIS OUTCOMES (feedback loop)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS thesis_outcomes (
  id              SERIAL PRIMARY KEY,
  thesis_id       INTEGER NOT NULL REFERENCES research_theses(id) ON DELETE CASCADE,
  entry_date      DATE,
  exit_date       DATE,
  entry_price     REAL,
  exit_price      REAL,
  realized_return REAL,                -- actual % return
  max_favorable   REAL,                -- best unrealized P&L during hold
  max_adverse     REAL,                -- worst unrealized P&L during hold
  thesis_correct  BOOLEAN,
  invalidation_hit BOOLEAN DEFAULT FALSE,
  notes           TEXT NOT NULL DEFAULT '',
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 7. SIGNAL PERFORMANCE (which sources predict moves?)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_performance (
  id                        SERIAL PRIMARY KEY,
  source_type               TEXT NOT NULL,
  sector                    TEXT NOT NULL DEFAULT 'all',
  total_signals             INTEGER NOT NULL DEFAULT 0,
  signals_in_winning_theses INTEGER NOT NULL DEFAULT 0,
  hit_rate                  REAL NOT NULL DEFAULT 0,
  avg_return_contribution   REAL NOT NULL DEFAULT 0,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(source_type, sector)
);

-- ────────────────────────────────────────────────────────────
-- 8. CATALYST HISTORY (migrated from SQLite, enhanced)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalyst_history (
  id                  SERIAL PRIMARY KEY,
  symbol              TEXT NOT NULL,
  catalyst_type       TEXT NOT NULL,
  headline            TEXT NOT NULL,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price_at_detection  REAL,
  price_1d_after      REAL,
  price_5d_after      REAL,
  outcome             TEXT,  -- 'hit'|'miss'|'pending'
  source              TEXT NOT NULL DEFAULT 'catalyst_hunter',
  thesis_id           INTEGER REFERENCES research_theses(id),  -- link to thesis if applicable
  metadata            JSONB DEFAULT '{}'
);

-- ────────────────────────────────────────────────────────────
-- 9. SECTOR MOMENTUM (migrated from SQLite, enhanced)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sector_momentum (
  id              SERIAL PRIMARY KEY,
  sector          TEXT NOT NULL,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ticker_count    INTEGER NOT NULL,
  avg_change_1d   REAL NOT NULL,
  avg_change_5d   REAL NOT NULL,
  avg_change_20d  REAL,               -- added: 20-day for trend confirmation
  top_ticker      TEXT,
  top_change_5d   REAL,
  bottom_ticker   TEXT,               -- added: worst performer
  bottom_change_5d REAL,
  trend           TEXT NOT NULL DEFAULT 'flat',  -- 'accelerating'|'decelerating'|'flat'
  custom_group    TEXT                -- links to sector_hierarchy.custom_group
);

-- ────────────────────────────────────────────────────────────
-- 10. MOMENTUM SNAPSHOTS (migrated from SQLite)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS momentum_snapshots (
  id            SERIAL PRIMARY KEY,
  symbol        TEXT NOT NULL,
  sector        TEXT NOT NULL,
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price         REAL NOT NULL,
  change_1d     REAL NOT NULL,
  change_5d     REAL NOT NULL,
  change_20d    REAL,                   -- added
  avg_volume    REAL NOT NULL DEFAULT 0,
  rel_volume    REAL,                   -- volume vs 20d average (spike detection)
  momentum      TEXT NOT NULL           -- 'strong'|'moderate'|'weak'
);

-- ────────────────────────────────────────────────────────────
-- 11. RELATIONSHIP PROPAGATION LOG (learning loop)
-- Tracks observed signal propagation through the graph
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
```

### 3.2 Indexes

```sql
-- ============================================================
-- INDEXES — Performance-critical query paths
-- ============================================================

-- Company lookups
CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies(sector);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);
CREATE INDEX IF NOT EXISTS idx_companies_market_cap ON companies(market_cap);

-- Relationship graph traversals
CREATE INDEX IF NOT EXISTS idx_rels_symbol_a ON company_relationships(symbol_a);
CREATE INDEX IF NOT EXISTS idx_rels_symbol_b ON company_relationships(symbol_b);
CREATE INDEX IF NOT EXISTS idx_rels_relationship ON company_relationships(relationship);
CREATE INDEX IF NOT EXISTS idx_rels_strength ON company_relationships(strength DESC);

-- Signal queries (time-windowed, by ticker, by type)
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON research_signals(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signals_ticker ON research_signals(ticker);
CREATE INDEX IF NOT EXISTS idx_signals_source ON research_signals(source_type);
CREATE INDEX IF NOT EXISTS idx_signals_sector ON research_signals(sector);

-- Thesis lifecycle queries
CREATE INDEX IF NOT EXISTS idx_theses_status ON research_theses(status);
CREATE INDEX IF NOT EXISTS idx_theses_conviction ON research_theses(conviction_score DESC);
CREATE INDEX IF NOT EXISTS idx_theses_ticker ON research_theses(primary_ticker);
CREATE INDEX IF NOT EXISTS idx_theses_created ON research_theses(created_at DESC);

-- Catalyst tracking
CREATE INDEX IF NOT EXISTS idx_catalyst_symbol ON catalyst_history(symbol);
CREATE INDEX IF NOT EXISTS idx_catalyst_outcome ON catalyst_history(outcome);
CREATE INDEX IF NOT EXISTS idx_catalyst_detected ON catalyst_history(detected_at DESC);

-- Momentum time series
CREATE INDEX IF NOT EXISTS idx_momentum_snap_symbol ON momentum_snapshots(symbol, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_sector_mom_sector ON sector_momentum(sector, scanned_at DESC);

-- Propagation analysis
CREATE INDEX IF NOT EXISTS idx_prop_source ON relationship_propagation(source_ticker);
CREATE INDEX IF NOT EXISTS idx_prop_target ON relationship_propagation(target_ticker);

-- pgvector index (IVFFlat for 2000 companies is fine; switch to HNSW at 10K+)
CREATE INDEX IF NOT EXISTS idx_companies_embedding ON companies
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);
```

### 3.3 Materialized Views

```sql
-- ============================================================
-- MATERIALIZED VIEWS — Refreshed by Nanobot cron
-- ============================================================

-- Precomputed 1-hop neighbors for every ticker
-- Query: SELECT * FROM mv_relationship_hops WHERE symbol = 'FCX'
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_relationship_hops AS
SELECT
  cr.symbol_a AS symbol,
  cr.symbol_b AS neighbor,
  cr.relationship,
  cr.strength,
  cr.lag_days,
  cr.revenue_pct,
  c.sector AS neighbor_sector,
  c.market_cap AS neighbor_market_cap
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
  c.market_cap AS neighbor_market_cap
FROM company_relationships cr
JOIN companies c ON c.symbol = cr.symbol_a
WHERE cr.strength >= 0.3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_hops ON mv_relationship_hops(symbol, neighbor, relationship);

-- Upcoming earnings ranked by graph centrality
-- Companies whose results will propagate the most signal
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

-- Signal decay view — only signals still "alive" (within decay window)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_active_signals AS
SELECT *,
  raw_strength * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (NOW() - timestamp)) / (decay_hours * 3600)) AS decayed_strength
FROM research_signals
WHERE timestamp > NOW() - INTERVAL '7 days'
  AND raw_strength * GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (NOW() - timestamp)) / (decay_hours * 3600)) > 0.05;

-- Refresh command (called by Nanobot cron)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_relationship_hops;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_earnings_cascade;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_active_signals;
```

---

## 4\. Key Postgres Query Patterns

### 4.1 Multi-Hop Graph Traversal

```sql
-- "Find all companies within 2 hops of TSMC with cumulative strength > 0.3"
WITH RECURSIVE hop AS (
  -- Base: direct neighbors of TSMC
  SELECT symbol_b AS symbol, strength, 1 AS depth,
         ARRAY[symbol_a, symbol_b] AS path
  FROM company_relationships
  WHERE symbol_a = 'TSM' AND strength >= 0.3
  
  UNION ALL
  
  -- Recurse: neighbors of neighbors
  SELECT cr.symbol_b, cr.strength * h.strength AS strength, h.depth + 1,
         h.path || cr.symbol_b
  FROM company_relationships cr
  JOIN hop h ON h.symbol = cr.symbol_a
  WHERE h.depth < 2
    AND cr.symbol_b != ALL(h.path)  -- no cycles
    AND cr.strength >= 0.3
)
SELECT DISTINCT ON (symbol) symbol, strength, depth, path
FROM hop
ORDER BY symbol, strength DESC;
```

### 4.2 Signal Cluster Detection

```sql
-- "Find tickers with 2+ active signals in the last 4 hours"
SELECT
  ticker,
  COUNT(*) AS signal_count,
  array_agg(DISTINCT source_type) AS sources,
  AVG(decayed_strength) AS avg_strength,
  MIN(timestamp) AS first_signal,
  MAX(timestamp) AS last_signal
FROM mv_active_signals
WHERE timestamp > NOW() - INTERVAL '4 hours'
GROUP BY ticker
HAVING COUNT(*) >= 2
ORDER BY AVG(decayed_strength) DESC;
```

### 4.3 Blast Radius Query

```sql
-- "FCX has a signal — what's the full blast radius?"
SELECT
  h.neighbor,
  h.relationship,
  h.strength,
  h.neighbor_sector,
  s.signal_count,
  sm.trend AS sector_trend
FROM mv_relationship_hops h
LEFT JOIN (
  SELECT ticker, COUNT(*) AS signal_count
  FROM mv_active_signals
  GROUP BY ticker
) s ON s.ticker = h.neighbor
LEFT JOIN LATERAL (
  SELECT trend FROM sector_momentum
  WHERE sector = h.neighbor_sector
  ORDER BY scanned_at DESC LIMIT 1
) sm ON TRUE
WHERE h.symbol = 'FCX'
ORDER BY h.strength DESC;
```

### 4.4 Semantic Company Search (pgvector)

```sql
-- "Find companies most similar to this description embedding"
-- $1 = embedding vector from all-MiniLM-L6-v2
SELECT symbol, name, sector, industry,
       1 - (embedding <=> $1::vector) AS similarity
FROM companies
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

---

## 5\. Conviction Scorer

**File: `services/gateway-v2/src/analysts/conviction-scorer.ts`**

The scorer takes a signal cluster and produces a thesis with a 0-100 composite score. It queries three sources: Postgres (structure), SQLite state-store (Bayesian beliefs), and Trident Brain (pattern memory).

```ts
/**
 * conviction-scorer.ts
 *
 * Scores signal clusters into conviction-ranked research theses.
 * Queries:
 *   - Postgres: company_relationships, mv_active_signals, sector_momentum,
 *               catalyst_history, signal_performance
 *   - SQLite:   beliefs (Bayesian posteriors)
 *   - Trident:  /v1/memories/search (pattern matching)
 *
 * Output: research_theses row with composite conviction_score 0-100
 */

import { getPgPool } from '../pg-store';
import { getDb } from '../state-store';       // existing SQLite
import { brain } from '../brain-client';       // existing Trident client

// ── Types ──────────────────────────────────────────────────────────

interface SignalCluster {
  ticker: string;
  signals: ActiveSignal[];         // from mv_active_signals
  relatedTickers: string[];        // from company_relationships
  sector: string;
}

interface ActiveSignal {
  id: number;
  source_type: string;
  ticker: string;
  signal_type: string;
  decayed_strength: number;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

interface ConvictionResult {
  compositeScore: number;          // 0-100
  signalDensity: number;           // 0-100
  relationshipLeverage: number;    // 0-100
  temporalAlignment: number;       // 0-100
  patternMatch: number;            // 0-100
  bayesianContext: number;         // 0-100
  sectorMomentum: number;         // 0-100
  signalQuality: number;          // 0-100
}

// ── Weights ────────────────────────────────────────────────────────
// These can be tuned via the config table in SQLite

const WEIGHTS = {
  signalDensity:         0.20,
  relationshipLeverage:  0.15,
  temporalAlignment:     0.15,
  patternMatch:          0.15,
  bayesianContext:       0.10,
  sectorMomentum:        0.10,
  signalQuality:         0.15,
};

// ── Scorer ─────────────────────────────────────────────────────────

export async function scoreConviction(cluster: SignalCluster): Promise<ConvictionResult> {
  const pg = getPgPool();
  const db = getDb();  // SQLite

  // 1. Signal Density (0-100)
  // More independent signals = higher conviction
  const uniqueSources = new Set(cluster.signals.map(s => s.source_type));
  const signalDensity = Math.min(100,
    (uniqueSources.size / 5) * 60 +           // diversity: 5 sources = 60 pts
    (cluster.signals.length / 8) * 40          // count: 8 signals = 40 pts
  );

  // 2. Relationship Leverage (0-100)
  // How central is this ticker in the graph? More connections = more propagation
  const { rows: neighbors } = await pg.query(
    `SELECT COUNT(*) AS cnt, AVG(strength) AS avg_str
     FROM mv_relationship_hops WHERE symbol = $1`,
    [cluster.ticker]
  );
  const neighborCount = parseInt(neighbors[0]?.cnt || '0');
  const avgStrength = parseFloat(neighbors[0]?.avg_str || '0.5');
  const relationshipLeverage = Math.min(100,
    (neighborCount / 15) * 60 +               // 15+ neighbors = 60 pts
    avgStrength * 40                           // strong edges = 40 pts
  );

  // 3. Temporal Alignment (0-100)
  // Signals clustering in time = higher conviction
  const timestamps = cluster.signals.map(s => new Date(s.timestamp).getTime());
  const timeSpanHours = (Math.max(...timestamps) - Math.min(...timestamps)) / 3600000;
  const temporalAlignment = Math.min(100,
    timeSpanHours < 1 ? 100 :                 // all within 1 hour = perfect
    timeSpanHours < 4 ? 80 :                  // within 4 hours = strong
    timeSpanHours < 24 ? 50 :                 // within 1 day = moderate
    20                                         // spread out = weak
  );

  // 4. Pattern Match (0-100)
  // Query Trident Brain for similar historical patterns
  const searchQuery = `THESIS ${cluster.ticker} ${cluster.sector} ${cluster.signals.map(s => s.signal_type).join(' ')}`;
  let patternMatch = 30; // default: no strong pattern
  try {
    const memories = await brain.get(
      `/v1/memories/search?q=${encodeURIComponent(searchQuery)}&limit=10`
    );
    if (memories && memories.length > 0) {
      // Count how many past theses on similar setups were wins
      const wins = memories.filter((m: any) =>
        m.content?.includes('WIN') || m.content?.includes('good_thesis')
      ).length;
      const losses = memories.filter((m: any) =>
        m.content?.includes('LOSS') || m.content?.includes('bad_thesis')
      ).length;
      const total = wins + losses;
      patternMatch = total > 0 ? Math.min(100, (wins / total) * 100) : 30;
    }
  } catch (err) {
    console.warn('[conviction] Trident pattern search failed:', err);
  }

  // 5. Bayesian Context (0-100)
  // Does the SQLite beliefs table support this ticker?
  const belief = db.prepare(
    `SELECT posterior, observations FROM beliefs WHERE domain = 'ticker' AND subject = ?`
  ).get(cluster.ticker) as { posterior: number; observations: number } | undefined;

  let bayesianContext = 50; // neutral if no data
  if (belief && belief.observations >= 3) {
    bayesianContext = Math.min(100, belief.posterior * 100);
  }

  // 6. Sector Momentum (0-100)
  // Is the sector accelerating or decelerating?
  const { rows: sectorRows } = await pg.query(
    `SELECT trend, avg_change_5d FROM sector_momentum
     WHERE sector = $1 ORDER BY scanned_at DESC LIMIT 1`,
    [cluster.sector]
  );
  let sectorMomentum = 50; // neutral default
  if (sectorRows.length > 0) {
    const trend = sectorRows[0].trend;
    const change5d = sectorRows[0].avg_change_5d;
    sectorMomentum = trend === 'accelerating' ? Math.min(100, 60 + change5d * 5) :
                     trend === 'decelerating' ? Math.max(10, 40 + change5d * 5) :
                     50;
  }

  // 7. Signal Quality (0-100)
  // How reliable are the signal sources in this cluster historically?
  const { rows: perfRows } = await pg.query(
    `SELECT source_type, hit_rate FROM signal_performance
     WHERE source_type = ANY($1)`,
    [Array.from(uniqueSources)]
  );
  let signalQuality = 50; // default if no history
  if (perfRows.length > 0) {
    signalQuality = Math.min(100,
      (perfRows.reduce((sum: number, r: any) => sum + r.hit_rate, 0) / perfRows.length) * 100
    );
  }

  // Composite score
  const compositeScore = Math.round(
    signalDensity * WEIGHTS.signalDensity +
    relationshipLeverage * WEIGHTS.relationshipLeverage +
    temporalAlignment * WEIGHTS.temporalAlignment +
    patternMatch * WEIGHTS.patternMatch +
    bayesianContext * WEIGHTS.bayesianContext +
    sectorMomentum * WEIGHTS.sectorMomentum +
    signalQuality * WEIGHTS.signalQuality
  );

  return {
    compositeScore,
    signalDensity: Math.round(signalDensity),
    relationshipLeverage: Math.round(relationshipLeverage),
    temporalAlignment: Math.round(temporalAlignment),
    patternMatch: Math.round(patternMatch),
    bayesianContext: Math.round(bayesianContext),
    sectorMomentum: Math.round(sectorMomentum),
    signalQuality: Math.round(signalQuality),
  };
}
```

---

## 6\. Thesis Generation Pipeline

**File: `services/gateway-v2/src/analysts/thesis-generator.ts`**

```ts
/**
 * thesis-generator.ts
 *
 * Detects signal clusters → calls Trident Brain for synthesis →
 * scores conviction → writes to research_theses → promotes to
 * Authority Matrix if above threshold.
 *
 * Called from heartbeat action 12 (research-agent:deep_research)
 */

import { getPgPool } from '../pg-store';
import { brain } from '../brain-client';
import { scoreConviction } from './conviction-scorer';

// ── Configuration ──────────────────────────────────────────────────

const CLUSTER_WINDOW_HOURS = 4;       // signals within this window form a cluster
const MIN_CLUSTER_SIZE = 2;           // minimum signals to form a cluster
const PROMOTE_THRESHOLD = 65;         // conviction score to promote to Authority Matrix
const SUGGEST_THRESHOLD = 50;         // conviction score to surface as suggestion

// ── Cluster Detection ──────────────────────────────────────────────

export async function detectSignalClusters(): Promise<SignalCluster[]> {
  const pg = getPgPool();

  // Find tickers with multiple active signals in the window
  const { rows } = await pg.query(`
    SELECT
      ticker,
      COUNT(*) AS signal_count,
      array_agg(DISTINCT source_type) AS sources,
      AVG(decayed_strength) AS avg_strength,
      (SELECT sector FROM companies WHERE symbol = ticker LIMIT 1) AS sector
    FROM mv_active_signals
    WHERE timestamp > NOW() - INTERVAL '${CLUSTER_WINDOW_HOURS} hours'
    GROUP BY ticker
    HAVING COUNT(*) >= ${MIN_CLUSTER_SIZE}
    ORDER BY AVG(decayed_strength) DESC
    LIMIT 10
  `);

  const clusters: SignalCluster[] = [];

  for (const row of rows) {
    // Get the actual signals
    const { rows: signals } = await pg.query(`
      SELECT * FROM mv_active_signals
      WHERE ticker = $1
        AND timestamp > NOW() - INTERVAL '${CLUSTER_WINDOW_HOURS} hours'
      ORDER BY decayed_strength DESC
    `, [row.ticker]);

    // Get related tickers from knowledge graph
    const { rows: related } = await pg.query(`
      SELECT DISTINCT neighbor FROM mv_relationship_hops
      WHERE symbol = $1
      ORDER BY strength DESC
      LIMIT 15
    `, [row.ticker]);

    clusters.push({
      ticker: row.ticker,
      signals,
      relatedTickers: related.map((r: any) => r.neighbor),
      sector: row.sector || '',
    });
  }

  return clusters;
}

// ── Thesis Synthesis ───────────────────────────────────────────────

export async function generateThesis(cluster: SignalCluster): Promise<number | null> {
  const pg = getPgPool();

  // 1. Score conviction
  const conviction = await scoreConviction(cluster);

  // Skip low-conviction clusters
  if (conviction.compositeScore < 30) return null;

  // 2. Get Trident Brain context for synthesis
  let tridentContext = '';
  let bearCase = '';
  let tridentMemoryId: string | null = null;

  try {
    // Ask Trident what it knows about this ticker and sector
    const memories = await brain.get(
      `/v1/memories/search?q=${encodeURIComponent(cluster.ticker + ' ' + cluster.sector)}&limit=15`
    );
    tridentContext = memories
      .map((m: any) => m.content)
      .join('\n')
      .substring(0, 2000); // truncate for storage

    // Generate bear case by searching for negative signals
    const bearMemories = await brain.get(
      `/v1/memories/search?q=${encodeURIComponent('LOSS ' + cluster.ticker + ' risk')}&limit=5`
    );
    bearCase = bearMemories
      .map((m: any) => m.content)
      .filter((c: string) => c.includes('LOSS') || c.includes('risk') || c.includes('avoid'))
      .join('; ')
      .substring(0, 500) || 'No historical bear case data available';
  } catch (err) {
    console.warn('[thesis] Trident context fetch failed:', err);
  }

  // 3. Build thesis narrative from signals + context
  const signalSummary = cluster.signals
    .map(s => `${s.source_type}:${s.signal_type} (strength=${s.decayed_strength.toFixed(2)})`)
    .join(', ');

  const narrative = [
    `Signal cluster detected on ${cluster.ticker} (${cluster.sector}).`,
    `${cluster.signals.length} signals from ${new Set(cluster.signals.map(s => s.source_type)).size} independent sources: ${signalSummary}.`,
    `Related tickers in knowledge graph: ${cluster.relatedTickers.slice(0, 8).join(', ')}.`,
    tridentContext ? `Trident context: ${tridentContext.substring(0, 500)}` : '',
  ].filter(Boolean).join(' ');

  const title = `${cluster.ticker}: ${cluster.signals[0]?.signal_type || 'multi-signal'} cluster (conviction ${conviction.compositeScore})`;

  // 4. Determine authority action
  const authorityAction =
    conviction.compositeScore >= PROMOTE_THRESHOLD ? 'act' :
    conviction.compositeScore >= SUGGEST_THRESHOLD ? 'suggest' :
    'observe';

  // 5. Determine routing (which MTWM service handles execution)
  const routedTo = determineRouting(cluster);

  // 6. Store thesis as Trident memory for future pattern matching
  try {
    const result = await brain.post('/v1/memories', {
      category: 'finance',
      title: `THESIS: ${title}`,
      content: `${narrative}\n\nConviction: ${conviction.compositeScore}/100\nBear case: ${bearCase}`,
      tags: ['thesis', cluster.ticker, cluster.sector, authorityAction],
      source: 'research-system',
    });
    tridentMemoryId = result?.id || null;
  } catch (err) {
    console.warn('[thesis] Failed to store in Trident:', err);
  }

  // 7. Write to Postgres
  const { rows: inserted } = await pg.query(`
    INSERT INTO research_theses (
      title, narrative, primary_ticker, related_tickers,
      catalyst_type, expected_magnitude, bear_case, invalidation,
      signal_ids, trident_memory_id, conviction_score,
      signal_density_score, relationship_leverage_score,
      temporal_alignment_score, pattern_match_score,
      bayesian_context_score, sector_momentum_score,
      status, routed_to, authority_action, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW()
    ) RETURNING id
  `, [
    title,
    narrative,
    cluster.ticker,
    cluster.relatedTickers,
    cluster.signals[0]?.signal_type || 'unknown',
    null, // expected_magnitude — can be enhanced later
    bearCase,
    '', // invalidation criteria — can be enhanced later
    cluster.signals.map(s => s.id),
    tridentMemoryId,
    conviction.compositeScore,
    conviction.signalDensity,
    conviction.relationshipLeverage,
    conviction.temporalAlignment,
    conviction.patternMatch,
    conviction.bayesianContext,
    conviction.sectorMomentum,
    authorityAction === 'act' ? 'promoted' : 'active',
    routedTo,
    authorityAction,
  ]);

  const thesisId = inserted[0]?.id;
  console.log(`[thesis] Generated: ${title} → conviction=${conviction.compositeScore}, action=${authorityAction}`);

  return thesisId;
}

// ── Service Routing ────────────────────────────────────────────────

function determineRouting(cluster: SignalCluster): string {
  const sector = cluster.sector.toLowerCase();
  const ticker = cluster.ticker;

  // Commodity tickers
  const commodityTickers = ['LE','HE','GF','ZC','ZS','ZW','CL','NG','HG','GC','SI','KC','SB'];
  if (commodityTickers.includes(ticker)) return 'CommoditiesTrader';

  // Copper/uranium/rare earth complex
  const infraTickers = ['FCX','SCCO','COPX','CCJ','CEG','TLN','D','URA','MP','REMX','ALB','LNG','EQT','VST','NEE'];
  if (infraTickers.includes(ticker)) return 'DataCenterInfra';

  // REIT universe
  const reitTickers = ['EQIX','DLR','PLD','STAG','AVB','EQR','WELL','VTR'];
  if (reitTickers.includes(ticker)) return 'REITTrader';

  // Forex pairs
  if (ticker.includes('/') || ['EURUSD','GBPUSD','USDJPY','AUDJPY','NZDJPY'].includes(ticker)) {
    return 'ForexScanner';
  }

  // Default to NeuralTrader for equities
  return 'NeuralTrader';
}

// ── Main Research Heartbeat Action ─────────────────────────────────

export async function runResearchCycle(): Promise<void> {
  console.log('[research] Starting research cycle...');

  // 1. Refresh materialized views
  const pg = getPgPool();
  try {
    await pg.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_active_signals');
    await pg.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_relationship_hops');
  } catch (err) {
    // CONCURRENTLY may fail if no unique index — fall back
    await pg.query('REFRESH MATERIALIZED VIEW mv_active_signals');
    await pg.query('REFRESH MATERIALIZED VIEW mv_relationship_hops');
  }

  // 2. Detect signal clusters
  const clusters = await detectSignalClusters();
  console.log(`[research] Found ${clusters.length} signal clusters`);

  // 3. Generate theses
  for (const cluster of clusters) {
    try {
      await generateThesis(cluster);
    } catch (err) {
      console.error(`[research] Thesis generation failed for ${cluster.ticker}:`, err);
    }
  }

  // 4. Expire old theses
  await pg.query(`
    UPDATE research_theses
    SET status = 'expired', resolved_at = NOW()
    WHERE status = 'active'
      AND created_at < NOW() - INTERVAL '7 days'
  `);

  console.log('[research] Cycle complete');
}
```

---

## 7\. Nanobot Cron Tasks (Clean Reintroduction)

These are the first Nanobot tasks for the clean reintro. Each follows the existing `NanobotTaskConfig` pattern from the nanobot-bridge spec.

### 7.1 Knowledge Graph Refresh (Nightly)

```
taskClass: knowledge_graph_refresh
cronExpression: '0 2 * * *'          # 2 AM daily
timeoutMs: 300000                     # 5 min
modelProvider: anthropic
modelId: claude-haiku-4-5-20251001    # cheap for data gathering
authorityThreshold:
  canExecuteTrades: false
  requiresApproval: false

# Actions:
# 1. Populate companies table from Alpaca asset endpoint
# 2. Call Trident search_knowledge to enrich company descriptions
# 3. Generate embeddings via all-MiniLM-L6-v2 for new/updated companies
# 4. Refresh company_relationships from Trident-inferred sources
# 5. Refresh all materialized views
# 6. Update sector_hierarchy custom groups
```

### 7.2 Signal Scan (Every 15 Min During Market Hours)

```
taskClass: research_signal_scan
cronExpression: '*/15 9-16 * * 1-5'  # Every 15 min, market hours, weekdays
timeoutMs: 60000                      # 1 min
modelProvider: anthropic
modelId: claude-haiku-4-5-20251001
authorityThreshold:
  canExecuteTrades: false
  requiresApproval: false

# Actions:
# 1. Read latest catalyst_history entries from Catalyst Hunter (Wave 2)
# 2. Read latest momentum_snapshots from Momentum Scanner
# 3. Cross-reference movers against company_relationships (blast radius)
# 4. Write new research_signals rows
# 5. Tag related_tickers from mv_relationship_hops
```

### 7.3 Thesis Resolution (Daily 4:30 PM)

```
taskClass: thesis_resolution
cronExpression: '30 16 * * 1-5'      # 4:30 PM ET, weekdays
timeoutMs: 120000                     # 2 min
modelProvider: anthropic
modelId: claude-sonnet-4-6            # needs reasoning for outcome eval
authorityThreshold:
  canExecuteTrades: false
  requiresApproval: false

# Actions:
# 1. Check all active/promoted theses against current prices
# 2. Write thesis_outcomes for resolved theses
# 3. Feed results to Trident SONA: POST /v1/train
# 4. Update signal_performance hit rates
# 5. Update company_relationships strength/lag_days from propagation log
# 6. Refresh mv_earnings_cascade
```

### 7.4 Materialized View Refresh (Every 30 Min)

```
taskClass: mv_refresh
cronExpression: '*/30 * * * *'       # Every 30 min
timeoutMs: 30000                      # 30 sec
modelProvider: none                   # No LLM needed — pure SQL
authorityThreshold:
  canExecuteTrades: false
  requiresApproval: false

# Actions:
# 1. REFRESH MATERIALIZED VIEW CONCURRENTLY mv_active_signals
# 2. REFRESH MATERIALIZED VIEW CONCURRENTLY mv_relationship_hops
# 3. REFRESH MATERIALIZED VIEW CONCURRENTLY mv_earnings_cascade
```

---

## 8\. Migration Path

### 8.1 Data Migration from SQLite

Tables to migrate (one-time, keep SQLite copies as fallback):

```shell
# Export from SQLite
sqlite3 /path/to/state-store.db <<EOF
.mode csv
.headers on
.output /tmp/companies.csv
SELECT * FROM companies;
.output /tmp/company_relationships.csv
SELECT * FROM company_relationships;
.output /tmp/catalyst_history.csv
SELECT * FROM catalyst_history;
.output /tmp/sector_momentum.csv
SELECT * FROM sector_momentum;
.output /tmp/momentum_snapshots.csv
SELECT * FROM momentum_snapshots;
EOF

# Import to Postgres
psql awb_research -c "\copy companies FROM '/tmp/companies.csv' CSV HEADER"
psql awb_research -c "\copy catalyst_history FROM '/tmp/catalyst_history.csv' CSV HEADER"
# etc.
```

### 8.2 Gateway Integration

In `gateway-v2/src/index.ts`, add alongside existing SQLite init:

```ts
import { initPgSchema, shutdownPg } from './pg-store';

// During startup (after SQLite init)
await initPgSchema();
console.log('[gateway] Postgres research schema ready');

// During shutdown
await shutdownPg();
```

### 8.3 Heartbeat Wiring

In the heartbeat action list, action 12 becomes:

```ts
// Action 12: research-agent:deep_research (enhanced)
import { runResearchCycle } from './analysts/thesis-generator';

// In heartbeat loop:
case 'research-agent:deep_research':
  await runResearchCycle();
  break;
```

---

## 9\. Dependencies

```shell
# Add to services/gateway-v2/package.json
npm install pg @types/pg pgvector
```

No other new dependencies. The spec uses:

- `pg` — Postgres client with connection pooling  
- `pgvector` — pgvector type support for Node.js  
- Everything else (brain-client, state-store, EventEmitter3) already exists

---

## 10\. Acceptance Criteria

### Phase 1: Schema & Connection

- [ ] Postgres running locally with awb\_research database  
- [ ] pgvector extension enabled  
- [ ] pg-store.ts connects and initializes all 11 tables  
- [ ] Materialized views create successfully  
- [ ] Gateway starts with both SQLite and Postgres connected  
- [ ] Existing SQLite hot-path tables untouched

### Phase 2: Knowledge Graph Population

- [ ] companies table populated with 200+ tickers from Alpaca  
- [ ] company\_relationships has 500+ edges (sector\_peer auto-generated)  
- [ ] DataCenterInfra relationships seeded (copper/uranium/natgas/rare earth complex)  
- [ ] mv\_relationship\_hops returns correct 1-hop neighbors  
- [ ] mv\_earnings\_cascade shows upcoming earnings ranked by cascade\_score

### Phase 3: Signal Pipeline

- [ ] research\_signals receives entries from existing Catalyst Hunter output  
- [ ] research\_signals receives entries from existing Momentum Scanner output  
- [ ] related\_tickers populated from company\_relationships on every signal  
- [ ] mv\_active\_signals shows decayed signals correctly  
- [ ] Signal cluster detection query returns clusters with 2+ signals

### Phase 4: Thesis Generation

- [ ] Conviction scorer produces 0-100 scores using all 7 dimensions  
- [ ] Trident Brain pattern search called during scoring (no new endpoints)  
- [ ] Theses written to research\_theses with full scoring breakdown  
- [ ] Theses above 65 conviction promoted with authority\_action \= 'act'  
- [ ] Theses stored as Trident memories for future pattern matching

### Phase 5: Feedback Loop

- [ ] thesis\_outcomes populated daily by thesis\_resolution cron  
- [ ] Trident SONA receives thesis outcomes via POST /v1/train  
- [ ] signal\_performance updated with hit rates per source\_type  
- [ ] company\_relationships strength tuned by relationship\_propagation log  
- [ ] Conviction scorer weights improve over 30-day evaluation period

### Phase 6: Nanobot Clean Reintro

- [ ] knowledge\_graph\_refresh fires nightly at 2 AM  
- [ ] research\_signal\_scan fires every 15 min during market hours  
- [ ] thesis\_resolution fires daily at 4:30 PM  
- [ ] mv\_refresh fires every 30 min  
- [ ] All tasks have canExecuteTrades: false  
- [ ] All tasks report results via openclaw\_rpc

---

## 11\. What This Does NOT Change

- **SQLite state-store.ts** — Untouched. All 14 existing tables stay.  
- **brain-client.ts** — No new endpoints. Same 11 API calls.  
- **Neural Trader** — Still the trade execution authority. Research System feeds INTO NT, never bypasses it.  
- **Authority Matrix** — Same governance. Theses promoted to Authority Matrix go through existing approval flow.  
- **Trident Brain LoRA** — Same training loop. Thesis outcomes become additional training data alongside trade outcomes.  
- **Wave 1-2 analysts** — Risk Manager, Post-Mortem, Catalyst Hunter, Macro Analyst all continue as-is. Research System consumes their output (catalyst\_history, momentum data) as signal sources.


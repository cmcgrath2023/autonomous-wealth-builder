# Trident Knowledge Graph Integration — Handoff Document

**From:** AWB (Autonomous Wealth Builder) Team
**To:** Trident / Cetacean Labs Team
**Date:** 2026-04-13
**Context:** During AWB beta testing, we built a PostgreSQL-backed knowledge graph for market research that naturally produces structured relationship data. This data would be valuable as a Trident knowledge source — enabling LoRA-trained reasoning over company relationships, supply chains, and macro-to-asset mappings that currently only exist in our local PG.

---

## 1. What We Built

AWB's Research System (shipped 2026-04-10 → 2026-04-13) includes a PostgreSQL database (`mtwm_research`) with pgvector that serves as a structured knowledge graph alongside Trident's semantic memory.

### Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│  AWB Gateway-V2                                          │
│                                                          │
│  SQLite (hot-path trading)    Postgres (knowledge graph)  │
│  ├── beliefs                  ├── companies (8,095)       │
│  ├── closed_trades            ├── company_relationships   │
│  ├── system_buys              │   (453 edges)             │
│  ├── risk_rules               ├── research_signals        │
│  └── config                   ├── research_theses         │
│                               ├── catalyst_history        │
│       ↕ sync beliefs          ├── forex_pair_drivers (29) │
│                               ├── sector_momentum         │
│  Trident Brain (HTTPS)        ├── momentum_snapshots      │
│  ├── POST /v1/memories        └── 3 materialized views    │
│  ├── GET  /v1/memories/search                             │
│  ├── POST /v1/train (SONA)                                │
│  └── shouldBuy/shouldSell                                 │
└─────────────────────────────────────────────────────────┘
```

**The gap:** Trident's LoRA can reason about trade history (via `/v1/memories/search`) but it can NOT reason about structured relationships. When AWB asks `shouldBuy('AMAT')`, Trident searches its memory for past AMAT trades — but it doesn't know that AMAT supplies TSM which fabs NVDA's GPUs, so an NVDA earnings beat is bullish for AMAT two hops downstream.

---

## 2. What We Want to Share with Trident

### 2.1 Company Relationships (structured graph data)

**Table:** `company_relationships`

```sql
-- 453 edges currently, growing nightly via knowledge_graph_refresh cron
CREATE TABLE company_relationships (
  symbol_a TEXT NOT NULL,          -- e.g. 'TSM'
  symbol_b TEXT NOT NULL,          -- e.g. 'NVDA'
  relationship TEXT NOT NULL,      -- 'supplier'|'customer'|'competitor'|'partner'|
                                   -- 'sector_peer'|'parent'|'subsidiary'|'acquisition_target'
  strength REAL NOT NULL,          -- 0.0-1.0, tuned by propagation feedback loop
  lag_days INTEGER DEFAULT 0,      -- observed signal propagation delay in days
  confidence REAL NOT NULL,        -- how certain: 1.0=SEC-confirmed, 0.3=inferred
  evidence TEXT,                   -- "TSMC fabs all NVIDIA GPUs" — human-readable
  source TEXT NOT NULL,            -- 'seed_script'|'catalyst_hunter'|'earnings_propagation'
);
```

**Example edges:**
| A | B | Relationship | Strength | Evidence |
|---|---|---|---:|---|
| TSM | NVDA | supplier | 0.9 | TSMC fabs all NVIDIA GPUs |
| ASML | TSM | supplier | 0.9 | Sole EUV lithography supplier |
| XOM | CVX | competitor | 0.9 | Top 2 US oil majors |
| BTC/USD | MARA | supplier | 0.9 | Marathon Digital BTC mining |
| FCX | NVDA | supplier | 0.6 | Copper critical for AI datacenter power |

**Proposed Trident integration:** Write each relationship as a structured Trident memory:

```ts
await brain.post('/v1/memories', {
  category: 'knowledge_graph',
  title: `RELATIONSHIP: ${symbolA} → ${symbolB} (${relationship})`,
  content: `${symbolA} is a ${relationship} of ${symbolB}. Strength: ${strength}. Evidence: ${evidence}. Lag: ${lagDays} days.`,
  tags: ['relationship', symbolA.toLowerCase(), symbolB.toLowerCase(), relationship],
  source: 'awb:knowledge_graph',
});
```

This way, when Trident's LoRA evaluates `shouldBuy('AMAT')`, it can search for relationships and find: "AMAT is a supplier of TSM (strength 0.8)" → "TSM is a supplier of NVDA (strength 0.9)" → if NVDA just beat earnings, AMAT is likely to benefit.

### 2.2 Forex Pair Drivers (macro-to-forex mapping)

**Table:** `forex_pair_drivers`

```sql
-- 29 drivers mapping macro events to currency pair impacts
CREATE TABLE forex_pair_drivers (
  pair TEXT NOT NULL,              -- 'EUR/USD', 'USD/JPY', etc.
  driver_type TEXT NOT NULL,       -- 'geopolitical'|'rate_differential'|'commodity'|'risk_sentiment'
  driver_keyword TEXT NOT NULL,    -- trigger word: 'iran', 'blockade', 'fed', 'oil'
  direction TEXT NOT NULL,         -- 'strengthens_base'|'weakens_base'|'volatile'
  strength REAL NOT NULL,          -- 0.0-1.0
  reasoning TEXT NOT NULL,         -- "Oil spike → JPY weakens (Japan imports 100% oil)"
);
```

**Example drivers:**
| Pair | Driver | Keyword | Direction | Reasoning |
|---|---|---|---|---|
| USD/JPY | geopolitical | iran | volatile | Iran tension → oil shock + safe haven flows |
| AUD/JPY | risk_sentiment | risk_off | weakens_base | Risk-off → carry unwind → AUD/JPY drops |
| EUR/USD | rate_differential | ecb | volatile | ECB rate decision directly moves EUR/USD |
| USD/CAD | commodity | oil | weakens_base | Oil spike → CAD strengthens (oil exporter) |

**Proposed Trident integration:** Same pattern — write as structured memories with the `forex_driver` tag so Trident can reason about macro-to-forex impact.

### 2.3 Relationship Propagation Observations (learning data)

**Table:** `relationship_propagation`

```sql
-- Tracks observed signal travel through the graph
-- "INTC announced earnings beat on 4/10. AMAT moved +3% on 4/12 (2-day lag)."
CREATE TABLE relationship_propagation (
  source_ticker TEXT NOT NULL,
  target_ticker TEXT NOT NULL,
  source_event TEXT NOT NULL,       -- 'earnings_beat'|'price_spike'|'news'
  source_date TIMESTAMPTZ NOT NULL,
  target_move_date TIMESTAMPTZ,
  observed_lag_days REAL,
  source_magnitude REAL,            -- % move in source
  target_magnitude REAL,            -- % move in target
);
```

**This is training data for Trident SONA.** Each observation is a `(cause, effect, lag, magnitude)` tuple that SONA can learn from. Over time, Trident learns: "When a semiconductor company beats earnings, its equipment suppliers tend to move +2-3% within 1-2 days."

---

## 3. Proposed Trident API Additions

### 3.1 Knowledge Source Endpoint (new)

Currently Trident only has `/v1/memories` (flat semantic store). We propose:

```
POST /v1/knowledge/relationships
  Body: { source: string, target: string, type: string, strength: number, evidence: string }
  Returns: { id: string }
  Purpose: Ingest structured relationship data that the LoRA can reason over

GET /v1/knowledge/neighbors?symbol=FCX&depth=2&minStrength=0.3
  Returns: Array<{ symbol: string, relationship: string, strength: number, path: string[] }>
  Purpose: Graph traversal query — "what's connected to FCX within 2 hops?"

GET /v1/knowledge/blast-radius?event=earnings_beat&symbol=INTC
  Returns: Array<{ symbol: string, expectedImpact: number, lagDays: number, confidence: number }>
  Purpose: "If INTC beats earnings, what else moves?"
```

### 3.2 SONA Training Enhancement

Current SONA training via `POST /v1/train` accepts `{ input, output }` pairs. Proposed enhancement:

```
POST /v1/train
  Body: {
    input: "relationship_propagation: INTC earnings_beat → AMAT",
    output: "positive_impact: +2.8% within 2 days",
    metadata: {
      type: 'propagation',
      source_ticker: 'INTC',
      target_ticker: 'AMAT',
      lag_days: 2,
      magnitude: 0.028,
    }
  }
```

This lets SONA learn propagation patterns as a distinct training category, separate from direct trade outcomes.

---

## 4. Sync Protocol

### 4.1 Nightly Knowledge Graph Sync (AWB → Trident)

```
Schedule: 2:30 AM ET daily (after AWB's knowledge_graph_refresh at 2:00 AM)

1. Query PG for all company_relationships WHERE last_validated > yesterday
2. For each relationship:
   a. POST /v1/memories with category='knowledge_graph' and structured tags
   b. If /v1/knowledge/relationships exists (new endpoint), use that instead
3. Query PG for all relationship_propagation WHERE recorded_at > yesterday
4. For each observation:
   a. POST /v1/train with type='propagation' metadata
5. Log sync stats: N relationships synced, M propagation observations trained
```

### 4.2 Real-Time Signal Propagation (AWB → Trident)

When the thesis generator detects a signal cluster and identifies blast radius tickers:

```ts
// After thesis generation, feed the propagation prediction to Trident
await brain.post('/v1/memories', {
  category: 'knowledge_graph',
  title: `PROPAGATION PREDICTION: ${sourceTicker} ${eventType} → ${targetTickers.join(', ')}`,
  content: `Signal on ${sourceTicker} (${eventType}). Expected impact on: ${targets.map(t => `${t.ticker} (${t.relationship}, strength ${t.strength})`).join('; ')}`,
  tags: ['propagation', 'prediction', sourceTicker.toLowerCase(), ...targetTickers.map(t => t.toLowerCase())],
  source: 'awb:thesis_generator',
});
```

### 4.3 Trident → AWB (future: backfill)

If Trident learns propagation patterns from other deployments (other AWB instances, Oceanic CRM, etc.), those patterns could be backfilled to AWB's PG:

```
GET /v1/knowledge/relationships?source=any&minConfidence=0.7
→ Write to AWB's company_relationships with source='trident_backfill'
```

This is the "shared knowledge base" value prop — each deployment contributes, all deployments benefit.

---

## 5. Data Volume Estimates

| Data Type | Current Volume | Growth Rate | Trident Memory Impact |
|---|---|---|---|
| Company relationships | 453 edges | +5-10/day (catalyst discovery) | ~500 memories (one per edge) |
| Forex pair drivers | 29 mappings | +1-2/month (manual) | ~30 memories |
| Propagation observations | 0 (new) | +10-20/day (from thesis outcomes) | ~600/month training pairs |
| Sector momentum | ~200 snapshots/day | Growing | Not synced — too noisy for Trident |
| Momentum snapshots | ~3000/day | Growing | Not synced — too large |

Total additional Trident memory: ~500-600 structured memories (one-time) + ~20/day ongoing. Well within Trident's capacity given current 460 memories.

---

## 6. What AWB Needs from Trident

1. **Confirmation that structured relationship memories are useful for LoRA reasoning.** If Trident's LoRA can actually leverage "RELATIONSHIP: TSM → NVDA (supplier, 0.9)" when evaluating shouldBuy, this integration is high-value. If the LoRA ignores structured tags and only uses semantic similarity, we'd need a different approach.

2. **The /v1/knowledge/* endpoints (or confirmation they're not needed).** If Trident's existing `/v1/memories/search` with structured tags is sufficient for graph queries, we don't need new endpoints — we just need confirmation that the tag-based filtering works reliably in search results. (Note: we discovered that tags are NOT reliably returned in search results — we had to switch to title-based parsing. This should be investigated.)

3. **SONA training categories.** Can SONA distinguish between `type='trade_outcome'` and `type='propagation'` training data? If so, the propagation observations become a distinct learning stream that improves graph-based reasoning without contaminating trade pattern learning.

4. **Backfill API.** When Trident learns patterns from other deployments, can AWB query for them? This is the multi-tenant knowledge sharing that makes the platform more valuable with each deployment.

---

## 7. Files Reference

All code is in the AWB repository (`autonomous-wealth-builder`):

| File | Purpose |
|---|---|
| `services/research-db/src/db.ts` | PG connection pool + migration runner |
| `services/research-db/src/migrations/001-005` | Schema DDL |
| `services/scripts/seed-research-db.ts` | Initial seed script (8,095 companies + 453 relationships) |
| `services/gateway-v2/src/brain-client.ts` | Current Trident API client (11 endpoints) |
| `services/gateway-v2/src/analysts/thesis-generator.ts` | Thesis pipeline (reads PG, writes Trident) |
| `services/gateway-v2/src/analysts/conviction-scorer.ts` | 7-factor scoring (queries PG + SQLite + Trident) |
| `services/gateway-v2/src/research-crons.ts` | Scheduled research tasks including proposed sync |
| `docs/initial-specs/AWB-Research-System-Spec.md` | Full Opus-authored system spec |

---

## 8. External Database as Knowledge Source

A key architectural insight from this integration: **Trident can ingest structured data from external databases as a first-class knowledge source.** AWB demonstrates this with PostgreSQL, but the pattern generalizes:

### 8.1 The Pattern

```
External DB (PostgreSQL, MongoDB, Neo4j, etc.)
  │
  │ Nightly sync / real-time webhook / GraphQL subscription
  ▼
Trident /v1/memories + /v1/train
  │
  │ Structured tags (relationship, propagation, driver)
  ▼
LoRA Reasoning (shouldBuy, shouldSell, thesis scoring)
  │
  │ Decisions informed by graph + patterns + memory
  ▼
Application Layer (trade execution, CRM actions, risk alerts)
```

### 8.2 Why This Matters

Without external DB integration, Trident's knowledge comes ONLY from:
- Application-level writes (recordTradeClose, recordBuy, etc.)
- SONA training on belief priors

With external DB integration, Trident gains:
- **Structured relationships** that the LoRA can reason over (supply chains, competitive dynamics, regulatory dependencies)
- **Graph traversal** via tagged memories (find 2-hop neighbors by searching for relationship tags)
- **Quantified propagation patterns** from observation data (SONA learns causal delays and magnitudes)
- **Domain-specific knowledge** that would be expensive to encode manually but is cheap to extract from structured data

### 8.3 GraphQL / API Feed Option

For deployments that prefer real-time over batch sync, Trident could expose (or consume) a GraphQL subscription:

```graphql
# Trident as GraphQL consumer — subscribes to external knowledge updates
subscription OnRelationshipDiscovered {
  relationshipDiscovered {
    source { symbol name sector }
    target { symbol name sector }
    type
    strength
    evidence
  }
}

# Trident as GraphQL provider — exposes knowledge graph to applications
query BlastRadius($symbol: String!, $depth: Int!) {
  blastRadius(symbol: $symbol, depth: $depth) {
    neighbor { symbol name }
    relationship
    strength
    lagDays
    path
  }
}
```

This makes the knowledge graph available as a service — any application (AWB, Oceanic CRM, Vanguard Console) can query Trident for "what's connected to X?" without maintaining its own graph.

### 8.4 Multi-Tenant Knowledge Sharing

When multiple AWB deployments run, each discovers relationships independently:
- Deployment A discovers "INTC announcement → AMAT moves in 2 days"
- Deployment B discovers "ASML supply constraint → TSM delays → NVDA shortage"
- Deployment C discovers "Fed rate hike → XLF rises but XLRE drops"

If these propagation observations are pooled in Trident (with proper tenant isolation for trade data but shared knowledge graph), ALL deployments benefit from collective discovery. This is the network effect that makes the platform more valuable with each deployment.

---

## 9. Next Steps

1. **Trident team reviews** this document and confirms/adjusts the integration approach
2. **Tag reliability fix** — search results should include tags (currently undefined)
3. **AWB implements nightly sync** once Trident confirms the memory structure works for LoRA
4. **Trident adds /v1/knowledge/* endpoints** (if needed) or confirms tag-based approach is sufficient
5. **First propagation training** — once thesis outcomes accumulate (30+ days), start feeding propagation observations to SONA

---

*This document was produced during AWB beta testing by the first beta user. The patterns discovered here — particularly the knowledge graph → Trident memory → LoRA reasoning pipeline — apply to any domain where structured relationships inform predictions (CRM sales pipeline, supply chain risk, regulatory impact analysis).*

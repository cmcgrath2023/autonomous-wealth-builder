/**
 * Conviction Scorer — from Opus's AWB Research System Spec
 *
 * Scores signal clusters into conviction-ranked research theses.
 * Queries three sources:
 *   - Postgres: company_relationships, mv_active_signals, sector_momentum,
 *               catalyst_history, signal_performance
 *   - SQLite:   beliefs (Bayesian posteriors)
 *   - Trident:  /v1/memories/search (pattern matching)
 *
 * Output: 0-100 composite conviction score with 7-factor breakdown.
 */

import { GatewayStateStore } from '../../../gateway/src/state-store.js';
import { brain } from '../brain-client.js';

// ── Types ──────────────────────────────────────────────────────────

export interface SignalCluster {
  ticker: string;
  signals: ActiveSignal[];
  relatedTickers: string[];
  sector: string;
}

export interface ActiveSignal {
  id: number;
  source_type?: string;
  signal_type: string;
  ticker: string;
  decayed_strength: number;
  detected_at?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface ConvictionResult {
  compositeScore: number;          // 0-100
  signalDensity: number;           // 0-100
  relationshipLeverage: number;    // 0-100
  temporalAlignment: number;       // 0-100
  patternMatch: number;            // 0-100
  bayesianContext: number;         // 0-100
  sectorMomentum: number;         // 0-100
  signalQuality: number;          // 0-100
}

// ── Weights (tunable via config table) ────────────────────────────

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

export async function scoreConviction(
  cluster: SignalCluster,
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  sqliteStore: GatewayStateStore,
): Promise<ConvictionResult> {

  // 1. Signal Density (0-100) — more independent sources = higher conviction
  const uniqueSources = new Set(cluster.signals.map(s => s.source_type || s.signal_type));
  const signalDensity = Math.min(100,
    (uniqueSources.size / 5) * 60 +           // diversity: 5 sources = 60 pts
    (cluster.signals.length / 8) * 40          // count: 8 signals = 40 pts
  );

  // 2. Relationship Leverage (0-100) — graph centrality
  let relationshipLeverage = 30; // default: low centrality
  try {
    const { rows: neighbors } = await pgQuery(
      `SELECT COUNT(*) AS cnt, AVG(strength) AS avg_str
       FROM mv_relationship_hops WHERE symbol = $1`,
      [cluster.ticker],
    );
    const neighborCount = parseInt(neighbors[0]?.cnt || '0');
    const avgStrength = parseFloat(neighbors[0]?.avg_str || '0.5');
    relationshipLeverage = Math.min(100,
      (neighborCount / 15) * 60 +
      avgStrength * 40
    );
  } catch { /* view may not exist yet — use default */ }

  // 3. Temporal Alignment (0-100) — signals clustering in time
  const timestamps = cluster.signals.map(s => {
    const ts = s.detected_at || s.timestamp;
    return ts ? new Date(ts).getTime() : Date.now();
  });
  const timeSpanHours = timestamps.length > 1
    ? (Math.max(...timestamps) - Math.min(...timestamps)) / 3_600_000
    : 0;
  const temporalAlignment =
    timeSpanHours < 1 ? 100 :
    timeSpanHours < 4 ? 80 :
    timeSpanHours < 24 ? 50 : 20;

  // 4. Pattern Match (0-100) — Trident Brain historical patterns
  let patternMatch = 30;
  try {
    const searchQuery = `THESIS ${cluster.ticker} ${cluster.sector} ${cluster.signals.map(s => s.signal_type).join(' ')}`;
    const results = await brain.getTickerHistory(cluster.ticker);
    const total = results.wins + results.losses;
    if (total > 0) {
      patternMatch = Math.min(100, (results.wins / total) * 100);
    }
  } catch { /* Trident unavailable */ }

  // 5. Bayesian Context (0-100) — SQLite beliefs table
  let bayesianContext = 50;
  try {
    const beliefs = sqliteStore.getBeliefsByDomain('ticker');
    const belief = beliefs.find(b => b.subject === cluster.ticker);
    if (belief && belief.observations >= 3) {
      bayesianContext = Math.min(100, belief.posterior * 100);
    }
  } catch { /* beliefs not available */ }

  // 6. Sector Momentum (0-100)
  let sectorMomentum = 50;
  try {
    const { rows: sectorRows } = await pgQuery(
      `SELECT trend, avg_change_5d FROM sector_momentum
       WHERE sector = $1 ORDER BY scanned_at DESC LIMIT 1`,
      [cluster.sector],
    );
    if (sectorRows.length > 0) {
      const trend = sectorRows[0].trend;
      const change5d = parseFloat(sectorRows[0].avg_change_5d || '0');
      sectorMomentum = trend === 'accelerating' ? Math.min(100, 60 + change5d * 5) :
                       trend === 'decelerating' ? Math.max(10, 40 + change5d * 5) : 50;
    }
  } catch { /* PG not available */ }

  // 7. Signal Quality (0-100) — historical performance of signal sources
  let signalQuality = 50;
  try {
    const sources = Array.from(uniqueSources);
    if (sources.length > 0) {
      const { rows: perfRows } = await pgQuery(
        `SELECT source_type, hit_rate FROM signal_performance
         WHERE source_type = ANY($1)`,
        [sources],
      );
      if (perfRows.length > 0) {
        signalQuality = Math.min(100,
          (perfRows.reduce((sum: number, r: any) => sum + parseFloat(r.hit_rate || '0'), 0) / perfRows.length) * 100,
        );
      }
    }
  } catch { /* PG not available */ }

  // Composite
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

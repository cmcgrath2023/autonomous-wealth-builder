/**
 * Thesis Generator — from Opus's AWB Research System Spec
 *
 * Pipeline: detect signal clusters → score conviction → synthesize thesis
 * with Trident context → store in Postgres → promote if above threshold.
 *
 * Called from the research heartbeat cycle (Nanobot signal_scan cron)
 * or directly from the orchestrator.
 */

import { brain } from '../brain-client.js';
import { scoreConviction } from './conviction-scorer.js';
import type { SignalCluster, ConvictionResult } from './conviction-scorer.js';

const CLUSTER_WINDOW_HOURS = 4;
const MIN_CLUSTER_SIZE = 2;

// Asset-class-specific thresholds (per Opus crypto re-enablement spec)
const THRESHOLDS = {
  equity: { act: 65, suggest: 50, observe: 0 },
  crypto: { act: 70, suggest: 60, observe: 0 },  // higher bar — thesis-driven only
  forex:  { act: 65, suggest: 50, observe: 0 },
};
const CRYPTO_MIN_SOURCES = 3; // crypto requires 3+ independent signal sources

function isCryptoTicker(ticker: string): boolean {
  return ticker.includes('/USD') || ticker.endsWith('USD') && ticker.length > 5;
}

function getAssetClass(ticker: string): 'equity' | 'crypto' | 'forex' {
  if (ticker.includes('/') && !isCryptoTicker(ticker)) return 'forex';
  if (isCryptoTicker(ticker)) return 'crypto';
  return 'equity';
}

// ── Cluster Detection ──────────────────────────────────────────────

export async function detectSignalClusters(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
): Promise<SignalCluster[]> {
  // Find tickers with multiple active signals in the window
  let rows: any[];
  try {
    const result = await pgQuery(`
      SELECT
        ticker,
        COUNT(*) AS signal_count,
        array_agg(DISTINCT source_type) AS sources,
        AVG(decayed_strength) AS avg_strength,
        (SELECT sector FROM companies WHERE symbol = s.ticker LIMIT 1) AS sector
      FROM mv_active_signals s
      WHERE detected_at > NOW() - INTERVAL '${CLUSTER_WINDOW_HOURS} hours'
      GROUP BY ticker
      HAVING COUNT(*) >= ${MIN_CLUSTER_SIZE}
      ORDER BY AVG(decayed_strength) DESC
      LIMIT 10
    `);
    rows = result.rows;
  } catch (e: any) {
    console.log(`[thesis] Cluster detection failed: ${e.message}`);
    return [];
  }

  const clusters: SignalCluster[] = [];

  for (const row of rows) {
    // Get the actual signals
    const { rows: signals } = await pgQuery(`
      SELECT * FROM mv_active_signals
      WHERE ticker = $1
        AND detected_at > NOW() - INTERVAL '${CLUSTER_WINDOW_HOURS} hours'
      ORDER BY decayed_strength DESC
    `, [row.ticker]);

    // Get related tickers from knowledge graph
    let relatedTickers: string[] = [];
    try {
      const { rows: related } = await pgQuery(`
        SELECT DISTINCT neighbor FROM mv_relationship_hops
        WHERE symbol = $1
        ORDER BY strength DESC
        LIMIT 15
      `, [row.ticker]);
      relatedTickers = related.map((r: any) => r.neighbor);
    } catch { /* view might be empty */ }

    clusters.push({
      ticker: row.ticker,
      signals,
      relatedTickers,
      sector: row.sector || '',
    });
  }

  return clusters;
}

// ── Thesis Synthesis ───────────────────────────────────────────────

export async function generateThesis(
  cluster: SignalCluster,
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  sqliteStore: any,
): Promise<number | null> {
  // 1. Score conviction
  const conviction = await scoreConviction(cluster, pgQuery, sqliteStore);

  const assetClass = getAssetClass(cluster.ticker);
  const thresholds = THRESHOLDS[assetClass];

  // Skip low-conviction clusters
  if (conviction.compositeScore < 30) {
    console.log(`[thesis] ${cluster.ticker}: conviction ${conviction.compositeScore} < 30 — skipped`);
    return null;
  }

  // Crypto-specific: require 3+ independent signal sources
  if (assetClass === 'crypto') {
    const uniqueSources = new Set(cluster.signals.map(s => s.source_type || s.signal_type));
    if (uniqueSources.size < CRYPTO_MIN_SOURCES) {
      console.log(`[thesis] Crypto ${cluster.ticker} rejected: ${uniqueSources.size} sources (need ${CRYPTO_MIN_SOURCES}+)`);
      return null;
    }
  }

  // 2. Get Trident Brain context
  let tridentContext = '';
  let bearCase = 'No historical bear case data available';
  let tridentMemoryId: string | null = null;

  try {
    const history = await brain.getTickerHistory(cluster.ticker);
    if (history.wins + history.losses > 0) {
      tridentContext = `Trident history: ${history.wins}W/${history.losses}L, avg return ${(history.avgReturn * 100).toFixed(1)}%${history.shouldAvoid ? ' — AVOID FLAG' : ''}`;
    }
  } catch { /* Trident unavailable */ }

  // 3. Build thesis narrative
  const signalSummary = cluster.signals
    .map(s => `${s.source_type || s.signal_type}(${(s.decayed_strength * 100).toFixed(0)}%)`)
    .join(', ');

  const narrative = [
    `Signal cluster on ${cluster.ticker} (${cluster.sector}).`,
    `${cluster.signals.length} signals from ${new Set(cluster.signals.map(s => s.source_type || s.signal_type)).size} sources: ${signalSummary}.`,
    cluster.relatedTickers.length > 0 ? `Graph neighbors: ${cluster.relatedTickers.slice(0, 8).join(', ')}.` : '',
    tridentContext || '',
  ].filter(Boolean).join(' ');

  const title = `${cluster.ticker}: ${cluster.signals[0]?.signal_type || 'multi-signal'} cluster (conviction ${conviction.compositeScore})`;

  // 4. Authority action (asset-class aware)
  let authorityAction: string;
  if (assetClass === 'crypto') {
    // Crypto uses phased re-enablement: disabled → observe → suggest → act
    // Read from SQLite config; default to 'observe' per spec
    const cryptoPhase = sqliteStore.get?.('crypto_trading_phase') || 'observe';
    if (cryptoPhase === 'disabled' || cryptoPhase === 'observe') {
      authorityAction = 'observe'; // always observe regardless of score
    } else if (cryptoPhase === 'suggest' && conviction.compositeScore >= thresholds.act) {
      authorityAction = 'suggest'; // surface for manual approval
    } else if (cryptoPhase === 'act' && conviction.compositeScore >= thresholds.act) {
      authorityAction = 'act'; // auto-execute
    } else {
      authorityAction = 'observe';
    }
  } else {
    authorityAction =
      conviction.compositeScore >= thresholds.act ? 'act' :
      conviction.compositeScore >= thresholds.suggest ? 'suggest' :
      'observe';
  }

  // 5. Route to service
  const routedTo = determineRouting(cluster);

  // 6. Store thesis as Trident memory
  try {
    await brain.recordRule(
      `THESIS: ${title} — ${narrative.slice(0, 500)}\nConviction: ${conviction.compositeScore}/100\nBear case: ${bearCase}`,
      'thesis',
    );
  } catch { /* best-effort */ }

  // 7. Write to Postgres
  try {
    const { rows: inserted } = await pgQuery(`
      INSERT INTO research_theses (
        title, narrative, primary_ticker, related_tickers,
        catalyst_type, bear_case, invalidation,
        signal_ids, trident_memory_id, conviction_score,
        signal_density_score, relationship_leverage_score,
        temporal_alignment_score, pattern_match_score,
        bayesian_context_score, sector_momentum_score,
        status, routed_to, authority_action, sector, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW()
      ) RETURNING id
    `, [
      title,
      narrative,
      cluster.ticker,
      cluster.relatedTickers,
      cluster.signals[0]?.signal_type || 'unknown',
      bearCase,
      '',
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
      cluster.sector,
    ]);

    const thesisId = inserted[0]?.id;
    console.log(`[thesis] ${title} → conviction=${conviction.compositeScore}, action=${authorityAction}, routed=${routedTo}`);
    return thesisId;
  } catch (e: any) {
    console.error(`[thesis] PG write failed: ${e.message}`);
    return null;
  }
}

// ── Service Routing ────────────────────────────────────────────────

function determineRouting(cluster: SignalCluster): string {
  const ticker = cluster.ticker;

  const commodityTickers = ['LE','HE','GF','ZC','ZS','ZW','CL','NG','HG','GC','SI','KC','SB'];
  if (commodityTickers.includes(ticker)) return 'CommoditiesTrader';

  const infraTickers = ['FCX','SCCO','COPX','CCJ','CEG','TLN','D','URA','MP','REMX','ALB','LNG','EQT','VST','NEE'];
  if (infraTickers.includes(ticker)) return 'DataCenterInfra';

  const reitTickers = ['EQIX','DLR','PLD','STAG','AVB','EQR','WELL','VTR'];
  if (reitTickers.includes(ticker)) return 'REITTrader';

  if (ticker.includes('/') || ['EURUSD','GBPUSD','USDJPY','AUDJPY','NZDJPY'].includes(ticker)) {
    return 'ForexScanner';
  }

  return 'NeuralTrader';
}

// ── Main Research Cycle ────────────────────────────────────────────

export async function runResearchCycle(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  sqliteStore: any,
): Promise<void> {
  console.log('[research] Starting research cycle...');

  // 1. Refresh materialized views
  try {
    await pgQuery('REFRESH MATERIALIZED VIEW mv_active_signals');
    await pgQuery('REFRESH MATERIALIZED VIEW mv_relationship_hops');
  } catch (e: any) {
    console.log(`[research] View refresh failed: ${e.message} — continuing`);
  }

  // 2. Detect signal clusters
  const clusters = await detectSignalClusters(pgQuery);
  console.log(`[research] Found ${clusters.length} signal clusters`);

  // 3. Generate theses
  let generated = 0;
  for (const cluster of clusters) {
    try {
      const id = await generateThesis(cluster, pgQuery, sqliteStore);
      if (id) generated++;
    } catch (e: any) {
      console.error(`[research] Thesis failed for ${cluster.ticker}: ${e.message}`);
    }
  }

  // 4. Expire old theses
  try {
    await pgQuery(`
      UPDATE research_theses
      SET status = 'expired', resolved_at = NOW()
      WHERE status = 'active'
        AND created_at < NOW() - INTERVAL '7 days'
    `);
  } catch {}

  console.log(`[research] Cycle complete: ${clusters.length} clusters → ${generated} theses`);
}

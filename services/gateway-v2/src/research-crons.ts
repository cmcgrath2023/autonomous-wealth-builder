/**
 * Research Crons — Clean Nanobot Reintroduction
 *
 * These are the scheduled research tasks that replace the old Nanobot
 * scheduler. Each follows the NanobotTaskConfig pattern but runs as
 * simple cron-scheduled functions rather than spawned sub-processes.
 *
 * Crons:
 *   1. knowledge_graph_refresh  — 2:00 AM daily
 *   2. signal_scan              — every 15 min during market hours
 *   3. thesis_resolution        — 4:30 PM daily
 *   4. mv_refresh               — every 30 min
 *
 * All crons have canExecuteTrades: false. They populate the research
 * database; the trade-engine reads from it.
 */

import type { GatewayStateStore } from '../../gateway/src/state-store.js';

// ── Types ──────────────────────────────────────────────────────────

interface CronConfig {
  name: string;
  description: string;
  handler: () => Promise<void>;
  schedule: Array<{ hour: number; minute: number; label: string }>;
  weekdaysOnly: boolean;
}

// ── Cron Runner ────────────────────────────────────────────────────

function msUntilETWeekday(hour: number, minute: number): { ms: number; target: Date } {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const target = new Date(et);
  target.setHours(hour, minute, 0, 0);
  if (target <= et) target.setDate(target.getDate() + 1);
  while (target.getDay() === 0 || target.getDay() === 6) {
    target.setDate(target.getDate() + 1);
  }
  return { ms: target.getTime() - et.getTime(), target };
}

function msUntilNextSlot(hour: number, minute: number): { ms: number; target: Date } {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const target = new Date(et);
  target.setHours(hour, minute, 0, 0);
  if (target <= et) target.setDate(target.getDate() + 1);
  return { ms: target.getTime() - et.getTime(), target };
}

function scheduleRecurring(
  name: string,
  hour: number,
  minute: number,
  label: string,
  weekdaysOnly: boolean,
  handler: () => Promise<void>,
  log: (msg: string) => void,
): void {
  const fn = weekdaysOnly ? msUntilETWeekday : msUntilNextSlot;
  const schedule = () => {
    const { ms, target } = fn(hour, minute);
    log(`[cron] ${name} (${label}) → ${target.toISOString()} (${Math.round(ms / 60_000)} min)`);
    setTimeout(async () => {
      try {
        log(`[cron] ${name} (${label}) starting`);
        const t0 = Date.now();
        await handler();
        log(`[cron] ${name} (${label}) done (${Date.now() - t0}ms)`);
      } catch (e: any) {
        log(`[cron] ${name} (${label}) FAILED: ${e.message}`);
      }
      schedule(); // reschedule
    }, ms);
  };
  schedule();
}

// ── Cron Implementations ───────────────────────────────────────────

async function knowledgeGraphRefresh(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  alpacaHeaders: Record<string, string>,
): Promise<void> {
  console.log('[knowledge-graph] Starting nightly refresh...');

  // 1. Populate companies from Alpaca assets endpoint
  try {
    const res = await fetch('https://paper-api.alpaca.markets/v2/assets?status=active&exchange=NASDAQ', {
      headers: alpacaHeaders,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const assets = await res.json() as any[];
      let inserted = 0;
      for (const a of assets.filter((x: any) => x.tradable && x.fractionable !== false)) {
        try {
          await pgQuery(`
            INSERT INTO companies (symbol, name, sector, exchange, updated_at)
            VALUES ($1, $2, '', $3, NOW())
            ON CONFLICT (symbol) DO UPDATE SET
              name = EXCLUDED.name,
              exchange = EXCLUDED.exchange,
              updated_at = NOW()
          `, [a.symbol, a.name || '', a.exchange || '']);
          inserted++;
        } catch {}
      }
      console.log(`[knowledge-graph] Inserted/updated ${inserted} companies from Alpaca NASDAQ`);
    }
  } catch (e: any) {
    console.log(`[knowledge-graph] Alpaca assets fetch failed: ${e.message}`);
  }

  // Also fetch NYSE
  try {
    const res = await fetch('https://paper-api.alpaca.markets/v2/assets?status=active&exchange=NYSE', {
      headers: alpacaHeaders,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const assets = await res.json() as any[];
      let inserted = 0;
      for (const a of assets.filter((x: any) => x.tradable)) {
        try {
          await pgQuery(`
            INSERT INTO companies (symbol, name, sector, exchange, updated_at)
            VALUES ($1, $2, '', $3, NOW())
            ON CONFLICT (symbol) DO UPDATE SET
              name = EXCLUDED.name,
              exchange = EXCLUDED.exchange,
              updated_at = NOW()
          `, [a.symbol, a.name || '', a.exchange || '']);
          inserted++;
        } catch {}
      }
      console.log(`[knowledge-graph] Inserted/updated ${inserted} companies from Alpaca NYSE`);
    }
  } catch (e: any) {
    console.log(`[knowledge-graph] NYSE fetch failed: ${e.message}`);
  }

  // 2. Refresh all materialized views
  for (const view of ['mv_active_signals', 'mv_relationship_hops', 'mv_earnings_cascade']) {
    try {
      await pgQuery(`REFRESH MATERIALIZED VIEW ${view}`);
      console.log(`[knowledge-graph] Refreshed ${view}`);
    } catch (e: any) {
      console.log(`[knowledge-graph] ${view} refresh failed: ${e.message}`);
    }
  }

  console.log('[knowledge-graph] Nightly refresh complete');
}

async function signalScan(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  sqliteStore: GatewayStateStore,
): Promise<void> {
  console.log('[signal-scan] Starting 15-min scan...');

  // 1. Read latest catalyst_history entries (from Catalyst Hunter)
  const catalysts = sqliteStore.getClosedTrades?.(0) || []; // placeholder
  // Actually read from PG catalyst_history for recent entries
  try {
    const { rows: recentCatalysts } = await pgQuery(`
      SELECT symbol, catalyst_type, headline, detected_at, price_at_detection
      FROM catalyst_history
      WHERE detected_at > NOW() - INTERVAL '4 hours'
        AND outcome = 'pending'
      ORDER BY detected_at DESC
      LIMIT 20
    `);

    // 2. For each catalyst, check company_relationships for blast radius
    for (const cat of recentCatalysts) {
      try {
        const { rows: neighbors } = await pgQuery(`
          SELECT neighbor, relationship, strength
          FROM mv_relationship_hops
          WHERE symbol = $1 AND strength >= 0.3
          ORDER BY strength DESC
          LIMIT 10
        `, [cat.symbol]);

        // Write related_tickers as additional signals
        const relatedTickers = neighbors.map((n: any) => n.neighbor);
        if (relatedTickers.length > 0) {
          await pgQuery(`
            INSERT INTO research_signals (
              ticker, sector, signal_type, confidence, decay_hours,
              related_tickers, metadata, created_by, detected_at
            ) VALUES ($1, '', $2, $3, 24, $4, $5, 'signal_scan', NOW())
          `, [
            cat.symbol,
            `propagation_${cat.catalyst_type}`,
            0.6,
            relatedTickers,
            JSON.stringify({ source_catalyst: cat.headline, neighbors: relatedTickers }),
          ]);
        }
      } catch {}
    }
    console.log(`[signal-scan] Processed ${recentCatalysts.length} recent catalysts`);
  } catch (e: any) {
    console.log(`[signal-scan] Catalyst scan failed: ${e.message}`);
  }

  // 3. Run the research cycle (cluster detection → thesis generation)
  try {
    const { runResearchCycle } = await import('./analysts/index.js');
    await runResearchCycle(
      (text: string, params?: unknown[]) => pgQuery(text, params),
      sqliteStore,
    );
  } catch (e: any) {
    console.log(`[signal-scan] Research cycle failed: ${e.message}`);
  }

  console.log('[signal-scan] 15-min scan complete');
}

async function thesisResolution(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  alpacaHeaders: Record<string, string>,
): Promise<void> {
  console.log('[thesis-resolution] Starting daily resolution...');

  // 1. Get all active/promoted theses
  const { rows: theses } = await pgQuery(`
    SELECT id, primary_ticker, conviction_score, created_at, status
    FROM research_theses
    WHERE status IN ('active', 'promoted')
    ORDER BY conviction_score DESC
  `);

  if (theses.length === 0) {
    console.log('[thesis-resolution] No active theses to resolve');
    return;
  }

  // 2. Get current prices for all thesis tickers
  const tickers = [...new Set(theses.map((t: any) => t.primary_ticker))];
  const syms = tickers.slice(0, 50).join(',');
  let snapData: any = {};
  try {
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${syms}&feed=sip`,
      { headers: alpacaHeaders, signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) snapData = await res.json();
  } catch {}

  // 3. Check each thesis — has the catalyst window passed?
  let resolved = 0;
  for (const thesis of theses) {
    const ageHours = (Date.now() - new Date(thesis.created_at).getTime()) / 3_600_000;

    // Auto-expire after 7 days
    if (ageHours > 168) {
      await pgQuery(`
        UPDATE research_theses SET status = 'expired', resolved_at = NOW()
        WHERE id = $1
      `, [thesis.id]);
      resolved++;
      continue;
    }

    // Get current price for outcome tracking
    const snap = snapData[thesis.primary_ticker];
    if (!snap) continue;
    const currentPrice = snap.latestTrade?.p;
    if (!currentPrice) continue;

    // Log to thesis_outcomes if we have entry data
    // (This would be richer with actual trade data from closed_trades)
  }

  // 4. Update signal_performance hit rates
  try {
    await pgQuery(`
      INSERT INTO signal_performance (source_type, sector, total_signals, signals_in_winning_theses, hit_rate, updated_at)
      SELECT
        rs.signal_type,
        'all',
        COUNT(*),
        COUNT(*) FILTER (WHERE rt.status = 'promoted' AND rt.conviction_score >= 65),
        CASE WHEN COUNT(*) > 0
          THEN COUNT(*) FILTER (WHERE rt.status = 'promoted' AND rt.conviction_score >= 65)::REAL / COUNT(*)
          ELSE 0
        END,
        NOW()
      FROM research_signals rs
      LEFT JOIN research_theses rt ON rs.id = ANY(rt.signal_ids)
      WHERE rs.detected_at > NOW() - INTERVAL '30 days'
      GROUP BY rs.signal_type
      ON CONFLICT (source_type, sector) DO UPDATE SET
        total_signals = EXCLUDED.total_signals,
        signals_in_winning_theses = EXCLUDED.signals_in_winning_theses,
        hit_rate = EXCLUDED.hit_rate,
        updated_at = NOW()
    `);
  } catch (e: any) {
    console.log(`[thesis-resolution] Signal perf update failed: ${e.message}`);
  }

  // 5. Refresh materialized views
  try {
    await pgQuery('REFRESH MATERIALIZED VIEW mv_earnings_cascade');
  } catch {}

  console.log(`[thesis-resolution] Resolved ${resolved} of ${theses.length} theses`);
}

async function mvRefresh(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
): Promise<void> {
  for (const view of ['mv_active_signals', 'mv_relationship_hops']) {
    try {
      await pgQuery(`REFRESH MATERIALIZED VIEW ${view}`);
    } catch {}
  }
  console.log('[mv-refresh] Views refreshed');
}

// ── Public API ─────────────────────────────────────────────────────

export function startResearchCrons(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  sqliteStore: GatewayStateStore,
  alpacaHeaders: Record<string, string>,
  log: (msg: string) => void,
): void {
  log('[research-crons] Scheduling research tasks...');

  // 1. Knowledge Graph Refresh — 2:00 AM daily
  scheduleRecurring(
    'knowledge_graph_refresh', 2, 0, 'nightly',
    true, // weekdays only
    () => knowledgeGraphRefresh(pgQuery, alpacaHeaders),
    log,
  );

  // 2. Signal Scan — every 15 min during market hours (9:30-16:00 ET)
  for (const min of [0, 15, 30, 45]) {
    for (let hour = 9; hour <= 15; hour++) {
      if (hour === 9 && min < 30) continue; // skip before 9:30
      scheduleRecurring(
        'signal_scan', hour, min, `${hour}:${String(min).padStart(2, '0')}`,
        true,
        () => signalScan(pgQuery, sqliteStore),
        log,
      );
    }
  }

  // 3. Thesis Resolution — 4:30 PM daily
  scheduleRecurring(
    'thesis_resolution', 16, 30, 'daily',
    true,
    () => thesisResolution(pgQuery, alpacaHeaders),
    log,
  );

  // 4. MV Refresh — every 30 min, 24/7 (not just weekdays — views should stay fresh)
  for (const min of [0, 30]) {
    for (let hour = 0; hour < 24; hour++) {
      scheduleRecurring(
        'mv_refresh', hour, min, `${hour}:${String(min).padStart(2, '0')}`,
        false, // runs every day
        () => mvRefresh(pgQuery),
        log,
      );
    }
  }

  log('[research-crons] All research tasks scheduled');
}

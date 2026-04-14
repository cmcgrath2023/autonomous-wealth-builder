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

  // BRIDGE: Write Catalyst Hunter + Research Worker stars FROM SQLite TO PG research_signals.
  // This connects the Wave 1-2 analysts to the Wave 4 research pipeline.
  try {
    const stars = sqliteStore.getResearchStars();
    let bridged = 0;
    for (const star of stars) {
      if (!star.symbol || !star.catalyst) continue;
      // Determine signal type from catalyst string
      const catalystLower = (star.catalyst || '').toLowerCase();
      // Must match research_signals_signal_type_check constraint
      const signalType = catalystLower.includes('earnings') ? 'earnings_beat' :
        catalystLower.includes('fda') ? 'fda_approval' :
        catalystLower.includes('upgrade') ? 'upgrade' :
        catalystLower.includes('downgrade') ? 'downgrade' :
        catalystLower.includes('guidance') ? 'guidance_raise' :
        catalystLower.includes('partnership') || catalystLower.includes('deal') ? 'partnership' :
        catalystLower.includes('momentum') || catalystLower.includes('mover') || catalystLower.includes('top mover') ? 'momentum_breakout' :
        catalystLower.includes('geopolitical') || catalystLower.includes('iran') || catalystLower.includes('blockade') ? 'geopolitical' :
        catalystLower.includes('macro') || catalystLower.includes('oil') ? 'macro_shift' :
        catalystLower.includes('short') ? 'short_squeeze' :
        catalystLower.includes('contract') ? 'contract_win' :
        catalystLower.includes('insider') ? 'insider_buy' :
        catalystLower.includes('sector') ? 'sector_rotation' :
        catalystLower.includes('volume') ? 'volume_surge' :
        'technical_breakout'; // default fallback — must be a valid CHECK value
      try {
        await pgQuery(`
          INSERT INTO research_signals (symbol, sector, signal_type, headline, confidence, decay_hours,
            metadata, created_by, detected_at)
          VALUES ($1, $2, $3, $4, $5, 24, $6, 'bridge_from_sqlite', NOW())
        `, [
          star.symbol,
          star.sector || '',
          signalType,
          (star.catalyst || '').slice(0, 200),
          Math.min(0.9, star.score),
          JSON.stringify({ source: 'research_stars_bridge' }),
        ]);
        bridged++;
      } catch {}
    }
    if (bridged > 0) console.log(`[signal-scan] Bridged ${bridged} research stars → PG research_signals`);
  } catch (e: any) {
    console.log(`[signal-scan] Bridge failed: ${e.message}`);
  }

  // 1. Read latest catalyst entries (now populated by the bridge above + catalyst_history)
  try {
    const { rows: recentCatalysts } = await pgQuery(`
      SELECT ticker AS symbol, signal_type AS catalyst_type,
             metadata->>'catalyst' AS headline, detected_at, confidence AS price_at_detection
      FROM research_signals
      WHERE detected_at > NOW() - INTERVAL '4 hours'
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

// ── Crypto Signal Scan (24/7) ──────────────────────────────────────

const CRYPTO_UNIVERSE = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'LINK/USD', 'DOT/USD', 'DOGE/USD'];

async function scanCryptoSignals(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  alpacaHeaders: Record<string, string>,
): Promise<void> {
  console.log('[crypto-scan] Starting 4-hourly crypto scan...');

  // 1. Volume spike detection — 24h volume vs moving average
  for (const pair of CRYPTO_UNIVERSE) {
    const alpacaPair = pair.replace('/', '');
    try {
      const url = `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${encodeURIComponent(pair)}`;
      const res = await fetch(url, { headers: alpacaHeaders, signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json() as any;
      const snap = data.snapshots?.[pair] || data[pair];
      if (!snap) continue;

      const price = snap.latestTrade?.p || 0;
      const dailyVol = snap.dailyBar?.v || 0;
      const prevVol = snap.prevDailyBar?.v || 1;
      const relVolume = prevVol > 0 ? dailyVol / prevVol : 1;

      // Volume spike signal (>3x average)
      if (relVolume > 3) {
        try {
          await pgQuery(`
            INSERT INTO research_signals (symbol, sector, signal_type, headline, confidence, decay_hours,
              metadata, created_by, detected_at)
            VALUES ($1, 'crypto', 'volume_surge', $2, 12, $3, 'crypto_scan', NOW())
          `, [
            pair,
            Math.min(0.9, 0.5 + (relVolume - 3) * 0.1),
            JSON.stringify({ rel_volume: relVolume, daily_vol: dailyVol, price }),
          ]);
          console.log(`[crypto-scan] ${pair} volume surge: ${relVolume.toFixed(1)}x average`);
        } catch {}
      }

      // Price momentum signal (>5% daily move)
      const dailyChange = snap.dailyBar?.c && snap.prevDailyBar?.c
        ? ((snap.dailyBar.c - snap.prevDailyBar.c) / snap.prevDailyBar.c) * 100
        : 0;
      if (Math.abs(dailyChange) > 5) {
        try {
          await pgQuery(`
            INSERT INTO research_signals (symbol, sector, signal_type, headline, confidence, decay_hours,
              metadata, created_by, detected_at)
            VALUES ($1, 'crypto', 'momentum_breakout', $2, 24, $3, 'crypto_scan', NOW())
          `, [
            pair,
            Math.min(0.85, 0.5 + Math.abs(dailyChange) / 50),
            JSON.stringify({ daily_change_pct: dailyChange, price }),
          ]);
          console.log(`[crypto-scan] ${pair} momentum: ${dailyChange.toFixed(1)}% daily`);
        } catch {}
      }
    } catch {}
  }

  // 2. BTC/SPY correlation check (crypto decoupling signal)
  try {
    // Simple: compare BTC daily % vs SPY daily %
    const btcSnap = await fetch(`https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=BTC/USD`, {
      headers: alpacaHeaders, signal: AbortSignal.timeout(5000),
    });
    const spySnap = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=SPY&feed=sip`, {
      headers: alpacaHeaders, signal: AbortSignal.timeout(5000),
    });
    if (btcSnap.ok && spySnap.ok) {
      const btcData = await btcSnap.json() as any;
      const spyData = await spySnap.json() as any;
      const btc = btcData.snapshots?.['BTC/USD'] || btcData['BTC/USD'];
      const spy = spyData['SPY'];
      if (btc?.dailyBar?.c && btc?.prevDailyBar?.c && spy?.latestTrade?.p && spy?.prevDailyBar?.c) {
        const btcPct = ((btc.dailyBar.c - btc.prevDailyBar.c) / btc.prevDailyBar.c) * 100;
        const spyPct = ((spy.latestTrade.p - spy.prevDailyBar.c) / spy.prevDailyBar.c) * 100;
        // Decoupling: BTC and SPY moving in opposite directions by >2% each
        if (Math.sign(btcPct) !== Math.sign(spyPct) && Math.abs(btcPct) > 2 && Math.abs(spyPct) > 1) {
          await pgQuery(`
            INSERT INTO research_signals (symbol, sector, signal_type, headline, confidence, decay_hours,
              metadata, created_by, detected_at)
            VALUES ('BTC/USD', 'crypto', 'correlation_break', 0.7, 48, $1, 'crypto_scan', NOW())
          `, [JSON.stringify({ btc_pct: btcPct, spy_pct: spyPct, decoupled: true })]);
          console.log(`[crypto-scan] BTC/SPY decoupling: BTC ${btcPct.toFixed(1)}% vs SPY ${spyPct.toFixed(1)}%`);
        }
      }
    }
  } catch {}

  console.log('[crypto-scan] Scan complete');
}

// ── Overnight Catalyst Scan (forex-aware) ──────────────────────────

async function runOvernightCatalystScan(
  pgQuery: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  sqliteStore: GatewayStateStore,
  alpacaHeaders: Record<string, string>,
  session: 'asia' | 'europe' | 'premarket',
): Promise<void> {
  console.log(`[overnight-catalyst] Starting ${session} scan...`);

  // 1. Run the catalyst hunter
  try {
    const { CatalystHunter } = await import('./analysts/index.js');
    const hunter = new CatalystHunter(sqliteStore);
    const result = await hunter.scan(alpacaHeaders);
    console.log(`[overnight-catalyst] ${session}: ${result.candidates.length} catalysts found`);

    // 2. For each catalyst, check forex_pair_drivers for affected currency pairs
    for (const c of result.candidates) {
      const headline = (c.catalyst + ' ' + c.catalystType).toLowerCase();

      try {
        const { rows: drivers } = await pgQuery(`
          SELECT pair, direction, strength, reasoning
          FROM forex_pair_drivers
          WHERE $1 LIKE '%' || driver_keyword || '%'
          ORDER BY strength DESC
        `, [headline]);

        if (drivers.length > 0) {
          const forexPairs = drivers.map((d: any) => d.pair);
          console.log(`[overnight-catalyst] ${c.symbol} → forex impact: ${forexPairs.join(', ')}`);

          // Write a forex-tagged research signal to PG
          try {
            await pgQuery(`
              INSERT INTO research_signals (
                ticker, sector, signal_type, confidence, decay_hours,
                related_tickers, metadata, created_by, detected_at
              ) VALUES ($1, 'Forex', $2, $3, 24, $4, $5, 'overnight_catalyst', NOW())
            `, [
              c.symbol,
              `forex_${c.catalystType}`,
              c.confidence,
              forexPairs,
              JSON.stringify({
                session,
                headline: c.catalyst,
                forex_drivers: drivers.map((d: any) => ({
                  pair: d.pair,
                  direction: d.direction,
                  strength: d.strength,
                  reasoning: d.reasoning,
                })),
              }),
            ]);
          } catch {}
        }
      } catch {}
    }
  } catch (e: any) {
    console.log(`[overnight-catalyst] ${session} scan failed: ${e.message}`);
  }

  // 3. Also run signal scan to process any new clusters
  try {
    await signalScan(pgQuery, sqliteStore);
  } catch {}

  console.log(`[overnight-catalyst] ${session} scan complete`);
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

  // 4b. Overnight catalyst scans — catch Asia open, EU open, pre-market
  // These tag forex-relevant catalysts with affected currency pairs
  scheduleRecurring('catalyst_overnight', 22, 0, 'asia-open', true,
    () => runOvernightCatalystScan(pgQuery, sqliteStore, alpacaHeaders, 'asia'),
    log);
  scheduleRecurring('catalyst_overnight', 4, 0, 'eu-open', true,
    () => runOvernightCatalystScan(pgQuery, sqliteStore, alpacaHeaders, 'europe'),
    log);
  scheduleRecurring('catalyst_overnight', 6, 0, 'pre-market', true,
    () => runOvernightCatalystScan(pgQuery, sqliteStore, alpacaHeaders, 'premarket'),
    log);

  // 4c. Crypto signal scan — every 4 hours, 24/7 (crypto never closes)
  for (const hour of [0, 4, 8, 12, 16, 20]) {
    scheduleRecurring('crypto_signal_scan', hour, 0, `${hour}:00`,
      false, // runs every day including weekends
      () => scanCryptoSignals(pgQuery, alpacaHeaders),
      log);
  }

  // Set crypto phase to observe if not already set
  try {
    if (!sqliteStore.get('crypto_trading_phase')) {
      sqliteStore.set('crypto_trading_phase', 'observe');
      log('[research-crons] Crypto trading phase initialized: observe');
    }
  } catch {}

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

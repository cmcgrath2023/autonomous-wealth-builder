/**
 * Gateway V2 — Single-Process Orchestrator (ADR-028)
 *
 * Main entry point. Runs trade engine, research worker, API server,
 * analysts, and monitoring ALL in-process. No child processes, no IPC.
 * Simpler, Docker-friendly, no fork overhead.
 */

import { resolve, dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { config } from 'dotenv';

// Load env from gateway/.env.local (same file the old gateway used — has Discord tokens etc.)
const envLocal = resolve(dirname(new URL(import.meta.url).pathname), '../../gateway/.env.local');
if (existsSync(envLocal)) config({ path: envLocal, override: true });
// Also load services/.env.webhook if present
const envWebhook = resolve(dirname(new URL(import.meta.url).pathname), '../../.env.webhook');
if (existsSync(envWebhook)) config({ path: envWebhook });

import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { start as startApiServer } from './api-server.js';
import { CommsWorker } from './comms-worker.js';
import { OpenClawEngine } from './openclaw.js';
import { loadCredentials, getAlpacaHeaders } from './config-bus.js';
import { BayesianIntelligence } from '../../shared/intelligence/bayesian-intelligence.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { brain } from './brain-client.js';

const DB_PATH = join(process.cwd(), 'data', 'gateway-state.db');
const LOCK_PATH = process.env.AWB_GATEWAY_LOCK_PATH || join(process.cwd(), 'data', 'awb-gateway.lock');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[orchestrator] ${new Date().toISOString()} ${msg}`);
}

// ---------------------------------------------------------------------------
// Singleton lock (prevents two AWB instances)
// ---------------------------------------------------------------------------

let lockAcquired = false;
let shuttingDown = false;

function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireSingletonLock(): void {
  const lockDir = dirname(LOCK_PATH);
  if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });

  if (existsSync(LOCK_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as { pid?: number; startedAt?: string };
      if (existing.pid && pidIsAlive(existing.pid)) {
        console.error(`[orchestrator] Another AWB gateway is already running (pid ${existing.pid}, started ${existing.startedAt || 'unknown'}). Exiting.`);
        process.exit(2);
      }
      console.warn(`[orchestrator] Removing stale AWB gateway lock for pid ${existing.pid ?? 'unknown'}`);
      unlinkSync(LOCK_PATH);
    } catch {
      console.warn('[orchestrator] Removing unreadable AWB gateway lock');
      try { unlinkSync(LOCK_PATH); } catch {}
    }
  }

  writeFileSync(LOCK_PATH, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
  }, null, 2));
  lockAcquired = true;
}

function releaseSingletonLock(): void {
  if (!lockAcquired) return;
  try {
    const existing = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as { pid?: number };
    if (existing.pid === process.pid) unlinkSync(LOCK_PATH);
  } catch {}
  lockAcquired = false;
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let tradeEngine: Awaited<ReturnType<typeof import('./trade-engine.js').start>> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received — shutting down`);

  // Stop trade engine
  if (tradeEngine) {
    try { await tradeEngine.stop(); } catch {}
  }

  // Stop research worker
  try {
    const { stop: stopResearch } = await import('./research-worker.js');
    stopResearch();
  } catch {}

  try { stateStore.close(); } catch { /* ignore */ }
  releaseSingletonLock();
  log('Shutdown complete');
  process.exit(0);
}

let stateStore: GatewayStateStore;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  acquireSingletonLock();
  log('Gateway V2 starting (single-process mode)');

  // 1. Create shared state store
  stateStore = new GatewayStateStore(DB_PATH);
  log(`State store ready (${DB_PATH})`);

  // 2. Brain MCP — single source of truth for trade intelligence
  const brainOk = await brain.checkHealth();
  log(`Brain MCP: ${brainOk ? `connected (${process.env.BRAIN_SERVER_URL || 'trident.cetaceanlabs.com'})` : 'UNAVAILABLE — trades will not be recorded'}`);

  // Seed Brain with trading rules (idempotent — Brain deduplicates)
  if (brainOk) {
    brain.recordRule('AWB recovery: paper-only equities trade documented RSI-2, ORB, and inverse-regime paths. Trident records notes and outcomes but does not gate deterministic entries.', 'system').catch(() => {});
    brain.recordRule('AWB protection stack: $100 heartbeat stop when engine is running, 5% broker-side disaster stop on long equities, 7% broker-side stop on inverse ETF positions, max 5 positions, $50K deployed cap.', 'system').catch(() => {});
    brain.recordRule('Forex: observe/manage separately; no forex rule should override AWB equity risk controls.', 'system').catch(() => {});
  }

  // 2b. Initialize Bayesian Intelligence — reconstructs from Brain, not local SQLite
  const bayesianIntel = new BayesianIntelligence();
  if (brainOk) {
    try {
      const tradeHistory = await brain.getRecentTradeOutcomes(200);
      let loaded = 0;
      for (const t of tradeHistory) {
        bayesianIntel.recordOutcome(`ticker:${t.ticker}`, {
          domain: 'ticker', subject: t.ticker,
          tags: ['trade_outcome'], contributors: ['brain'],
        }, t.success, t.returnPct);
        loaded++;
      }
      const stats = bayesianIntel.getCollectiveIntelligence();
      log(`Bayesian Intelligence seeded from Brain: ${stats.totalBeliefs} beliefs from ${loaded} trades`);
    } catch (e: any) { log(`Bayesian seed from Brain failed: ${e.message} — starting fresh`); }
  }

  // Emit intelligence:ready for in-process listeners (research worker picks this up)
  eventBus.emit('intelligence:ready' as any, bayesianIntel);

  // Expose Bayesian intel on the status endpoint via config keys
  const origGet = stateStore.get.bind(stateStore);
  (stateStore as any).get = (key: string) => {
    if (key === '__bayesian_intel__') return JSON.stringify(bayesianIntel.getCollectiveIntelligence());
    if (key === '__bayesian_metrics__') return JSON.stringify(bayesianIntel.getIntelligenceMetrics());
    return origGet(key);
  };

  // Sync Bayesian beliefs to Brain SONA every 5 minutes
  setInterval(() => {
    try {
      const beliefs = bayesianIntel.query({ minObservations: 3 }).slice(0, 50);
      if (beliefs.length > 0) {
        brain.syncBeliefsToSona(beliefs.map(b => ({ id: b.id, subject: b.subject, posterior: b.posterior, observations: b.observations, avgReturn: b.avgReturn }))).catch(() => {});
      }
    } catch {}
  }, 300_000);

  // 2d. Initialize Research Database (PostgreSQL + pgvector) + Research Crons
  let pgAvailable = false;
  try {
    const { initResearchDb, query: pgQuery } = await import('../../research-db/src/index.js');
    await initResearchDb();
    pgAvailable = true;
    log('Research database connected (PostgreSQL + pgvector)');

    // Start research crons (Nanobot reintro — clean scheduled tasks)
    try {
      const creds = loadCredentials();
      if (creds.alpaca) {
        const { startResearchCrons } = await import('./research-crons.js');
        startResearchCrons(
          pgQuery,
          stateStore,
          { 'APCA-API-KEY-ID': creds.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca.apiSecret },
          log,
        );
        log('Research crons started (knowledge_graph 2AM, signal_scan 15min, thesis_resolution 4:30PM, mv_refresh 30min)');
      }
    } catch (e: any) {
      log(`Research crons failed to start: ${e.message}`);
    }
  } catch (e: any) {
    log(`Research database not available: ${e.message} — running without PG (SQLite fallback)`);
  }

  // 3. Start API server in-process
  await startApiServer(stateStore);

  // 4. Ops (SRE) + Research team + OpenClaw
  const { Ops } = await import('./managers/ops.js');
  const ops = new Ops(DB_PATH);
  ops.start();

  // Research: News Intelligence (90s cycle — catalysts, sentiment, critical events)
  const { ResearchNews } = await import('./managers/research-news.js');
  const researchNews = new ResearchNews(DB_PATH);
  researchNews.start();

  // Research: Quality & Sector Performance (120s cycle — promote/demote sectors)
  const { ResearchQuality } = await import('./managers/research-quality.js');
  const researchQuality = new ResearchQuality(DB_PATH);
  researchQuality.start();

  // OpenClaw: monitors held positions, triggers targeted research when they drop
  const openClaw = new OpenClawEngine(stateStore, 60_000); // 60-second cycle

  // Position monitor: when any holding drops 2%+, search for why and flag it
  openClaw.registerAction('position-intel', 'monitor_drops', async () => {
    try {
      const headers = getAlpacaHeaders();
      if (!headers) return { detail: 'No creds', result: 'skipped' as const };

      const creds = loadCredentials();
      const posRes = await fetch(`${creds.alpaca!.baseUrl}/v2/positions`, {
        headers, signal: AbortSignal.timeout(5000),
      });
      if (!posRes.ok) return { detail: 'Positions fetch failed', result: 'error' as const };
      const positions = await posRes.json() as any[];

      const alerts: string[] = [];
      for (const pos of positions) {
        const pnlPct = parseFloat(pos.unrealized_plpc) * 100;
        if (pnlPct <= -2) {
          const ticker = pos.symbol;
          const alertKey = `position_alert_${ticker}_${new Date().toISOString().slice(0, 10)}`;
          if (stateStore.get(alertKey)) continue;

          try {
            const searchRes = await fetch(
              `https://query1.finance.yahoo.com/v1/finance/search?q=${ticker}&quotesCount=0&newsCount=3`,
              { headers: { 'User-Agent': 'MTWM/1.0' }, signal: AbortSignal.timeout(5000) },
            );
            let newsContext = '';
            if (searchRes.ok) {
              const searchData = await searchRes.json() as any;
              const news = (searchData.news || []).slice(0, 3);
              newsContext = news.map((n: any) => n.title).join(' | ');
            }

            const alertMsg = `⚠️ ${ticker} down ${pnlPct.toFixed(1)}% ($${parseFloat(pos.unrealized_pl).toFixed(0)}) | ${newsContext || 'No news found'}`;
            alerts.push(alertMsg);
            stateStore.set(alertKey, alertMsg);

            const webhook = process.env.DISCORD_WEBHOOK_URL;
            if (webhook) {
              await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: alertMsg }),
                signal: AbortSignal.timeout(5000),
              }).catch(() => {});
            }

            brain.recordRule(`POSITION ALERT: ${alertMsg}`, 'openclaw:position_intel').catch(() => {});
          } catch {}
        }
      }

      return {
        detail: alerts.length > 0 ? alerts.join(' | ') : 'All positions OK',
        result: alerts.length > 0 ? 'success' as const : 'skipped' as const,
      };
    } catch (e: any) {
      return { detail: e.message, result: 'error' as const };
    }
  }, 'act', 1);

  openClaw.start();
  log('Ops (SRE) + OpenClaw (position intelligence) active.');

  // 5. Start Comms Worker (Discord/Telegram/Slack notifications)
  const comms = new CommsWorker(DB_PATH);
  comms.start();

  // 6. Discord Bot (two-way conversation)
  if (process.env.DISCORD_BOT_TOKEN) {
    try {
      const { start: startBot } = await import('./discord-bot.js');
      await startBot(DB_PATH);
      log('Discord bot connected');
    } catch (e: any) {
      log(`Discord bot failed: ${e.message} — webhook-only mode`);
    }
  }

  // ─── 7. Start Research Worker IN-PROCESS ──────────────────────────────────
  try {
    const { start: startResearch } = await import('./research-worker.js');
    await startResearch(stateStore);
    log('Research worker started (in-process)');
  } catch (e: any) {
    log(`Research worker failed: ${e.message} — running without research`);
  }

  // ─── 8. Start Trade Engine IN-PROCESS ─────────────────────────────────────
  try {
    const { start: startEngine } = await import('./trade-engine.js');
    tradeEngine = await startEngine(stateStore);
    log('Trade engine started (in-process)');
  } catch (e: any) {
    log(`Trade engine failed: ${e.message}`);
  }

  // Forex scanner runs as a separate Express server on port 3003.
  // It's managed independently (systemd or Docker Compose sidecar).
  // Trade engine proxies to it via HTTP when OANDA creds are missing locally.
  log('Forex scanner: managed separately (port 3003)');

  // ─── Real-Time Market Stream (signal detection) ──────────────────────────
  try {
    const creds = loadCredentials();
    if (creds.alpaca) {
      const { MarketStream } = await import('./market-stream.js');
      let pgQueryFn: any = null;
      try {
        const { query: pgQ } = await import('../../research-db/src/index.js');
        pgQueryFn = pgQ;
      } catch {}

      const stream = new MarketStream(stateStore, creds.alpaca.apiKey, creds.alpaca.apiSecret, pgQueryFn);

      // Build watchlist from momentum scanner universe + thesis tickers
      const watchTickers: string[] = [];
      try {
        const stars = stateStore.getResearchStars();
        for (const s of stars.slice(0, 200)) watchTickers.push(s.symbol);
        if (pgQueryFn) {
          const { rows: thesisTickers } = await pgQueryFn('SELECT DISTINCT symbol FROM research_theses WHERE status = \'active\' LIMIT 50');
          for (const r of thesisTickers) watchTickers.push((r as any).symbol);
        }
      } catch {}
      watchTickers.push('SPY', 'QQQ', 'IWM', 'XLE', 'XLF', 'XLK', 'GLD', 'UVXY');

      stream.setWatchlist([...new Set(watchTickers)]);

      // Stream alerts go directly to event bus — no IPC needed
      stream.onAlert((alert) => {
        log(`STREAM ALERT: ${alert.alertType} ${alert.ticker} — ${alert.detail}`);
        eventBus.emit('stream:alert' as any, {
          ticker: alert.ticker,
          alertType: alert.alertType,
          magnitude: alert.magnitude,
          currentPrice: alert.currentPrice,
          detail: alert.detail,
        });
      });

      stream.start();
      log(`Market stream started — watching ${watchTickers.length} tickers for volume spikes + breakouts`);
    }
  } catch (e: any) {
    log(`Market stream failed: ${e.message} — real-time detection disabled`);
  }

  // ─── Post-Mortem Analyst (Wave 1) ──────────────────────────────────────
  schedulePostMortem(stateStore);

  // ─── Macro Analyst (Wave 2) ────────────────────────────────────────────
  scheduleMacroAnalyst(stateStore);

  // ─── Catalyst Hunter (Wave 2) ─────────────────────────────────────────
  scheduleCatalystHunter(stateStore);

  // ─── Momentum Scanner ────────────────────────────────────────────────
  scheduleMomentumScanner(stateStore);

  // ─── Deep Research Analyst ──────────────────────────────────────────
  scheduleDeepResearch(stateStore);

  // Run ALL analysts immediately on startup if it's a weekday during business hours
  if (isBusinessHoursET()) {
    setTimeout(() => runMacroOnce(stateStore), 2000);
    setTimeout(() => runCatalystOnce(stateStore), 5000);
    setTimeout(() => runMomentumOnce(stateStore), 8000);
    setTimeout(() => runDeepResearchOnce(stateStore), 12000);
  }

  log('Orchestrator ready — all components running in-process');
}

// ─── Wave 2 scheduling helpers ─────────────────────────────────────────

function isBusinessHoursET(): boolean {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const hour = et.getHours();
  return day >= 1 && day <= 5 && hour >= 7 && hour < 17;
}

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

async function runMacroOnce(store: GatewayStateStore): Promise<void> {
  try {
    const { MacroAnalyst } = await import('./analysts/index.js');
    const creds = loadCredentials();
    if (!creds.alpaca) { log('Macro: no Alpaca creds, skip'); return; }
    const analyst = new MacroAnalyst(store);
    const headers = {
      'APCA-API-KEY-ID': creds.alpaca.apiKey,
      'APCA-API-SECRET-KEY': creds.alpaca.apiSecret,
    };
    const verdict = await analyst.assess(headers);
    log(`Macro: regime=${verdict.regime} sizing=${verdict.sizingMultiplier.toFixed(2)}x (${verdict.source})`);
  } catch (e: any) {
    log(`Macro run error: ${e.message}`);
  }
}

async function runCatalystOnce(store: GatewayStateStore): Promise<void> {
  try {
    const { CatalystHunter } = await import('./analysts/index.js');
    const creds = loadCredentials();
    if (!creds.alpaca) { log('Catalyst: no Alpaca creds, skip'); return; }
    const hunter = new CatalystHunter(store);
    const headers = {
      'APCA-API-KEY-ID': creds.alpaca.apiKey,
      'APCA-API-SECRET-KEY': creds.alpaca.apiSecret,
    };
    const result = await hunter.scan(headers);
    log(`Catalyst: ${result.candidates.length} candidates (${result.source})`);
  } catch (e: any) {
    log(`Catalyst run error: ${e.message}`);
  }
}

function scheduleMacroAnalyst(store: GatewayStateStore): void {
  const scheduleNext = () => {
    const { ms, target } = msUntilETWeekday(8, 15);
    log(`Macro scheduled for ${target.toISOString()} (in ${Math.round(ms / 60_000)} min)`);
    setTimeout(async () => {
      await runMacroOnce(store);
      scheduleNext();
    }, ms);
  };
  scheduleNext();
}

async function runMomentumOnce(store: GatewayStateStore): Promise<void> {
  try {
    const { scanMomentum, persistMomentumData } = await import('./analysts/index.js');
    const creds = loadCredentials();
    if (!creds.alpaca) { log('Momentum: no Alpaca creds, skip'); return; }
    const headers = {
      'APCA-API-KEY-ID': creds.alpaca.apiKey,
      'APCA-API-SECRET-KEY': creds.alpaca.apiSecret,
    };
    const result = await scanMomentum(headers);

    const sectorMap: Record<string, string> = {
      NVDA:'Semis',AMD:'Semis',INTC:'Semis',AVGO:'Semis',TSM:'Semis',ASML:'Semis',MRVL:'Semis',ON:'Semis',
      ALAB:'Semis',KLAC:'Semis',LRCX:'Semis',AMAT:'Semis',MU:'Semis',MPWR:'Semis',SMH:'Semis',WOLF:'Semis',
      FORM:'Semis',SNDK:'Semis',CRDO:'Semis',ARM:'Semis',
      AAPL:'Tech',MSFT:'Tech',GOOGL:'Tech',GOOG:'Tech',AMZN:'Tech',META:'Tech',TSLA:'Tech',ORCL:'Tech',
      CRM:'Tech',NFLX:'Tech',PLTR:'Tech',NET:'Tech',CRWV:'Tech',DELL:'Tech',SMCI:'Tech',VRT:'Tech',NOK:'Tech',
      NOW:'Tech',SNOW:'Tech',DDOG:'Tech',PANW:'Tech',HUBS:'Tech',INTU:'Tech',IBM:'Tech',WDAY:'Tech',
      MARA:'Crypto',RIOT:'Crypto',MSTR:'Crypto',HUT:'Crypto',BITF:'Crypto',CLSK:'Crypto',CIFR:'Crypto',WULF:'Crypto',COIN:'Crypto',
      JPM:'Finance',GS:'Finance',MS:'Finance',BAC:'Finance',C:'Finance',WFC:'Finance',V:'Finance',MA:'Finance',PYPL:'Finance',SOFI:'Finance',
      XOM:'Energy',CVX:'Energy',COP:'Energy',SLB:'Energy',HAL:'Energy',OXY:'Energy',DVN:'Energy',XLE:'Energy',USO:'Energy',
      LMT:'Defense',RTX:'Defense',NOC:'Defense',GD:'Defense',BA:'Defense',RKLB:'Defense',AXON:'Defense',
      DAL:'Transport',UAL:'Transport',AAL:'Transport',CAR:'Transport',CCL:'Transport',RCL:'Transport',FDX:'Transport',UPS:'Transport',
      LLY:'Health',PFE:'Health',MRK:'Health',MRNA:'Health',HIMS:'Health',UNH:'Health',
      RVMD:'Biotech',SYRE:'Biotech',BEAM:'Biotech',TVTX:'Biotech',XBI:'Biotech',
      COST:'Consumer',WMT:'Consumer',HD:'Consumer',DIS:'Consumer',CVNA:'Consumer',KMX:'Consumer',
      FCX:'Materials',NEM:'Materials',VALE:'Materials',ALB:'Materials',MP:'Materials',
      CAT:'Industrial',DE:'Industrial',GE:'Industrial',HON:'Industrial',
      ENPH:'Solar',FSLR:'Solar',CEG:'Solar',VST:'Solar',
      RIVN:'EV',NIO:'EV',PLUG:'EV',BE:'EV',
    };

    const { snapshots, sectors, stars } = persistMomentumData(store, result, sectorMap);
    log(`Momentum: scanned ${result.scanned} | ${result.strong.length} strong + ${result.moderate.length} moderate | DB: ${snapshots} snapshots, ${sectors} sectors, ${stars} stars`);
    if (result.strong.length > 0) {
      log(`  Top 5: ${result.strong.slice(0, 5).map(r => `${r.symbol} ${r.change5d >= 0 ? '+' : ''}${r.change5d.toFixed(1)}%`).join(', ')}`);
    }
  } catch (e: any) {
    log(`Momentum run error: ${e.message}`);
  }
}

function scheduleMomentumScanner(store: GatewayStateStore): void {
  const slots: Array<[number, number, string]> = [
    [8, 0, 'pre-market'],
    [10, 0, 'mid-morning'],
    [12, 0, 'midday'],
    [14, 0, 'afternoon'],
  ];
  for (const [hour, minute, label] of slots) {
    const scheduleNext = () => {
      const { ms, target } = msUntilETWeekday(hour, minute);
      log(`Momentum (${label}) scheduled for ${target.toISOString()} (in ${Math.round(ms / 60_000)} min)`);
      setTimeout(async () => {
        log(`Momentum ${label} run starting`);
        await runMomentumOnce(store);
        scheduleNext();
      }, ms);
    };
    scheduleNext();
  }
}

function scheduleCatalystHunter(store: GatewayStateStore): void {
  const slots: Array<[number, number, string]> = [
    [8, 30, 'pre-market'],
    [12, 0, 'midday'],
    [14, 0, 'afternoon'],
  ];
  for (const [hour, minute, label] of slots) {
    const scheduleNext = () => {
      const { ms, target } = msUntilETWeekday(hour, minute);
      log(`Catalyst (${label}) scheduled for ${target.toISOString()} (in ${Math.round(ms / 60_000)} min)`);
      setTimeout(async () => {
        log(`Catalyst ${label} run starting`);
        await runCatalystOnce(store);
        scheduleNext();
      }, ms);
    };
    scheduleNext();
  }
}

// ─── Deep Research (7 AM ET daily) ────────────────────────────────────────
function getDeepResearchTickers(store: GatewayStateStore): string[] {
  const tickers = new Set<string>();

  // Core holdings
  for (const t of ['AMZN', 'NVDA']) tickers.add(t);

  // Watchlist
  for (const t of ['AMD', 'NFLX']) tickers.add(t);

  // Top research stars
  try {
    const stars = store.getResearchStars();
    for (const s of stars.sort((a: any, b: any) => b.score - a.score).slice(0, 10)) {
      if (/^[A-Z]{1,5}$/.test(s.symbol) && !s.symbol.includes('-')) tickers.add(s.symbol);
    }
  } catch {}

  return [...tickers];
}

async function runDeepResearchOnce(store: GatewayStateStore): Promise<void> {
  try {
    const tickers = getDeepResearchTickers(store);
    log(`Deep Research: starting on ${tickers.length} tickers`);
    const { runDeepResearch } = await import('./analysts/index.js');
    const result = await runDeepResearch(tickers);
    log(`Deep Research done: ${result.succeeded}/${result.scanned} | ${result.tridentRecorded} to Trident | top: ${result.profiles.sort((a, b) => b.fundamentalScore - a.fundamentalScore).slice(0, 3).map(p => `${p.symbol}(${p.fundamentalScore})`).join(', ')}`);
  } catch (e: any) {
    log(`Deep Research error: ${e.message}`);
  }
}

function scheduleDeepResearch(store: GatewayStateStore): void {
  const scheduleNext = () => {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const target = new Date(et);
    target.setHours(7, 0, 0, 0); // 7 AM ET
    if (target <= et) target.setDate(target.getDate() + 1);
    while (target.getDay() === 0 || target.getDay() === 6) {
      target.setDate(target.getDate() + 1);
    }
    const offsetMs = target.getTime() - et.getTime();
    log(`Deep Research scheduled for ${target.toISOString()} (in ${Math.round(offsetMs / 60_000)} min)`);

    setTimeout(async () => {
      await runDeepResearchOnce(store);
      scheduleNext();
    }, offsetMs);
  };
  scheduleNext();
}

function schedulePostMortem(store: GatewayStateStore): void {
  const scheduleNext = async () => {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const target = new Date(et);
    target.setHours(16, 5, 0, 0);
    if (target <= et) target.setDate(target.getDate() + 1);
    while (target.getDay() === 0 || target.getDay() === 6) {
      target.setDate(target.getDate() + 1);
    }
    const offsetMs = target.getTime() - et.getTime();

    log(`Post-Mortem scheduled for ${target.toISOString()} (in ${Math.round(offsetMs / 60_000)} min)`);

    setTimeout(async () => {
      try {
        log('Post-Mortem: starting daily analysis');
        const { PostMortemAnalyst } = await import('./analysts/index.js');
        const analyst = new PostMortemAnalyst(store, brain);
        const result = await analyst.runDailyPostMortem();
        log(`Post-Mortem done: ${result.tradesAnalyzed} trades, ${result.losingTrades} losses ($${result.totalLoss.toFixed(2)}), ${result.rulesGenerated} rules generated`);
      } catch (e: any) {
        log(`Post-Mortem error: ${e.message}`);
      }
      scheduleNext();
    }, offsetMs);
  };

  scheduleNext().catch(e => log(`Post-Mortem schedule failed: ${e.message}`));
}

// Signal handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Crash protection — log but don't exit
process.on('uncaughtException', (err) => {
  console.error('[orchestrator] uncaughtException:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[orchestrator] unhandledRejection:', reason);
});

main().catch((err) => {
  console.error('[orchestrator] Fatal:', err);
  releaseSingletonLock();
  process.exit(1);
});

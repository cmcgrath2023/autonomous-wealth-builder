/**
 * Gateway V2 — Process Orchestrator
 *
 * Main entry point that starts the API server in-process and spawns
 * trade-engine, data-feed, and research-worker as child processes.
 * Monitors workers, auto-restarts on crash with backoff, and handles
 * graceful shutdown on SIGINT/SIGTERM.
 */

import { fork, ChildProcess } from 'child_process';
import { resolve, dirname, join } from 'path';
import { existsSync } from 'fs';
import { config } from 'dotenv';

// Load env from gateway/.env.local (same file the old gateway used — has Discord tokens etc.)
const envLocal = resolve(dirname(new URL(import.meta.url).pathname), '../../gateway/.env.local');
if (existsSync(envLocal)) config({ path: envLocal, override: true });
// Also load services/.env.webhook if present
const envWebhook = resolve(dirname(new URL(import.meta.url).pathname), '../../.env.webhook');
if (existsSync(envWebhook)) config({ path: envWebhook });

import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { start as startApiServer } from './api-server.js';
import { startManagers, stopManagers } from './managers/index.js';
import { CommsWorker } from './comms-worker.js';
import { OpenClawEngine } from './openclaw.js';
import { BayesianIntelligence } from '../../shared/intelligence/bayesian-intelligence.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { brain } from './brain-client.js';
// STRIPPED 2026-04-10: RVFEngine, LearningEngine (dead code — never called after
// instantiation). Nanobot scheduler removed too — trade_advisor output was written
// to `advisor_star:*` which nothing read. See docs/intelligence-layers-audit.md.

const DB_PATH = join(process.cwd(), 'data', 'gateway-state.db');

// ---------------------------------------------------------------------------
// Worker configuration
// ---------------------------------------------------------------------------

interface WorkerConfig {
  name: string;
  script: string;
  restartDelay: number;   // ms between restart attempts
  maxRestarts: number;     // max restarts per hour
  optional: boolean;       // skip if script file doesn't exist
}

interface WorkerState {
  config: WorkerConfig;
  process: ChildProcess | null;
  restartTimestamps: number[];   // timestamps of recent restarts (within 1h)
  stopped: boolean;              // true when orchestrator is shutting down
}

const SRC_DIR = dirname(new URL(import.meta.url).pathname);

// research-worker: fundamental/catalyst research layer. Scans RSS feeds,
// analyzes sectors, writes catalyst-backed candidates to the store. These
// candidates are MERGED with Alpaca movers to form the universe that
// NeuralTrader evaluates — research-worker widens the candidate pool with
// news/catalyst context, it does NOT replace NeuralTrader as the signal
// authority.
const WORKER_CONFIGS: WorkerConfig[] = [
  { name: 'trade-engine',    script: resolve(SRC_DIR, 'trade-engine.ts'),    restartDelay: 5000,  maxRestarts: 10, optional: false },
  { name: 'data-feed',       script: resolve(SRC_DIR, 'data-feed.ts'),       restartDelay: 3000,  maxRestarts: 20, optional: true },
  { name: 'research-worker', script: resolve(SRC_DIR, 'research-worker.ts'), restartDelay: 5000,  maxRestarts: 10, optional: true },
];

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[orchestrator] ${new Date().toISOString()} ${msg}`);
}

// ---------------------------------------------------------------------------
// Worker management
// ---------------------------------------------------------------------------

const workers: WorkerState[] = [];
let stateStore: GatewayStateStore;
let shuttingDown = false;

function pruneOldRestarts(state: WorkerState): void {
  const oneHourAgo = Date.now() - 3_600_000;
  state.restartTimestamps = state.restartTimestamps.filter(ts => ts > oneHourAgo);
}

function writeWorkerHealth(name: string, status: string, pid?: number): void {
  try {
    stateStore.set(`worker:${name}`, JSON.stringify({
      status,
      pid: pid ?? null,
      updatedAt: new Date().toISOString(),
    }));
  } catch { /* state store write is best-effort */ }
}

function spawnWorker(state: WorkerState): void {
  if (state.stopped || shuttingDown) return;

  const { config } = state;

  // tsx is installed at services/node_modules/tsx — set cwd accordingly
  const child = fork(config.script, [], {
    execArgv: ['--import', 'tsx/esm'],
    cwd: resolve(SRC_DIR, '../..'), // services/ dir where node_modules/tsx lives
    env: {
      ...process.env,
      GATEWAY_DB_PATH: DB_PATH,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  state.process = child;
  const pid = child.pid ?? 0;
  log(`${config.name} started (pid ${pid})`);
  writeWorkerHealth(config.name, 'running', pid);

  // Pipe stdout/stderr with worker name prefix
  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) console.log(`[${config.name}] ${line}`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) console.error(`[${config.name}] ${line}`);
  });

  // IPC: trade engine forwards trade:closed events to parent for Bayesian learning
  child.on('message', (msg: any) => {
    if (msg?.type === 'trade:closed' && msg.payload) {
      const { ticker, success, returnPct, reason } = msg.payload;
      eventBus.emit('trade:closed' as any, msg.payload);
      log(`IPC trade:closed ${ticker} ${success ? 'WIN' : 'LOSS'} (${reason})`);
    }
  });

  child.on('exit', (code, signal) => {
    state.process = null;

    if (state.stopped || shuttingDown) {
      log(`${config.name} exited (shutdown)`);
      writeWorkerHealth(config.name, 'stopped');
      return;
    }

    log(`${config.name} exited — code=${code} signal=${signal}`);
    writeWorkerHealth(config.name, 'crashed');

    // Rate-limit restarts
    pruneOldRestarts(state);
    if (state.restartTimestamps.length >= config.maxRestarts) {
      log(`${config.name} exceeded ${config.maxRestarts} restarts/hour — giving up`);
      writeWorkerHealth(config.name, 'abandoned');
      return;
    }

    state.restartTimestamps.push(Date.now());
    const attempt = state.restartTimestamps.length;
    const delay = config.restartDelay * Math.min(attempt, 5); // backoff up to 5x

    log(`${config.name} restarting in ${delay}ms (attempt ${attempt}/${config.maxRestarts})`);
    setTimeout(() => spawnWorker(state), delay);
  });

  child.on('error', (err) => {
    log(`${config.name} spawn error: ${err.message}`);
    writeWorkerHealth(config.name, 'error');
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received — shutting down workers`);

  // Mark all workers as stopped so exit handlers don't restart
  for (const w of workers) w.stopped = true;

  // Send SIGTERM to all live workers
  const killPromises = workers.map(w => {
    if (!w.process) return Promise.resolve();
    return new Promise<void>(resolve => {
      const child = w.process!;
      const timeout = setTimeout(() => {
        log(`${w.config.name} did not exit — sending SIGKILL`);
        child.kill('SIGKILL');
        resolve();
      }, 5000);

      child.on('exit', () => { clearTimeout(timeout); resolve(); });
      child.kill('SIGTERM');
    });
  });

  await Promise.all(killPromises);

  try { stateStore.close(); } catch { /* ignore */ }
  log('All workers stopped — exiting');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('Gateway V2 starting');

  // 1. Create shared state store
  stateStore = new GatewayStateStore(DB_PATH);
  log(`State store ready (${DB_PATH})`);

  // 2. Brain MCP — single source of truth for trade intelligence
  const brainOk = await brain.checkHealth();
  log(`Brain MCP: ${brainOk ? `connected (${process.env.BRAIN_SERVER_URL || 'trident.cetaceanlabs.com'})` : 'UNAVAILABLE — trades will not be recorded'}`);

  // Seed Brain with trading rules (idempotent — Brain deduplicates)
  if (brainOk) {
    brain.recordRule('Buy movers at market open (9:35 ET), hold all day, sell before close (3:50 ET)', 'system').catch(() => {});
    brain.recordRule('Max 6 equity positions, $8K budget, no rotation during day', 'system').catch(() => {});
    brain.recordRule('Forex: 25K units per trade, max 4 positions, bank at $50, cut at -$20', 'system').catch(() => {});
    brain.recordRule('Avoid tickers with <35% win rate over 5+ trades', 'system').catch(() => {});
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

  // Emit intelligence:ready for in-process listeners
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

  // STRIPPED 2026-04-10: RVF Engine + Learning Engine. They were instantiated
  // here and never referenced again anywhere in the codebase. Per Trident →
  // this functionality is covered by the Brain memory + SONA training loop.

  // 2d. Initialize Research Database (PostgreSQL + pgvector)
  try {
    const { initResearchDb } = await import('../../research-db/src/index.js');
    await initResearchDb();
    log('Research database connected (PostgreSQL + pgvector)');
  } catch (e: any) {
    log(`Research database not available: ${e.message} — running without PG (SQLite fallback)`);
  }

  // 3. Start API server in-process (lightweight, no need for separate process)
  await startApiServer(stateStore);

  // 3. Start OpenClaw Engine + managers (Warren → Fin, Ops only)
  // STRIPPED 2026-04-10: Liza + Ferd managers removed. Their output was
  // observational — no code in trade-engine ever consumed their state.
  const openClaw = new OpenClawEngine(stateStore, 30_000);
  const managers = startManagers(DB_PATH);

  // Register manager cycles as OpenClaw actions with autonomy levels
  openClaw.registerAction('warren', 'briefing', async () => {
    const briefing = stateStore.get('warren:briefing');
    return { detail: briefing ? JSON.parse(briefing).narrative : 'No briefing yet', result: briefing ? 'success' : 'skipped' };
  }, 'act', 1);

  openClaw.registerAction('fin', 'monitor_positions', async () => {
    const status = stateStore.get('manager_fin_status');
    return { detail: status ? JSON.parse(status).actions?.join('; ') || 'monitoring' : 'offline', result: status ? 'success' : 'error' };
  }, 'act', 2);

  openClaw.start();
  log('OpenClaw Engine started — Warren (urgency) → Fin (execution). Ops monitoring.');

  // 4. Start Comms Worker (Discord/Telegram/Slack notifications)
  const comms = new CommsWorker(DB_PATH);
  comms.start();

  // 5. Start Discord Bot (two-way conversation)
  if (process.env.DISCORD_BOT_TOKEN) {
    try {
      const { start: startBot } = await import('./discord-bot.js');
      await startBot(DB_PATH);
      log('Discord bot connected');
    } catch (e: any) {
      log(`Discord bot failed: ${e.message} — webhook-only mode`);
    }
  }

  // STRIPPED 2026-04-10: Nanobot Bridge + Scheduler removed entirely.
  // trade_advisor wrote to `advisor_star:*` which trade-engine never read —
  // it was paying LLM tokens to write into a bucket nothing consumed.
  // If nanobots are wanted later, they must be wired directly into the
  // trade-engine candidate pipeline, not to a parallel store key.

  // 7. Spawn worker processes
  for (const config of WORKER_CONFIGS) {
    if (config.optional && !existsSync(config.script)) {
      log(`${config.name} skipped (${config.script} not found)`);
      writeWorkerHealth(config.name, 'skipped');
      continue;
    }

    const state: WorkerState = {
      config,
      process: null,
      restartTimestamps: [],
      stopped: false,
    };
    workers.push(state);
    spawnWorker(state);
  }

  // Push initial Bayesian beliefs to trade-engine worker via IPC
  const sendBeliefsToTradeEngine = () => {
    const tradeWorker = workers.find(w => w.config.name === 'trade-engine');
    if (tradeWorker?.process?.connected) {
      try {
        tradeWorker.process.send({ type: 'intelligence:beliefs', beliefs: bayesianIntel.serialize() });
      } catch {}
    }
  };
  // Send after a short delay to let worker initialize
  setTimeout(sendBeliefsToTradeEngine, 3000);

  // Push updated beliefs to trade-engine on every trade:closed (keeps intelligence fresh)
  eventBus.on('trade:closed' as any, () => {
    sendBeliefsToTradeEngine();
  });

  // ─── Post-Mortem Analyst (Wave 1) ──────────────────────────────────────
  // Fires at 4:05 PM ET every weekday. Analyzes today's losing trades and
  // writes machine-readable risk_rules that the Risk Manager enforces next
  // trading day. This is the learning loop.
  schedulePostMortem(stateStore);

  // ─── Macro Analyst (Wave 2) ────────────────────────────────────────────
  // Fires at 8:15 AM ET every weekday (pre-market). Classifies market
  // regime and writes a sizing multiplier to the store. Trade-engine reads
  // the multiplier before sizing each buy.
  scheduleMacroAnalyst(stateStore);

  // ─── Catalyst Hunter (Wave 2) ─────────────────────────────────────────
  // Fires pre-market (8:30 AM ET), midday (12 PM ET), and afternoon (2 PM ET)
  // every weekday. Writes catalyst-tagged tickers to research_stars, which
  // feed the trade-engine buy universe alongside Alpaca movers.
  scheduleCatalystHunter(stateStore);

  // ─── Momentum Scanner (broad-market multi-day screening) ────────────
  // Scans ~300 tickers across all sectors for 5-day momentum.
  // Runs pre-market (8:00 AM ET) + every 2 hours during market hours.
  scheduleMomentumScanner(stateStore);

  // Run ALL analysts immediately on startup if it's a weekday during
  // business hours — don't wait for cron.
  if (isBusinessHoursET()) {
    setTimeout(() => runMacroOnce(stateStore), 2000);
    setTimeout(() => runCatalystOnce(stateStore), 5000);
    setTimeout(() => runMomentumOnce(stateStore), 8000);
  }

  log(`Orchestrator ready — ${workers.length} worker(s) spawned`);
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
    const { loadCredentials } = await import('./config-bus.js');
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
    const { loadCredentials } = await import('./config-bus.js');
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
    const { loadCredentials } = await import('./config-bus.js');
    const creds = loadCredentials();
    if (!creds.alpaca) { log('Momentum: no Alpaca creds, skip'); return; }
    const headers = {
      'APCA-API-KEY-ID': creds.alpaca.apiKey,
      'APCA-API-SECRET-KEY': creds.alpaca.apiSecret,
    };
    const result = await scanMomentum(headers);

    // Sector map for database classification
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

    // Persist to DATABASE tables + research_stars
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
  // Pre-market (8:00 AM) + every 2 hours during market (10, 12, 2 PM)
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
  // Three runs per weekday: 8:30 AM, 12:00 PM, 2:00 PM ET.
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

/**
 * Schedules the Post-Mortem analyst to fire at 4:05 PM ET every weekday.
 * Uses a simple setTimeout — not full Nanobot cron — so there's no extra
 * infrastructure dependency. Reschedules itself after each run.
 */
function schedulePostMortem(store: GatewayStateStore): void {
  const scheduleNext = async () => {
    // Compute ms until next 4:05 PM ET weekday
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const target = new Date(et);
    target.setHours(16, 5, 0, 0);
    if (target <= et) target.setDate(target.getDate() + 1);
    // Skip weekends
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
      // Reschedule for tomorrow
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
  process.exit(1);
});

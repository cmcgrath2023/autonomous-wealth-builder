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
if (existsSync(envLocal)) config({ path: envLocal });
// Also load services/.env.webhook if present
const envWebhook = resolve(dirname(new URL(import.meta.url).pathname), '../../.env.webhook');
if (existsSync(envWebhook)) config({ path: envWebhook });

import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { start as startApiServer } from './api-server.js';
import { startManagers, stopManagers } from './managers/index.js';
import { CommsWorker } from './comms-worker.js';
import { OpenClawEngine } from './openclaw.js';
import { BayesianIntelligence } from '../../shared/intelligence/bayesian-intelligence.js';
import { RVFEngine } from '../../rvf-engine/src/index.js';
import { LearningEngine } from '../../rvf-engine/src/learning-engine.js';
import { eventBus } from '../../shared/utils/event-bus.js';
// Nanobot loaded dynamically in main()

const DB_PATH = join(process.cwd(), 'data', 'gateway-state.db');
const BAYESIAN_KEY = 'bayesian_intelligence_state';

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

  // 2. Initialize Bayesian Intelligence with persistence
  const bayesianIntel = new BayesianIntelligence();
  try {
    const saved = stateStore.get(BAYESIAN_KEY);
    if (saved) {
      bayesianIntel.fromJSON(JSON.parse(saved));
      const stats = bayesianIntel.getCollectiveIntelligence();
      log(`Bayesian Intelligence restored: ${stats.totalBeliefs} beliefs, ${stats.totalObservations} observations`);
    }
  } catch (e: any) { log(`Bayesian restore failed: ${e.message} — starting fresh`); }

  // Share Bayesian instance with trade engine via eventBus
  eventBus.emit('intelligence:ready' as any, bayesianIntel);

  // Persist Bayesian state every 60 seconds
  setInterval(() => {
    try {
      stateStore.set(BAYESIAN_KEY, JSON.stringify(bayesianIntel.toJSON()));
      bayesianIntel.snapshotLearning();
    } catch {}
  }, 60_000);

  // Expose Bayesian intel on the status endpoint
  const origGet = stateStore.get.bind(stateStore);
  const patchedGet = (key: string) => {
    if (key === '__bayesian_intel__') return JSON.stringify(bayesianIntel.getCollectiveIntelligence());
    if (key === '__bayesian_metrics__') return JSON.stringify(bayesianIntel.getIntelligenceMetrics());
    return origGet(key);
  };
  (stateStore as any).get = patchedGet;

  // 2b. Initialize RVF Engine + Learning Engine
  try {
    const rvfEngine = new RVFEngine();
    const learningEngine = new LearningEngine(rvfEngine);
    log(`RVF Engine + Learning Engine online (${rvfEngine.search('learning-log', 'learning').length > 0 ? 'restored' : 'fresh'})`);
  } catch (e: any) {
    log(`RVF/Learning Engine failed: ${e.message} — running without RVF`);
  }

  // 3. Start API server in-process (lightweight, no need for separate process)
  await startApiServer(stateStore);

  // 3. Start OpenClaw Engine + managers (Warren → Fin, Liza, Ferd)
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

  openClaw.registerAction('liza', 'scan_news', async () => {
    const status = stateStore.get('manager_liza_status');
    return { detail: status ? JSON.parse(status).lastAction || 'scanning' : 'offline', result: status ? 'success' : 'error' };
  }, 'act', 3);

  openClaw.registerAction('ferd', 'analyze_sectors', async () => {
    const status = stateStore.get('manager_ferd_status');
    return { detail: status ? JSON.parse(status).lastAction || 'analyzing' : 'offline', result: status ? 'success' : 'error' };
  }, 'act', 4);

  openClaw.start();
  log('OpenClaw Engine started — Family Office online (Warren, Fin, Liza, Ferd)');

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

  // 6. Start Nanobot Bridge + Scheduler (always-on sub-agent oversight)
  try {
    const { NanobotBridge } = await import('./nanobot-bridge.js');
    const { NanobotScheduler } = await import('./nanobot-scheduler.js');
    const { nanobotRoutes } = await import('./nanobot-routes.js');

    const nanobotBridge = new NanobotBridge((key: string, val: string) => stateStore.set(key, val));
    const nanobotScheduler = new NanobotScheduler(nanobotBridge);
    nanobotScheduler.start();

    const { app: expressApp } = await import('./api-server.js');
    expressApp.use('/api', nanobotRoutes(nanobotBridge));

    openClaw.registerAction('nanobot-bridge', 'monitor_tasks', async () => {
      const active = nanobotBridge.getActiveTaskIds();
      return { detail: `${active.length} active tasks`, result: active.length > 0 ? 'success' : 'skipped' };
    }, 'observe', 5);

    log('Nanobot Bridge online — scheduler active');
  } catch (e: any) {
    log(`Nanobot Bridge failed: ${e.message} — running without sub-agents`);
  }

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

  log(`Orchestrator ready — ${workers.length} worker(s) spawned`);
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

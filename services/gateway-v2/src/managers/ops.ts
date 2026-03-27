/**
 * Ops -- DevOps/SRE Agent. Monitors ALL system components, takes
 * autonomous action to fix them. 15-second heartbeat (fastest).
 */

import { execSync } from 'child_process';
import { GatewayStateStore } from '../../../gateway/src/state-store.js';

const CYCLE_MS = 15_000;
const HTTP_TIMEOUT_MS = 3_000;
const TRADE_ENGINE_STALE_MS = 3 * 60_000;
const RESEARCH_STALE_MS = 10 * 60_000;
const MANAGER_STALE_MS = 5 * 60_000;

interface ComponentHealth { healthy: boolean; responseMs?: number; staleSecs?: number; starsCount?: number; lastHeartbeat?: string; lastUpdate?: string; lastCheck: string }
interface Incident { component: string; issue: string; action: string; timestamp: string }
interface OpsStatus {
  timestamp: string; all_healthy: boolean;
  components: {
    api_server: ComponentHealth; trade_engine: ComponentHealth;
    research_worker: ComponentHealth; forex_service: ComponentHealth;
    ui: ComponentHealth; tunnel: ComponentHealth; state_store: ComponentHealth;
    managers: { warren: boolean; fin: boolean; liza: boolean; ferd: boolean };
  };
  incidents: Incident[];
}

export class Ops {
  private store: GatewayStateStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _activeIncidents = new Set<string>();
  private cycleCount = 0;
  private running = false;
  private lastStatus: OpsStatus | null = null;
  private notifiedIncidents = new Set<string>();

  constructor(dbPath: string) {
    this.store = new GatewayStateStore(dbPath);
  }

  start(): void {
    this.running = true;
    console.log('[Tara] SRE agent online -- 15s cycle');
    this.cycle();
    this.timer = setInterval(() => this.cycle(), CYCLE_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { this.store.close(); } catch {}
    console.log('[Tara] Offline');
  }

  getStatus(): OpsStatus | null {
    return this.lastStatus;
  }

  getLearnings(): Array<{ observation: string; action: string; outcome: string; score: number }> {
    try {
      const reports = this.store.getReports('ops', 50);
      return reports.map(r => ({
        observation: r.summary,
        action: r.strategy ? (r.strategy as any).action || '' : '',
        outcome: String((r.meta as any)?.outcome || ''),
        score: Number((r.meta as any)?.score || 0),
      }));
    } catch { return []; }
  }

  private _lastPreMarketCheck = '';

  private async preMarketRegressionScan(): Promise<string[]> {
    const results: string[] = [];
    const pass = (t: string) => results.push(`✅ ${t}`);
    const fail = (t: string) => results.push(`❌ ${t}`);

    // 1. Trade engine alive
    try {
      const raw = this.store.get('trade_engine_status');
      if (raw) {
        const ts = JSON.parse(raw);
        const age = Date.now() - new Date(ts.lastHeartbeat || 0).getTime();
        age < 5 * 60_000 ? pass('Trade engine: alive') : fail(`Trade engine: stale (${Math.round(age/60_000)}m)`);
      } else fail('Trade engine: no status');
    } catch { fail('Trade engine: error'); }

    // 2. Daily flag reset
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = this.store.get('trade_engine_last_date') || '';
    lastDate === today ? pass('Daily flags: reset for today') : fail(`Daily flags: stuck on ${lastDate}`);

    // 3. Yahoo Finance reachable
    try {
      const r = await fetch('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=1', { headers: { 'User-Agent': 'MTWM/1.0' }, signal: AbortSignal.timeout(5000) });
      r.ok ? pass('Yahoo Finance: reachable') : fail(`Yahoo Finance: HTTP ${r.status}`);
    } catch { fail('Yahoo Finance: unreachable'); }

    // 4. Brain MCP
    try {
      const r = await fetch('https://brain.oceanicai.io/v1/health', { signal: AbortSignal.timeout(5000) });
      r.ok ? pass('Brain MCP: connected') : fail('Brain MCP: unhealthy');
    } catch { fail('Brain MCP: unreachable'); }

    // 5. Discord webhook
    try {
      const webhook = process.env.DISCORD_WEBHOOK_URL;
      if (webhook && webhook.length > 50 && webhook.length < 200) pass('Discord webhook: configured');
      else fail(`Discord webhook: invalid (len=${webhook?.length})`);
    } catch { fail('Discord webhook: error'); }

    // 6. Alpaca credentials
    try {
      const r = await fetch('https://paper-api.alpaca.markets/v2/account', {
        headers: { 'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '', 'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET || '' },
        signal: AbortSignal.timeout(5000),
      });
      r.ok ? pass('Alpaca: authenticated') : fail(`Alpaca: HTTP ${r.status}`);
    } catch { fail('Alpaca: unreachable'); }

    // 7. Forex service
    try {
      const r = await fetch('http://localhost:3003/api/forex/health', { signal: AbortSignal.timeout(3000) });
      r.ok ? pass('Forex service: healthy') : fail('Forex service: unhealthy');
    } catch { fail('Forex service: down'); }

    // 8. Managers alive
    for (const name of ['fin', 'liza', 'ferd']) {
      const raw = this.store.get(`manager_${name}_status`);
      if (raw) {
        try {
          const s = JSON.parse(raw);
          const age = Date.now() - new Date(s.lastCycle || s.lastScan || 0).getTime();
          age < 5 * 60_000 ? pass(`Manager ${name}: alive`) : fail(`Manager ${name}: stale (${Math.round(age/60_000)}m)`);
        } catch { fail(`Manager ${name}: bad status`); }
      } else fail(`Manager ${name}: no status`);
    }

    return results;
  }

  private async cycle(): Promise<void> {
    if (!this.running) return;
    this.cycleCount++;

    // Pre-market regression scan — once daily at 9:00 AM ET
    const now = new Date();
    const etTime = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false });
    const [etH, etM] = etTime.split(':').map(Number);
    const today = now.toISOString().slice(0, 10);
    if (etH === 6 && etM >= 30 && etM <= 35 && this._lastPreMarketCheck !== today) {
      this._lastPreMarketCheck = today;
      try {
        const results = await this.preMarketRegressionScan();
        const failures = results.filter(r => r.startsWith('❌'));
        const report = `🔧 **Tara** PRE-MARKET SCAN\n${results.join('\n')}`;
        console.log(`[Tara] Pre-market scan: ${results.length - failures.length}/${results.length} pass`);
        // Post to Discord
        const webhook = process.env.DISCORD_WEBHOOK_URL;
        if (webhook) {
          await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: report }), signal: AbortSignal.timeout(5000) }).catch(() => {});
        }
        if (failures.length > 0) {
          console.log(`[Tara] ⚠️ ${failures.length} FAILURES: ${failures.join('; ')}`);
        }
      } catch (e: any) { console.error(`[Tara] Pre-market scan error: ${e.message}`); }
    }
    const now = new Date().toISOString();
    const incidents: Incident[] = [];

    try {
      const [apiServer, forexService, ui] = await Promise.all([
        this.checkHttp('http://localhost:3001/api/status', 500),
        this.checkHttp('http://localhost:3003/api/forex/health'),
        this.checkHttp('http://localhost:3000', undefined, true),
      ]);

      const tradeEngine = this.checkTradeEngine();
      const researchWorker = this.checkResearchWorker();
      const tunnel = this.checkTunnel();
      const stateStore = this.checkStateStore();
      const managers = this.checkManagers();

      // -- Autonomous actions (write ONCE per incident, not every cycle) --
      if (!tradeEngine.healthy && !this._activeIncidents.has('trade_engine')) {
        this._activeIncidents.add('trade_engine');
        this.store.set('restart_request:trade_engine', now);
        incidents.push({ component: 'trade_engine', issue: `Trade engine stale (${tradeEngine.staleSecs}s)`, action: 'restart_requested', timestamp: now });
      } else if (tradeEngine.healthy) { this._activeIncidents.delete('trade_engine'); }

      if (!researchWorker.healthy && !this._activeIncidents.has('research_worker')) {
        this._activeIncidents.add('research_worker');
        this.store.set('restart_request:research_worker', now);
        incidents.push({ component: 'research_worker', issue: 'Research worker stale', action: 'restart_requested', timestamp: now });
      } else if (researchWorker.healthy) { this._activeIncidents.delete('research_worker'); }

      if (!apiServer.healthy && !this._activeIncidents.has('api_server')) {
        this._activeIncidents.add('api_server');
        this.store.set('ops:critical:api_server', now);
        incidents.push({ component: 'api_server', issue: `API slow (${apiServer.responseMs}ms)`, action: 'CRITICAL', timestamp: now });
      } else if (apiServer.healthy) { this._activeIncidents.delete('api_server'); }

      if (!forexService.healthy && !this._activeIncidents.has('forex_service')) {
        this._activeIncidents.add('forex_service');
        try {
          execSync('lsof -ti:3003 2>/dev/null | xargs kill -9 2>/dev/null', { timeout: 3000 });
          execSync('cd /Users/cmcgrath/Documents/mtwm/services && nohup npx tsx forex-scanner/src/server.ts >> /tmp/mtwm-forex-service.log 2>&1 &', { timeout: 5000 });
          incidents.push({ component: 'forex_service', issue: 'Forex unreachable', action: 'RESTARTED by Tara', timestamp: now });
          console.log('[Tara] RESTARTED forex service on :3003');
        } catch {
          incidents.push({ component: 'forex_service', issue: 'Forex unreachable', action: 'restart FAILED', timestamp: now });
        }
      } else if (forexService.healthy) { this._activeIncidents.delete('forex_service'); }

      if (!ui.healthy && !this._activeIncidents.has('ui')) {
        this._activeIncidents.add('ui');
        try {
          execSync('lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null', { timeout: 3000 });
          execSync('cd /Users/cmcgrath/Documents/mtwm/mtwm-ui && nohup npm run dev > /tmp/mtwm-ui.log 2>&1 &', { timeout: 5000 });
          incidents.push({ component: 'ui', issue: 'UI unreachable', action: 'RESTARTED by Tara', timestamp: now });
          console.log('[Tara] RESTARTED UI on :3000');
        } catch {
          incidents.push({ component: 'ui', issue: 'UI unreachable', action: 'restart FAILED', timestamp: now });
        }
      } else if (ui.healthy) { this._activeIncidents.delete('ui'); }

      const allHealthy = apiServer.healthy && tradeEngine.healthy && researchWorker.healthy
        && forexService.healthy && ui.healthy && tunnel.healthy && stateStore.healthy
        && managers.warren && managers.fin && managers.liza && managers.ferd;

      this.lastStatus = {
        timestamp: now,
        all_healthy: allHealthy,
        components: {
          api_server: apiServer,
          trade_engine: tradeEngine,
          research_worker: researchWorker,
          forex_service: forexService,
          ui,
          tunnel,
          state_store: stateStore,
          managers,
        },
        incidents,
      };

      this.store.set('ops_status', JSON.stringify(this.lastStatus));

      // Discord notifications + learnings for new incidents
      for (const inc of incidents) {
        await this.notifyDiscord(inc);
        this.recordLearning(`${inc.component}: ${inc.issue}`, inc.action, 'incident', 0);
      }

      if (this.cycleCount % 20 === 1) {
        const healthyCount = [apiServer, tradeEngine, researchWorker, forexService, ui, tunnel, stateStore]
          .filter(c => c.healthy).length;
        console.log(`[Tara] #${this.cycleCount} | ${healthyCount}/7 components healthy | ${incidents.length} incidents`);
      }
    } catch (e: any) {
      console.error(`[Tara] Cycle error (non-fatal): ${e.message}`);
    }
  }

  private async checkHttp(url: string, maxMs?: number, acceptAny = false): Promise<ComponentHealth> {
    const now = new Date().toISOString();
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        redirect: 'manual',
      });
      const elapsed = Date.now() - t0;
      const ok = acceptAny ? (res.status > 0) : res.ok;
      const healthy = ok && (maxMs ? elapsed < maxMs : true);
      return { healthy, responseMs: elapsed, lastCheck: now };
    } catch {
      return { healthy: false, responseMs: Date.now() - t0, lastCheck: now };
    }
  }

  private checkTradeEngine(): ComponentHealth {
    const now = new Date().toISOString();
    try {
      const raw = this.store.get('trade_engine_status');
      if (!raw) return { healthy: false, staleSecs: -1, lastCheck: now };
      const status = JSON.parse(raw);
      const lastBeat = status.lastHeartbeat || status.timestamp || '';
      const age = Date.now() - new Date(lastBeat).getTime();
      return {
        healthy: age < TRADE_ENGINE_STALE_MS,
        staleSecs: Math.round(age / 1000),
        lastHeartbeat: lastBeat,
        lastCheck: now,
      };
    } catch {
      return { healthy: false, staleSecs: -1, lastCheck: now };
    }
  }

  private checkResearchWorker(): ComponentHealth {
    const now = new Date().toISOString();
    try {
      const stars = this.store.getResearchStars();
      if (stars.length === 0) {
        return { healthy: false, starsCount: 0, lastCheck: now };
      }
      const newest = stars.reduce((a, b) =>
        new Date(a.createdAt) > new Date(b.createdAt) ? a : b,
      );
      const age = Date.now() - new Date(newest.createdAt).getTime();
      return {
        healthy: age < RESEARCH_STALE_MS,
        starsCount: stars.length,
        lastUpdate: newest.createdAt,
        lastCheck: now,
      };
    } catch {
      return { healthy: false, starsCount: 0, lastCheck: now };
    }
  }

  private checkTunnel(): ComponentHealth {
    const now = new Date().toISOString();
    try {
      execSync('pgrep -x cloudflared', { stdio: 'ignore', timeout: 2000 });
      return { healthy: true, lastCheck: now };
    } catch {
      return { healthy: false, lastCheck: now };
    }
  }

  private checkStateStore(): ComponentHealth {
    const now = new Date().toISOString();
    try {
      this.store.set('ops:heartbeat', now);
      const val = this.store.get('ops:heartbeat');
      return { healthy: val === now, lastCheck: now };
    } catch {
      return { healthy: false, lastCheck: now };
    }
  }

  private checkManagers(): { warren: boolean; fin: boolean; liza: boolean; ferd: boolean } {
    const result: Record<string, boolean> = {};
    for (const name of ['warren', 'fin', 'liza', 'ferd']) {
      try {
        const key = name === 'warren' ? 'warren:briefing'
          : `manager_${name}_status`;
        const raw = this.store.get(key) || this.store.get(`manager:${name}:status`);
        if (!raw) { result[name] = false; continue; }
        const parsed = JSON.parse(raw);
        const ts = parsed.timestamp || parsed.lastCycle || '';
        const age = ts ? Date.now() - new Date(ts).getTime() : Infinity;
        result[name] = age < MANAGER_STALE_MS;
      } catch {
        result[name] = false;
      }
    }
    return result as any;
  }

  private async notifyDiscord(incident: Incident): Promise<void> {
    // Dedup by component only — not the changing issue text
    const key = incident.component;
    if (this.notifiedIncidents.has(key)) return;

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `**[Ops Alert]** \`${incident.component}\` -- ${incident.issue}\nAction: ${incident.action}`,
        }),
        signal: AbortSignal.timeout(5000),
      });
      this.notifiedIncidents.add(key);
      // Clear stale notifications every 100 incidents to avoid memory leak
      if (this.notifiedIncidents.size > 100) {
        this.notifiedIncidents.clear();
      }
    } catch {}
  }

  private recordLearning(observation: string, action: string, outcome: string, score: number): void {
    try {
      this.store.saveReport({
        id: `ops-learning-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        agent: 'tara',
        type: 'learning',
        timestamp: new Date().toISOString(),
        summary: observation,
        findings: [action],
        signals: [],
        strategy: { action, rationale: observation, risk: outcome },
        meta: { score, outcome },
      });
    } catch {}
  }
}

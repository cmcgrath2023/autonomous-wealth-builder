/**
 * OpenClaw Autonomy Engine — adapted from Oceanic CRM for MTWM Trading
 *
 * Three-level autonomy: Observe → Suggest → Act
 * All managers (Warren, Fin, Liza, Ferd) register their actions here.
 * The engine runs the heartbeat, coordinates managers, stores learnings,
 * and provides the self-healing loop.
 *
 * Wired into: GatewayStateStore (persistence), AgentDB/RuVector (patterns),
 * Bayesian intelligence (learning).
 */

import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { loadCredentials, getAlpacaHeaders } from './config-bus.js';
import { brain } from './brain-client.js';

export type AutonomyLevel = 'observe' | 'suggest' | 'act';

export interface ActionResult {
  detail: string;
  result: 'success' | 'skipped' | 'error';
  data?: Record<string, unknown>;
}

export interface RegisteredAction {
  agentId: string;
  actionName: string;
  fn: () => Promise<ActionResult>;
  level: AutonomyLevel;
  priority: number; // lower = runs first
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  detail: string;
  result: 'success' | 'skipped' | 'error';
  level: AutonomyLevel;
  durationMs: number;
}

export interface PendingSuggestion {
  id: string;
  agent: string;
  action: string;
  detail: string;
  data?: Record<string, unknown>;
  timestamp: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface Learning {
  agent: string;
  observation: string;
  action: string;
  outcome: string;
  score: number;
  timestamp: string;
}

let _idCounter = 0;
function genId(): string { return `oc-${Date.now()}-${++_idCounter}`; }

export class OpenClawEngine {
  private actions = new Map<string, RegisteredAction>();
  private activityLog: ActivityEntry[] = [];
  private pendingSuggestions: PendingSuggestion[] = [];
  private store: GatewayStateStore;
  private heartbeatMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private heartbeatCount = 0;

  constructor(store: GatewayStateStore, heartbeatMs = 30_000) {
    this.store = store;
    this.heartbeatMs = heartbeatMs;
  }

  // ── Action Registration ──────────────────────────────────────────────

  registerAction(agentId: string, actionName: string, fn: () => Promise<ActionResult>, level: AutonomyLevel = 'act', priority = 50): void {
    const key = `${agentId}:${actionName}`;
    this.actions.set(key, { agentId, actionName, fn, level, priority });
  }

  unregisterAction(agentId: string, actionName: string): void {
    this.actions.delete(`${agentId}:${actionName}`);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[OpenClaw] Engine started — ${this.heartbeatMs / 1000}s cycle, ${this.actions.size} actions registered`);
    this.heartbeat(); // immediate first run
    this.timer = setInterval(() => this.heartbeat(), this.heartbeatMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    console.log(`[OpenClaw] Engine stopped after ${this.heartbeatCount} heartbeats`);
  }

  // ── Heartbeat ────────────────────────────────────────────────────────

  private async heartbeat(): Promise<void> {
    if (!this.running) return;
    this.heartbeatCount++;
    const t0 = Date.now();

    // Sort by priority (lower = first)
    const sorted = [...this.actions.values()].sort((a, b) => a.priority - b.priority);

    for (const action of sorted) {
      if (!this.running) break;
      const actionStart = Date.now();

      try {
        const result = await action.fn();
        const entry: ActivityEntry = {
          id: genId(),
          timestamp: new Date().toISOString(),
          agent: action.agentId,
          action: action.actionName,
          detail: result.detail,
          result: result.result,
          level: action.level,
          durationMs: Date.now() - actionStart,
        };

        this.activityLog.push(entry);
        if (this.activityLog.length > 500) this.activityLog = this.activityLog.slice(-500);

        // Suggest level: queue for human approval
        if (action.level === 'suggest' && result.result === 'success') {
          const suggestion: PendingSuggestion = {
            id: genId(), agent: action.agentId, action: action.actionName,
            detail: result.detail, data: result.data,
            timestamp: new Date().toISOString(), status: 'pending',
          };
          this.pendingSuggestions.push(suggestion);
          // Notify via state store for Discord bot to pick up
          this.store.set('openclaw:pending_suggestion', JSON.stringify(suggestion));
        }

        // Record learning for every action
        this.recordLearning(action.agentId, action.actionName, result);

      } catch (error: any) {
        const entry: ActivityEntry = {
          id: genId(),
          timestamp: new Date().toISOString(),
          agent: action.agentId,
          action: action.actionName,
          detail: `Error: ${error.message}`,
          result: 'error',
          level: action.level,
          durationMs: Date.now() - actionStart,
        };
        this.activityLog.push(entry);
      }
    }

    // Write engine status to state store
    const duration = Date.now() - t0;
    this.store.set('openclaw:status', JSON.stringify({
      running: true,
      heartbeatCount: this.heartbeatCount,
      lastHeartbeat: new Date().toISOString(),
      durationMs: duration,
      actionsRegistered: this.actions.size,
      pendingSuggestions: this.pendingSuggestions.filter(s => s.status === 'pending').length,
    }));

    // Self-healing check: detect and fix issues
    this.selfHeal();

    // Record OpenClaw activity to Brain every 10 heartbeats
    if (this.heartbeatCount % 10 === 0) {
      const actionsRun = this.activityLog.slice(-5).map(a => `${a.agent}:${a.action} → ${a.result}`).join('; ');
      brain.recordRule(`OpenClaw heartbeat #${this.heartbeatCount}: ${actionsRun}`, 'openclaw').catch(() => {});
    }

    if (this.heartbeatCount % 20 === 1) {
      console.log(`[OpenClaw] #${this.heartbeatCount} | ${duration}ms | ${this.actions.size} actions | ${this.pendingSuggestions.filter(s => s.status === 'pending').length} pending`);
    }
  }

  // ── Self-Healing ─────────────────────────────────────────────────────

  private selfHeal(): void {
    // Check if trade engine is responding
    const engineStatus = this.store.get('trade_engine_status');
    if (engineStatus) {
      try {
        const parsed = JSON.parse(engineStatus);
        const age = Date.now() - new Date(parsed.lastHeartbeat || 0).getTime();
        if (age > 5 * 60_000) {
          console.log(`[OpenClaw] HEAL: Trade engine stale (${Math.round(age / 60_000)}m) — requesting restart`);
          this.store.set('restart_request:trade_engine', new Date().toISOString());
        }
      } catch {}
    }

    // Check if research worker is producing stars
    try {
      const stars = this.store.getResearchStars();
      if (stars.length === 0) {
        console.log('[OpenClaw] HEAL: No research stars — research worker may be down');
        this.store.set('restart_request:research_worker', new Date().toISOString());
      }
    } catch {}

    // Check manager health
    for (const name of ['fin', 'liza', 'ferd']) {
      const status = this.store.get(`manager:${name}:status`) || this.store.get(`manager_${name}_status`);
      if (!status) continue;
      try {
        const parsed = JSON.parse(status);
        const age = Date.now() - new Date(parsed.lastCycle || parsed.timestamp || 0).getTime();
        if (age > 5 * 60_000) {
          console.log(`[OpenClaw] HEAL: Manager ${name} stale (${Math.round(age / 60_000)}m)`);
        }
      } catch {}
    }
  }

  // ── Learning ─────────────────────────────────────────────────────────

  private recordLearning(agentId: string, actionName: string, result: ActionResult): void {
    try {
      this.store.saveReport({
        id: `learning-${genId()}`,
        agent: agentId,
        type: 'learning',
        timestamp: new Date().toISOString(),
        summary: `${actionName}: ${result.detail.substring(0, 100)}`,
        findings: [result.detail],
        signals: [],
        strategy: {
          action: actionName,
          rationale: result.detail,
          risk: result.result,
        },
        meta: { outcome: result.result, score: result.result === 'success' ? 1 : result.result === 'error' ? -1 : 0 },
      });
    } catch {} // Non-fatal
  }

  // ── Queries ──────────────────────────────────────────────────────────

  getActivityLog(limit = 50): ActivityEntry[] {
    return this.activityLog.slice(-limit);
  }

  getPendingSuggestions(): PendingSuggestion[] {
    return this.pendingSuggestions.filter(s => s.status === 'pending');
  }

  approveSuggestion(id: string): boolean {
    const s = this.pendingSuggestions.find(x => x.id === id);
    if (!s || s.status !== 'pending') return false;
    s.status = 'approved';
    return true;
  }

  rejectSuggestion(id: string): boolean {
    const s = this.pendingSuggestions.find(x => x.id === id);
    if (!s || s.status !== 'pending') return false;
    s.status = 'rejected';
    return true;
  }

  getRegisteredActions(): Array<{ agentId: string; actionName: string; level: AutonomyLevel; priority: number }> {
    return [...this.actions.values()].map(a => ({ agentId: a.agentId, actionName: a.actionName, level: a.level, priority: a.priority }));
  }

  getLearnings(agent?: string, limit = 20): any[] {
    try {
      return this.store.getReports(agent, limit).filter(r => r.type === 'learning');
    } catch { return []; }
  }

  getStatus(): { running: boolean; heartbeatCount: number; actionsRegistered: number; pendingSuggestions: number } {
    return {
      running: this.running,
      heartbeatCount: this.heartbeatCount,
      actionsRegistered: this.actions.size,
      pendingSuggestions: this.pendingSuggestions.filter(s => s.status === 'pending').length,
    };
  }
}

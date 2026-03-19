import { EventEmitter } from 'events';

export interface AutonomyConfig {
  enabled: boolean;
  heartbeatIntervalMs: number;  // default 30 min
  autonomyLevel: 'observe' | 'suggest' | 'act';  // what agents can do without approval
  nightMode: boolean;  // reduce activity at night
  nightStart: number;  // hour (0-23)
  nightEnd: number;    // hour (0-23)
  enabledAgents: string[];  // which agents are allowed to act autonomously
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  detail: string;
  result: 'success' | 'skipped' | 'error';
  autonomyLevel: string;
}

const DEFAULT_CONFIG: AutonomyConfig = {
  enabled: true,
  heartbeatIntervalMs: 2 * 60 * 1000, // 2 minutes during market hours — aggressive scanning
  autonomyLevel: 'act',
  nightMode: false, // crypto trades 24/7, always be scanning
  nightStart: 99,
  nightEnd: 99,
  enabledAgents: ['neural-trader', 'midstream-feed', 'safla-oversight', 'qudag-witness', 'trait-learner', 'authority-matrix', 'analyst-agent', 'news-desk', 'mincut-optimizer', 'bayesian-intel', 'research-agent', 'options-trader', 'forex-scanner', 'crypto-researcher', 'forex-researcher', 'sector-research', 're-scout', 're-outreach', 're-analyst', 're-portfolio'],
};

export class AutonomyEngine extends EventEmitter {
  private config: AutonomyConfig;
  private activityLog: ActivityEntry[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatCount = 0;
  private startedAt: string | null = null;
  private actions: Map<string, () => Promise<{ detail: string; result: 'success' | 'skipped' | 'error' }>> = new Map();

  constructor() {
    super();
    this.config = { ...DEFAULT_CONFIG };
    // Auto-start heartbeat after a short delay to allow action registrations
    setTimeout(() => {
      if (this.config.enabled) {
        this.startHeartbeat();
      }
    }, 10_000); // 10s delay — gives gateway time to register all actions
  }

  private actionPriority: Map<string, number> = new Map(); // Lower = runs first

  registerAction(agentId: string, actionName: string, fn: () => Promise<{ detail: string; result: 'success' | 'skipped' | 'error' }>, priority: number = 50) {
    this.actions.set(`${agentId}:${actionName}`, fn);
    this.actionPriority.set(`${agentId}:${actionName}`, priority);
  }

  getConfig(): AutonomyConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<AutonomyConfig>) {
    const wasEnabled = this.config.enabled;
    Object.assign(this.config, partial);

    if (this.config.enabled && !wasEnabled) {
      this.startHeartbeat();
    } else if (!this.config.enabled && wasEnabled) {
      this.stopHeartbeat();
    } else if (this.config.enabled && partial.heartbeatIntervalMs) {
      // Restart with new interval
      this.stopHeartbeat();
      this.startHeartbeat();
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.startedAt = new Date().toISOString();
    this.heartbeatCount = 0;

    this.logActivity('autonomy-engine', 'heartbeat_started', `Autonomy enabled — ${this.config.autonomyLevel} mode, interval ${this.config.heartbeatIntervalMs / 1000}s`, 'success');

    // Run immediately, then on interval
    this.runHeartbeat();
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.logActivity('autonomy-engine', 'heartbeat_stopped', `Autonomy disabled after ${this.heartbeatCount} heartbeats`, 'success');
    this.startedAt = null;
  }

  private isNightTime(): boolean {
    if (!this.config.nightMode) return false;
    const hour = new Date().getHours();
    if (this.config.nightStart > this.config.nightEnd) {
      return hour >= this.config.nightStart || hour < this.config.nightEnd;
    }
    return hour >= this.config.nightStart && hour < this.config.nightEnd;
  }

  private async runHeartbeat() {
    this.heartbeatCount++;

    if (this.isNightTime()) {
      this.logActivity('autonomy-engine', 'heartbeat_night', 'Night mode — skipping autonomous actions', 'skipped');
      return;
    }

    // Execute registered actions for enabled agents — sorted by priority (lower = first)
    // Priority tiers: 10=research, 20=execution, 50=analysis, 80=maintenance
    const sortedActions = Array.from(this.actions.entries())
      .sort((a, b) => (this.actionPriority.get(a[0]) || 50) - (this.actionPriority.get(b[0]) || 50));

    for (const [key, fn] of sortedActions) {
      const [agentId, actionName] = key.split(':');
      if (!this.config.enabledAgents.includes(agentId)) continue;

      try {
        this.emit('action:start', { agentId, actionName, timestamp: new Date().toISOString() });
        const { detail, result } = await fn();
        this.logActivity(agentId, actionName, detail, result);
        this.emit('action:complete', { agentId, actionName, detail, result, timestamp: new Date().toISOString() });
      } catch (err: any) {
        const errMsg = err.message || 'unknown';
        this.logActivity(agentId, actionName, `Error: ${errMsg}`, 'error');
        this.emit('action:error', { agentId, actionName, error: errMsg, timestamp: new Date().toISOString() });
      }
    }

    this.emit('heartbeat', { count: this.heartbeatCount, timestamp: new Date().toISOString() });
  }

  private logActivity(agent: string, action: string, detail: string, result: 'success' | 'skipped' | 'error') {
    const entry: ActivityEntry = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      agent,
      action,
      detail,
      result,
      autonomyLevel: this.config.autonomyLevel,
    };
    this.activityLog.unshift(entry);
    // Keep last 500 entries
    if (this.activityLog.length > 500) this.activityLog.length = 500;
  }

  getActivity(limit = 50): ActivityEntry[] {
    return this.activityLog.slice(0, limit);
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      autonomyLevel: this.config.autonomyLevel,
      heartbeatCount: this.heartbeatCount,
      startedAt: this.startedAt,
      isNightMode: this.isNightTime(),
      registeredActions: Array.from(this.actions.keys()),
      recentActivity: this.activityLog.slice(0, 5),
    };
  }
}

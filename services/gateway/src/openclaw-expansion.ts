import { EventEmitter } from 'events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEmitter = any;

export interface OpenClawAgent {
  id: string;
  name: string;
  service: AnyEmitter;
  autonomyLevel: 'observe' | 'suggest' | 'act';
  heartbeatInterval: number;
  enabled: boolean;
  lastHeartbeat: Date | null;
}

export interface OpenClawConfig {
  defaultHeartbeat: number;
  nightModeStart: string; // HH:MM
  nightModeEnd: string;   // HH:MM
  nightModeHeartbeat: number;
}

export class OpenClawExpansion extends EventEmitter {
  private agents: Map<string, OpenClawAgent> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private config: OpenClawConfig;

  constructor(config: OpenClawConfig) {
    super();
    this.config = config;
  }

  registerExpansionServices(services: {
    globalStream: AnyEmitter;
    commoditiesTrader: AnyEmitter;
    dataCenterInfra: AnyEmitter;
  }): void {
    this.agents.set('globalstream', {
      id: 'globalstream',
      name: 'Global Stream',
      service: services.globalStream,
      autonomyLevel: 'observe',
      heartbeatInterval: 60_000,
      enabled: true,
      lastHeartbeat: null,
    });

    this.agents.set('commodities', {
      id: 'commodities',
      name: 'Commodities Trader',
      service: services.commoditiesTrader,
      autonomyLevel: 'act',
      heartbeatInterval: 120_000,
      enabled: true,
      lastHeartbeat: null,
    });

    this.agents.set('datacenter-infra', {
      id: 'datacenter-infra',
      name: 'Data Center Infrastructure',
      service: services.dataCenterInfra,
      autonomyLevel: 'observe',
      heartbeatInterval: 900_000,
      enabled: true,
      lastHeartbeat: null,
    });

    this.wireEventHandlers(services);
  }

  /**
   * Register a single agent dynamically
   */
  registerAgent(
    id: string,
    name: string,
    service: AnyEmitter,
    autonomyLevel: 'observe' | 'suggest' | 'act',
    heartbeatInterval: number
  ): void {
    this.agents.set(id, {
      id,
      name,
      service,
      autonomyLevel,
      heartbeatInterval,
      enabled: true,
      lastHeartbeat: null,
    });

    // Wire standard event handlers
    service.on('signal', (signal: unknown) => {
      const agent = this.agents.get(id);
      if (!agent) return;
      if (agent.autonomyLevel === 'suggest') {
        this.emit('pendingApproval', { agentId: id, signal });
      } else if (agent.autonomyLevel === 'act') {
        this.emit('executeSignal', { agentId: id, signal });
      }
    });

    service.on('heartbeat', (data: unknown) => {
      const agent = this.agents.get(id);
      if (agent) agent.lastHeartbeat = new Date();
      this.emit('agentHeartbeat', { agentId: id, data, timestamp: new Date() });
    });

    service.on('error', (err: unknown) => {
      console.warn(`[OpenClaw Expansion] ${id} error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private wireEventHandlers(services: {
    globalStream: EventEmitter;
    commoditiesTrader: EventEmitter;
    dataCenterInfra: EventEmitter;
  }): void {
    // Global Stream: forward quotes with source tag
    services.globalStream.on('quote', (data: unknown) => {
      this.emit('quote', { source: 'globalstream', data });
    });

    // Commodities Trader: route signals through autonomy level
    services.commoditiesTrader.on('signal', (signal: unknown) => {
      const agent = this.agents.get('commodities');
      if (!agent) return;

      if (agent.autonomyLevel === 'suggest') {
        this.emit('pendingApproval', { agentId: 'commodities', signal });
      } else if (agent.autonomyLevel === 'act') {
        this.emit('executeSignal', { agentId: 'commodities', signal });
      }
    });

    services.commoditiesTrader.on('spreadSignal', (signal: unknown) => {
      this.emit('pendingApproval', { agentId: 'commodities', signal });
    });

    // Data Center Infrastructure: forward infrastructure signals
    services.dataCenterInfra.on('signal', (signal: unknown) => {
      this.emit('infraSignal', { source: 'datacenter-infra', signal });
    });

    // Aggregate heartbeats from all services
    for (const [id, agent] of this.agents) {
      agent.service.on('heartbeat', (data: unknown) => {
        this.emit('agentHeartbeat', { agentId: id, data, timestamp: new Date() });
      });
      // Catch errors from services so they don't crash the process
      agent.service.on('error', (err: unknown) => {
        console.warn(`[OpenClaw Expansion] ${id} error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  startAll(): void {
    for (const [id, agent] of this.agents) {
      if (!agent.enabled) continue;

      // Start the underlying service if it exposes a start() method
      const service = agent.service as EventEmitter & { start?: () => void };
      if (typeof service.start === 'function') {
        service.start();
      }

      // Set up heartbeat timer
      const interval = this.getHeartbeatInterval(agent);
      const timer = setInterval(() => {
        this.onHeartbeat(id);
      }, interval);
      this.heartbeatTimers.set(id, timer);
    }
  }

  stopAll(): void {
    // Clear all heartbeat timers
    for (const [id, timer] of this.heartbeatTimers) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    // Stop underlying services
    for (const [, agent] of this.agents) {
      const service = agent.service as EventEmitter & { stop?: () => void };
      if (typeof service.stop === 'function') {
        service.stop();
      }
    }
  }

  getHeartbeatInterval(agent: OpenClawAgent): number {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = this.config.nightModeStart.split(':').map(Number);
    const [endH, endM] = this.config.nightModeEnd.split(':').map(Number);
    const nightStart = startH * 60 + startM;
    const nightEnd = endH * 60 + endM;

    let inNightMode: boolean;
    if (nightStart <= nightEnd) {
      // Same-day window (e.g. 22:00 – 23:00 wouldn't wrap)
      inNightMode = currentMinutes >= nightStart && currentMinutes < nightEnd;
    } else {
      // Overnight window (e.g. 22:00 – 06:00)
      inNightMode = currentMinutes >= nightStart || currentMinutes < nightEnd;
    }

    return inNightMode ? this.config.nightModeHeartbeat : agent.heartbeatInterval;
  }

  setAutonomyLevel(agentId: string, level: 'observe' | 'suggest' | 'act'): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const previous = agent.autonomyLevel;
    agent.autonomyLevel = level;
    this.emit('autonomyChanged', { agentId, previous, current: level });
  }

  getStatus(): OpenClawAgent[] {
    return Array.from(this.agents.values());
  }

  private onHeartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.lastHeartbeat = new Date();
    this.emit('agentHeartbeat', {
      agentId,
      timestamp: agent.lastHeartbeat,
      interval: this.getHeartbeatInterval(agent),
    });
  }
}

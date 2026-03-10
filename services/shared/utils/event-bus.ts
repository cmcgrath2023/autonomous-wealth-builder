import EventEmitter from 'eventemitter3';

export interface EventMap {
  // Trading signals
  'signal:new': { signalId: string; ticker: string; direction: string; confidence: number };
  'signal:executed': { signalId: string; orderId: string };

  // Trades
  'trade:executed': { ticker: string; shares: number; price: number; side: string };
  'trade:closed': { ticker: string; success: boolean; returnPct: number; pnl: number; reason: string };

  // Decisions
  'decision:created': { decisionId: string; authority: string };
  'decision:resolved': { decisionId: string; status: string };
  'pendingApproval': { decisionId: string; ticker: string; direction: string; amount: number };

  // Risk & governance
  'risk:alert': { metric: string; value: number; threshold: number };
  'witness:recorded': { hash: string; action: string };
  'safla:drift': { metric: string; value: number };

  // Market & portfolio
  'market:update': { ticker: string; price: number };
  'portfolio:snapshot': { totalValue: number; rvfId: string };

  // Intelligence
  'intelligence:updated': { beliefId: string; posterior: number; agentSource: string; insight: string };

  // Real estate tasks
  'property:scored': { propertyId: string; score: number };
  're_task:started': { taskId: string; title: string; category: string };
  're_task:completed': { taskId: string; title: string; summary: string; runCount: number };
  're_task:error': { taskId: string; title: string; error: string };

  // AG-UI telemetry
  'telemetry:step': { agentId: string; step: string; [key: string]: any };
}

class EventBus extends EventEmitter {
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean;
  emit(event: string, ...args: any[]): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof EventMap>(event: K, fn: (payload: EventMap[K]) => void): this;
  on(event: string, fn: (...args: any[]) => void): this;
  on(event: string, fn: (...args: any[]) => void): this {
    return super.on(event, fn);
  }
}

export const eventBus = new EventBus();

// Keep backward compat
export type ServiceEvent = { type: keyof EventMap; payload: EventMap[keyof EventMap] };

/**
 * AG-UI Protocol — Server-Sent Events stream for MTWM
 * Streams all agent activity, signals, heartbeats, decisions, and state to the frontend
 */

import type { Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEventEmitter = any;

// AG-UI Event Types (from @ag-ui/core)
const EventType = {
  RUN_STARTED: 'RUN_STARTED',
  RUN_FINISHED: 'RUN_FINISHED',
  RUN_ERROR: 'RUN_ERROR',
  STEP_STARTED: 'STEP_STARTED',
  STEP_FINISHED: 'STEP_FINISHED',
  TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
  TOOL_CALL_START: 'TOOL_CALL_START',
  TOOL_CALL_ARGS: 'TOOL_CALL_ARGS',
  TOOL_CALL_END: 'TOOL_CALL_END',
  STATE_SNAPSHOT: 'STATE_SNAPSHOT',
  STATE_DELTA: 'STATE_DELTA',
  CUSTOM: 'CUSTOM',
} as const;

interface AGUIEvent {
  type: string;
  timestamp: string;
  runId?: string;
  messageId?: string;
  [key: string]: unknown;
}

interface ConnectedClient {
  id: string;
  res: Response;
  connectedAt: Date;
  filters?: string[]; // optional event type filters
}

export class AGUIStream {
  private clients: Map<string, ConnectedClient> = new Map();
  private eventLog: AGUIEvent[] = [];
  private maxLogSize = 500;
  private runCounter = 0;

  /**
   * SSE endpoint handler — clients connect here
   */
  handleConnection(req: Request, res: Response): void {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filters = req.query.filter ? String(req.query.filter).split(',') : undefined;

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial state snapshot
    this.sendToClient(res, {
      type: EventType.STATE_SNAPSHOT,
      timestamp: new Date().toISOString(),
      snapshot: {
        connectedClients: this.clients.size + 1,
        recentEvents: this.eventLog.slice(-20),
      },
    });

    this.clients.set(clientId, {
      id: clientId,
      res,
      connectedAt: new Date(),
      filters,
    });

    // Keepalive ping every 15s
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      this.clients.delete(clientId);
    });
  }

  /**
   * Wire all MTWM event sources to the AG-UI stream
   */
  wireEventSources(sources: {
    eventBus: AnyEventEmitter;
    openClawExpansion: AnyEventEmitter;
    autonomyEngine?: AnyEventEmitter;
    bayesianIntel?: { getCollectiveIntelligence?: () => unknown };
  }): void {
    const { eventBus, openClawExpansion } = sources;

    // --- Deep Telemetry (real-time agent reasoning steps) ---
    eventBus.on('telemetry:step', (payload: any) => {
      const { agentId, step, ...data } = payload;
      this.emitStep(agentId, step, data);
    });

    // --- Core Trading Events ---
    eventBus.on('signal:new', (payload: any) => {
      this.emitStep('neural-trader', 'signal_generated', {
        ticker: payload.ticker,
        direction: payload.direction,
        confidence: payload.confidence,
      });
    });

    eventBus.on('trade:executed', (payload: any) => {
      this.emitToolCall('executor', 'execute_trade', {
        side: payload.side,
        ticker: payload.ticker,
        shares: payload.shares,
        price: payload.price,
      });
    });

    eventBus.on('trade:closed', (payload: any) => {
      this.emitStep('position-manager', 'trade_closed', {
        ticker: payload.ticker,
        success: payload.success,
        returnPct: payload.returnPct,
        pnl: payload.pnl,
        reason: payload.reason,
      });
    });

    eventBus.on('decision:created', (payload: any) => {
      this.emitStep('authority-matrix', 'decision_created', {
        decisionId: payload.decisionId,
        authority: payload.authority,
      });
    });

    eventBus.on('risk:alert', (payload: any) => {
      this.emitMessage('risk-controls', `RISK ALERT: ${payload.metric} = ${payload.value} (threshold: ${payload.threshold})`);
    });

    eventBus.on('intelligence:updated', (payload: any) => {
      this.emitStateDelta('/intelligence', {
        beliefId: payload.beliefId,
        posterior: payload.posterior,
        agentSource: payload.agentSource,
      });
    });

    // --- OpenClaw Expansion Events ---
    openClawExpansion.on('quote', (data: any) => {
      this.emitCustom('market_quote', {
        source: data.source,
        symbol: data.data?.symbol,
        price: data.data?.price,
        change: data.data?.change,
      });
    });

    openClawExpansion.on('pendingApproval', (data: any) => {
      this.emitStep(data.agentId, 'pending_approval', {
        type: data.type,
        signal: data.signal,
      });
    });

    openClawExpansion.on('executeSignal', (data: any) => {
      this.emitToolCall(data.agentId, 'auto_execute', data.signal);
    });

    openClawExpansion.on('infraSignal', (data: any) => {
      this.emitStep('datacenter-infra', 'supply_chain_signal', {
        category: data.signal?.category,
        trigger: data.signal?.trigger,
        confidence: data.signal?.confidence,
      });
    });

    openClawExpansion.on('agentHeartbeat', (data: any) => {
      this.emitCustom('agent_heartbeat', {
        agentId: data.agentId,
        data: data.data,
        timestamp: data.timestamp,
      });
    });

    openClawExpansion.on('autonomyChanged', (data: any) => {
      this.emitMessage('openclaw', `Agent ${data.agentId} autonomy changed: ${data.previous} → ${data.current}`);
    });

    // --- Real Estate Task Events ---
    eventBus.on('re_task:started', (payload: any) => {
      const runId = this.emitRunStarted('re-agent');
      this.emitStep('re-agent', 'task_started', {
        taskId: payload.taskId,
        title: payload.title,
        category: payload.category,
      });
      // Store runId for matching completion (keyed by taskId)
      (this as any)._reTaskRuns = (this as any)._reTaskRuns || {};
      (this as any)._reTaskRuns[payload.taskId] = runId;
    });

    eventBus.on('re_task:completed', (payload: any) => {
      this.emitStep('re-agent', 'task_completed', {
        taskId: payload.taskId,
        title: payload.title,
        summary: payload.summary,
        runCount: payload.runCount,
      });
      const runId = (this as any)._reTaskRuns?.[payload.taskId];
      if (runId) this.emitRunFinished(runId);
    });

    eventBus.on('re_task:error', (payload: any) => {
      this.emitMessage('re-agent', `RE Task failed: ${payload.title} — ${payload.error}`);
      const runId = (this as any)._reTaskRuns?.[payload.taskId];
      if (runId) this.emitRunError(runId, payload.error);
    });

    // --- Autonomy Engine (Analyst Agent, Bayesian Intel, etc.) ---
    const { autonomyEngine } = sources;
    if (autonomyEngine) {
      autonomyEngine.on('action:start', (data: any) => {
        this.emitStep(data.agentId, `${data.actionName}_started`, {
          agentId: data.agentId,
          action: data.actionName,
        });
      });

      autonomyEngine.on('action:complete', (data: any) => {
        this.emitStep(data.agentId, `${data.actionName}_completed`, {
          agentId: data.agentId,
          action: data.actionName,
          detail: data.detail,
          result: data.result,
        });
      });

      autonomyEngine.on('action:error', (data: any) => {
        this.emitMessage(data.agentId, `${data.actionName} error: ${data.error}`);
      });

      autonomyEngine.on('heartbeat', (data: any) => {
        this.emitCustom('autonomy_heartbeat', {
          count: data.count,
          timestamp: data.timestamp,
        });
      });
    }
  }

  // --- AG-UI Event Emitters ---

  emitRunStarted(agentId: string): string {
    const runId = `run-${++this.runCounter}-${Date.now()}`;
    this.broadcast({
      type: EventType.RUN_STARTED,
      timestamp: new Date().toISOString(),
      runId,
      threadId: agentId,
    });
    return runId;
  }

  emitRunFinished(runId: string): void {
    this.broadcast({
      type: EventType.RUN_FINISHED,
      timestamp: new Date().toISOString(),
      runId,
    });
  }

  emitRunError(runId: string, error: string): void {
    this.broadcast({
      type: EventType.RUN_ERROR,
      timestamp: new Date().toISOString(),
      runId,
      message: error,
    });
  }

  emitStep(agentId: string, stepName: string, data: Record<string, unknown>): void {
    const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.broadcast({
      type: EventType.STEP_STARTED,
      timestamp: new Date().toISOString(),
      stepId,
      agentId,
      stepName,
    });
    this.broadcast({
      type: EventType.STEP_FINISHED,
      timestamp: new Date().toISOString(),
      stepId,
      agentId,
      stepName,
      data,
    });
  }

  emitMessage(agentId: string, content: string): void {
    const messageId = `msg-${Date.now()}`;
    this.broadcast({
      type: EventType.TEXT_MESSAGE_START,
      timestamp: new Date().toISOString(),
      messageId,
      role: 'assistant',
      agentId,
    });
    this.broadcast({
      type: EventType.TEXT_MESSAGE_CONTENT,
      timestamp: new Date().toISOString(),
      messageId,
      delta: content,
    });
    this.broadcast({
      type: EventType.TEXT_MESSAGE_END,
      timestamp: new Date().toISOString(),
      messageId,
    });
  }

  emitToolCall(agentId: string, toolName: string, args: Record<string, unknown>): void {
    const toolCallId = `tc-${Date.now()}`;
    this.broadcast({
      type: EventType.TOOL_CALL_START,
      timestamp: new Date().toISOString(),
      toolCallId,
      toolCallName: toolName,
      agentId,
    });
    this.broadcast({
      type: EventType.TOOL_CALL_ARGS,
      timestamp: new Date().toISOString(),
      toolCallId,
      delta: JSON.stringify(args),
    });
    this.broadcast({
      type: EventType.TOOL_CALL_END,
      timestamp: new Date().toISOString(),
      toolCallId,
    });
  }

  emitStateSnapshot(state: Record<string, unknown>): void {
    this.broadcast({
      type: EventType.STATE_SNAPSHOT,
      timestamp: new Date().toISOString(),
      snapshot: state,
    });
  }

  emitStateDelta(path: string, value: unknown): void {
    this.broadcast({
      type: EventType.STATE_DELTA,
      timestamp: new Date().toISOString(),
      delta: [{ op: 'replace', path, value }],
    });
  }

  emitCustom(name: string, data: Record<string, unknown>): void {
    this.broadcast({
      type: EventType.CUSTOM,
      timestamp: new Date().toISOString(),
      name,
      ...data,
    });
  }

  // --- Internal ---

  private broadcast(event: AGUIEvent): void {
    // Store in log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    // Send to all connected clients
    for (const [, client] of this.clients) {
      if (client.filters && !client.filters.includes(event.type)) continue;
      this.sendToClient(client.res, event);
    }
  }

  private sendToClient(res: Response, event: AGUIEvent): void {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected
    }
  }

  getRecentEvents(limit = 50): AGUIEvent[] {
    return this.eventLog.slice(-limit);
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

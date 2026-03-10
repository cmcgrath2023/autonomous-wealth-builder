/**
 * WebhookRelay — Pushes filtered actionable events to a Cloudflare Worker endpoint
 * Events are HMAC-SHA256 signed, batched within a time window, and fire-and-forget.
 */

import { EventEmitter } from 'events';
import { createHmac } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEventEmitter = any;

export interface WebhookRelayConfig {
  url: string;
  secret: string;
  enabled: boolean;
  batchMs: number; // batch window in ms (default 5000)
}

interface RelayEvent {
  category: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export class WebhookRelay extends EventEmitter {
  private config: WebhookRelayConfig;
  private batch: RelayEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private stats = { sent: 0, failed: 0, events: 0 };

  constructor(config: Partial<WebhookRelayConfig> & { url?: string; secret?: string }) {
    super();
    this.config = {
      url: config.url || '',
      secret: config.secret || '',
      enabled: config.enabled ?? false,
      batchMs: config.batchMs ?? 5000,
    };
  }

  wireEventSources(sources: {
    eventBus: AnyEventEmitter;
    openClawExpansion: AnyEventEmitter;
  }): void {
    if (!this.config.enabled) return;

    const { eventBus, openClawExpansion } = sources;

    // Trade signals
    eventBus.on('signal:new', (p: any) => {
      this.enqueue('trade_signal', {
        ticker: p.ticker, direction: p.direction, confidence: p.confidence,
      });
    });

    // Trade executions
    eventBus.on('trade:executed', (p: any) => {
      this.enqueue('trade_execution', {
        ticker: p.ticker, side: p.side, shares: p.shares, price: p.price,
      });
    });

    // Trade closures
    eventBus.on('trade:closed', (p: any) => {
      this.enqueue('trade_closure', {
        ticker: p.ticker, success: p.success, returnPct: p.returnPct, pnl: p.pnl, reason: p.reason,
      });
    });

    // Risk alerts
    eventBus.on('risk:alert', (p: any) => {
      this.enqueue('risk_alert', {
        metric: p.metric, value: p.value, threshold: p.threshold,
      });
    });

    // RE task completions
    eventBus.on('re_task:completed', (p: any) => {
      this.enqueue('re_task_complete', {
        taskId: p.taskId, title: p.title, summary: p.summary,
      });
    });

    // RE task errors
    eventBus.on('re_task:error', (p: any) => {
      this.enqueue('agent_error', {
        source: 're-agent', taskId: p.taskId, title: p.title, error: p.error,
      });
    });

    // Pending approvals from expansion agents
    openClawExpansion.on('pendingApproval', (p: any) => {
      this.enqueue('pending_approval', {
        agentId: p.agentId, signal: p.signal,
      });
    });
  }

  private enqueue(category: string, data: Record<string, unknown>): void {
    this.batch.push({
      category,
      timestamp: new Date().toISOString(),
      data,
    });
    this.stats.events++;

    // Start batch timer if not running
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flush(), this.config.batchMs);
    }
  }

  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.batch.length === 0) return;

    const events = this.batch.splice(0);
    const body = JSON.stringify({
      events,
      batchId: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sentAt: new Date().toISOString(),
    });

    const signature = createHmac('sha256', this.config.secret)
      .update(body)
      .digest('hex');

    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        this.stats.sent++;
        this.emit('relay:sent', { count: events.length });
      } else {
        this.stats.failed++;
        console.warn(`[WebhookRelay] POST failed: ${res.status}`);
      }
    } catch (err: any) {
      this.stats.failed++;
      console.warn(`[WebhookRelay] Network error: ${err.message}`);
    }
  }

  getStats() {
    return { ...this.stats, enabled: this.config.enabled, url: this.config.url };
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}

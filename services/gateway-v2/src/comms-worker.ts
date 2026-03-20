/**
 * Comms Worker — Notification dispatcher + conversational interface
 *
 * Reads events from state store, dispatches to Discord/Telegram/Slack.
 * Users can converse with the team (Warren, Fin, Liza, Ferd) via Discord.
 * Messages formatted for A2A compatibility (agent: string, content: string, type: string).
 *
 * 30-second poll cycle.
 */

import { GatewayStateStore } from '../../gateway/src/state-store.js';

const CYCLE_MS = 30_000;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || '';

interface CommsMessage {
  agent: string;        // warren, fin, liza, ferd, system
  content: string;      // the message
  type: 'briefing' | 'alert' | 'trade' | 'research' | 'error' | 'learning';
  priority: 'low' | 'normal' | 'high' | 'critical';
  timestamp: string;
}

export class CommsWorker {
  private store: GatewayStateStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastProcessed = '';
  private lastPostTime = Date.now();
  private _lastEventSig = '';
  private _lastTradeSig = '';
  private running = false;
  private sentMessages = new Set<string>(); // dedup

  constructor(dbPath: string) {
    this.store = new GatewayStateStore(dbPath);
  }

  start(): void {
    this.running = true;
    const channels: string[] = [];
    if (DISCORD_WEBHOOK) channels.push('Discord');
    if (TELEGRAM_BOT_TOKEN) channels.push('Telegram');
    if (SLACK_WEBHOOK) channels.push('Slack');
    console.log(`[Comms] Worker online — channels: ${channels.length > 0 ? channels.join(', ') : 'NONE (set DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN, or SLACK_WEBHOOK_URL)'}`);

    this.cycle();
    this.timer = setInterval(() => this.cycle(), CYCLE_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.store.close();
    console.log('[Comms] Offline');
  }

  private async cycle(): Promise<void> {
    if (!this.running) return;

    try {
      const messages = this.collectMessages();
      for (const msg of messages) {
        const key = `${msg.agent}:${msg.type}:${msg.content.substring(0, 50)}`;
        if (this.sentMessages.has(key)) continue;
        this.sentMessages.add(key);
        // Keep dedup set manageable
        if (this.sentMessages.size > 500) {
          const arr = [...this.sentMessages];
          this.sentMessages = new Set(arr.slice(-250));
        }

        await this.dispatch(msg);
      }
    } catch (e: any) {
      console.error(`[Comms] Cycle error: ${e.message}`);
    }
  }

  private collectMessages(): CommsMessage[] {
    const messages: CommsMessage[] = [];
    const now = new Date().toISOString();

    // Warren's briefing — only post when content meaningfully changes
    try {
      const briefingRaw = this.store.get('warren:briefing');
      if (briefingRaw) {
        const briefing = JSON.parse(briefingRaw);
        // Create a signature from the key metrics — only post if these change
        const sig = `${briefing.urgency}|${Math.round(briefing.dailyPnl / 50) * 50}|${briefing.positions}`;
        const changed = sig !== this.lastProcessed;

        if (changed) {
          this.lastProcessed = sig;
          this.lastPostTime = Date.now();
          const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
          messages.push({
            agent: 'warren',
            content: `[${time} ET] ${briefing.narrative}`,
            type: 'briefing',
            priority: briefing.urgency === 'critical' ? 'critical' : briefing.urgency === 'elevated' ? 'high' : 'normal',
            timestamp: briefing.timestamp,
          });
        }
      }
    } catch {}

    // Critical events from Liza — only post ONCE when new events appear
    try {
      const events = this.store.get('critical_events');
      if (events) {
        const eventSig = events.substring(0, 100); // signature from first 100 chars
        if (eventSig !== this._lastEventSig) {
          this._lastEventSig = eventSig;
          const parsed = JSON.parse(events);
          if (Array.isArray(parsed) && parsed.length > 0) {
            messages.push({
              agent: 'liza',
              content: `CRITICAL EVENTS: ${parsed.slice(0, 3).join(' | ')}`,
              type: 'alert',
              priority: 'critical',
              timestamp: now,
          });
        }
      }
    } catch {}

    // Trade executions — only post NEW trades (compare signature)
    try {
      const status = this.store.get('trade_engine_status');
      if (status) {
        const parsed = JSON.parse(status);
        const actions = parsed.recentActivity || [];
        const trades = actions.filter((a: any) => a.detail?.includes('BUY') || a.detail?.includes('SELL') || a.detail?.includes('BANKED'));
        const tradeSig = trades.map((t: any) => t.detail?.substring(0, 30)).join('|');
        if (tradeSig === this._lastTradeSig || trades.length === 0) { /* skip */ }
        else {
          this._lastTradeSig = tradeSig;
        for (const trade of trades.slice(0, 3)) {
          messages.push({
            agent: 'fin',
            content: trade.detail,
            type: 'trade',
            priority: 'high',
            timestamp: trade.timestamp || now,
          });
        }
        }
      }
    } catch {}

    return messages;
  }

  private async dispatch(msg: CommsMessage): Promise<void> {
    const formatted = this.formatMessage(msg);

    if (DISCORD_WEBHOOK) await this.sendDiscord(formatted, msg);
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) await this.sendTelegram(formatted);
    if (SLACK_WEBHOOK) await this.sendSlack(formatted, msg);
  }

  private formatMessage(msg: CommsMessage): string {
    const icon = msg.agent === 'warren' ? '👔' : msg.agent === 'fin' ? '📊' : msg.agent === 'liza' ? '📰' : msg.agent === 'ferd' ? '🔬' : '⚙️';
    const name = msg.agent.charAt(0).toUpperCase() + msg.agent.slice(1);
    const priority = msg.priority === 'critical' ? '🚨' : msg.priority === 'high' ? '⚡' : '';
    return `${icon} **${name}** ${priority}\n${msg.content}`;
  }

  private async sendDiscord(text: string, msg: CommsMessage): Promise<void> {
    try {
      await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text.substring(0, 2000),
          username: `MTWM ${msg.agent.charAt(0).toUpperCase() + msg.agent.slice(1)}`,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e: any) {
      console.error(`[Comms] Discord error: ${e.message}`);
    }
  }

  private async sendTelegram(text: string): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: text.replace(/\*\*/g, '*'), // Telegram uses single * for bold
          parse_mode: 'Markdown',
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e: any) {
      console.error(`[Comms] Telegram error: ${e.message}`);
    }
  }

  private async sendSlack(text: string, msg: CommsMessage): Promise<void> {
    try {
      await fetch(SLACK_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.replace(/\*\*/g, '*'),
          username: `MTWM ${msg.agent}`,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e: any) {
      console.error(`[Comms] Slack error: ${e.message}`);
    }
  }

  getStatus(): { running: boolean; channels: string[] } {
    const channels: string[] = [];
    if (DISCORD_WEBHOOK) channels.push('discord');
    if (TELEGRAM_BOT_TOKEN) channels.push('telegram');
    if (SLACK_WEBHOOK) channels.push('slack');
    return { running: this.running, channels };
  }
}

// Standalone mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.env.GATEWAY_DB_PATH || 'data/gateway-state.db';
  const worker = new CommsWorker(dbPath);
  worker.start();
  process.on('SIGTERM', () => worker.stop());
  process.on('SIGINT', () => worker.stop());
}

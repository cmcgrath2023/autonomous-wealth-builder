/**
 * Fin — Trading Manager (OpenClaw Pattern)
 *
 * Monitors all trading operations on a 60-second heartbeat.
 * Self-heals stale trade engines, tracks daily P&L vs $500 goal,
 * tightens trailing stops on big winners, banks outsized positions.
 */

import { GatewayStateStore } from '../../../gateway/src/state-store.js';
import { loadCredentials, getAlpacaHeaders } from '../config-bus.js';

const LOOP_MS = 60_000;
const ENGINE_STALE_MS = 5 * 60_000;
const DAILY_GOAL = 500;
const TRAILING_TIGHTEN_THRESHOLD = 100;
const OUTSIZED_WINNER_THRESHOLD = 500;
const ALPACA_TRADE_URL = 'https://paper-api.alpaca.markets';

interface FinStatus {
  lastCycle: string;
  cycleCount: number;
  dailyPnl: number;
  goalProgress: number;
  engineHealthy: boolean;
  actions: string[];
}

export class Fin {
  private store: GatewayStateStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;
  private lastStatus: FinStatus | null = null;

  constructor(dbPath: string) {
    this.store = new GatewayStateStore(dbPath);
  }

  async start(): Promise<void> {
    console.log('[Fin] Trading Manager starting — 60s loop');
    await this.cycle();
    this.timer = setInterval(() => {
      this.cycle().catch((e) => console.error('[Fin] Cycle error (non-fatal):', e));
    }, LOOP_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { this.store.close(); } catch {}
    console.log('[Fin] Stopped');
  }

  getStatus(): FinStatus | null {
    return this.lastStatus;
  }

  private async cycle(): Promise<void> {
    this.cycleCount++;
    const actions: string[] = [];
    const now = new Date().toISOString();

    try {
      // 1. Check trade engine heartbeat
      const engineHealthy = this.checkEngineHealth(actions);

      // 2. Read daily P&L and track goal
      const dailyPnl = this.readDailyPnl();
      const goalProgress = Math.min((dailyPnl / DAILY_GOAL) * 100, 100);
      if (dailyPnl >= DAILY_GOAL) {
        actions.push(`GOAL MET: $${dailyPnl.toFixed(2)} >= $${DAILY_GOAL}`);
      } else {
        const remaining = DAILY_GOAL - dailyPnl;
        actions.push(`P&L: $${dailyPnl.toFixed(2)} — need $${remaining.toFixed(2)} more`);
      }

      // 3. Adjust urgency based on goal progress
      this.writeUrgency(goalProgress);

      // 4. Check positions for trailing stop tightening and outsized winners
      await this.monitorPositions(actions);

      // 5. Write status to state store
      this.lastStatus = {
        lastCycle: now, cycleCount: this.cycleCount,
        dailyPnl, goalProgress, engineHealthy, actions,
      };
      this.store.set('manager_fin_status', JSON.stringify(this.lastStatus));

      if (this.cycleCount % 5 === 1) {
        console.log(`[Fin] #${this.cycleCount} | P&L: $${dailyPnl.toFixed(2)} (${goalProgress.toFixed(0)}%) | Engine: ${engineHealthy ? 'OK' : 'STALE'} | ${actions.length} actions`);
      }
    } catch (e: any) {
      console.error(`[Fin] Cycle #${this.cycleCount} error:`, e.message);
    }
  }

  private checkEngineHealth(actions: string[]): boolean {
    try {
      const raw = this.store.get('trade_engine_status');
      if (!raw) { actions.push('Engine: no status found'); return false; }
      const status = JSON.parse(raw);
      const lastBeat = new Date(status.lastHeartbeat).getTime();
      const age = Date.now() - lastBeat;

      if (age > ENGINE_STALE_MS) {
        actions.push(`Engine STALE: last heartbeat ${Math.round(age / 60_000)}m ago`);
        this.store.set('restart_request', JSON.stringify({
          target: 'trade_engine', reason: 'stale_heartbeat',
          requestedBy: 'fin', requestedAt: new Date().toISOString(), ageMs: age,
        }));
        console.log(`[Fin] ALERT: Trade engine stale (${Math.round(age / 60_000)}m) — restart requested`);
        return false;
      }
      return true;
    } catch {
      actions.push('Engine: status read error');
      return false;
    }
  }

  private readDailyPnl(): number {
    try {
      const trades = this.store.getTodayTrades();
      return trades.reduce((sum, t) => sum + t.pnl, 0);
    } catch { return 0; }
  }

  private writeUrgency(goalProgress: number): void {
    const urgency = goalProgress >= 100 ? 'low' : goalProgress >= 60 ? 'medium' : 'high';
    try {
      this.store.set('trading_urgency', JSON.stringify({
        level: urgency, goalProgress, updatedBy: 'fin', updatedAt: new Date().toISOString(),
      }));
    } catch {}
  }

  private async monitorPositions(actions: string[]): Promise<void> {
    const headers = getAlpacaHeaders();
    if (!headers) return;

    const creds = loadCredentials();
    const baseUrl = creds.alpaca?.baseUrl || ALPACA_TRADE_URL;

    try {
      const res = await fetch(`${baseUrl}/v2/positions`, {
        headers: { 'APCA-API-KEY-ID': headers['APCA-API-KEY-ID'], 'APCA-API-SECRET-KEY': headers['APCA-API-SECRET-KEY'] },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) { actions.push(`Positions fetch: ${res.status}`); return; }
      const positions = (await res.json()) as any[];

      for (const pos of positions) {
        const unrealized = parseFloat(pos.unrealized_pl || '0');
        const symbol = pos.symbol;
        const qty = parseFloat(pos.qty || '0');

        // Bank outsized winners (> $500 unrealized)
        if (unrealized > OUTSIZED_WINNER_THRESHOLD && qty > 0) {
          actions.push(`BANKING ${symbol}: $${unrealized.toFixed(2)} unrealized`);
          await this.sellPosition(baseUrl, headers, symbol, qty, actions);
          continue;
        }

        // Tighten trailing stop on positions > $100 unrealized
        if (unrealized > TRAILING_TIGHTEN_THRESHOLD) {
          const avgEntry = parseFloat(pos.avg_entry_price || '0');
          const tightStop = avgEntry + (unrealized * 0.6 / qty);
          this.store.set(`trailing_stop_${symbol}`, JSON.stringify({
            symbol, stop: tightStop, unrealized, tightenedBy: 'fin',
            updatedAt: new Date().toISOString(),
          }));
          actions.push(`TIGHTENED ${symbol}: stop -> $${tightStop.toFixed(2)} (unrealized $${unrealized.toFixed(2)})`);
        }
      }
    } catch (e: any) {
      actions.push(`Position monitor error: ${e.message}`);
    }
  }

  private async sellPosition(
    baseUrl: string, headers: Record<string, string>,
    symbol: string, qty: number, actions: string[],
  ): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/v2/orders`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, qty: String(qty), side: 'sell', type: 'market', time_in_force: 'day' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        actions.push(`SOLD ${symbol} x${qty}`);
      } else {
        const body = await res.text();
        actions.push(`SELL FAILED ${symbol}: ${res.status} ${body}`);
      }
    } catch (e: any) {
      actions.push(`SELL ERROR ${symbol}: ${e.message}`);
    }
  }
}

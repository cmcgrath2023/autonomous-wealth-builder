/**
 * Fin — Trading Manager (OpenClaw Pattern)
 *
 * Monitors all trading operations on a 60-second heartbeat.
 * Self-heals stale trade engines, tracks daily P&L vs $500 goal,
 * tightens trailing stops on big winners, banks outsized positions.
 */

import { GatewayStateStore } from '../../../gateway/src/state-store.js';
import { loadCredentials, getAlpacaHeaders } from '../config-bus.js';
import { brain } from '../brain-client.js';
import { recordClosedTrade } from '../trade-recorder.js';

async function postToDiscord(text: string): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `📊 **Fin** ⚡\n${text}` }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

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

      // 4. Read Warren's directive and ACT on it
      const directive = this.store.get('fin:directive') || 'steady_as_she_goes';
      const urgency = this.store.get('warren:urgency') || 'normal';

      if (urgency === 'critical') {
        // CRITICAL: market is losing money — tighten everything, consider cutting losers
        actions.push(`URGENCY: ${urgency} — tightening stops, cutting losers`);
        await this.emergencyCuts(actions);
      } else if (urgency === 'elevated') {
        actions.push(`URGENCY: ${urgency} — watching closely`);
      }

      // 5. Check positions for trailing stop tightening and outsized winners
      await this.monitorPositions(actions);

      // 5b. Read Warren's directive and team review — act on it
      const warrenDirective = this.store.get('fin:directive') || '';
      const warrenReview = this.store.get('warren:team_review');
      if (warrenDirective === 'fill_open_slots') {
        actions.push('WARREN: fill open slots — scanning for opportunities');
      }
      if (warrenDirective === 'tighten_stops_reduce_exposure') {
        actions.push('WARREN: tightening stops per directive');
      }
      if (warrenReview && this.cycleCount % 10 === 0) {
        try {
          const review = JSON.parse(warrenReview);
          console.log(`[Fin] Reading Warren's review: ${review.review?.substring(0, 100)}`);
        } catch {}
      }

      // 6. Brain-powered trading analysis — Fin thinks like an ex-Citi analyst
      // Every 15 cycles (~15 min), Fin queries Brain for patterns and trains SONA
      if (this.cycleCount % 15 === 0) {
        try {
          await this.brainAnalysis(dailyPnl, goalProgress, actions);
        } catch (e: any) {
          console.error(`[Fin] Brain analysis error: ${e.message}`);
        }
      }

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
          await this.sellPosition(baseUrl, headers, symbol, qty, actions, {
            reason: 'fin_bank_winner',
            entryPrice: parseFloat(pos.avg_entry_price || '0') || null,
            exitPrice: parseFloat(pos.current_price || '0') || 0,
            pnl: unrealized,
          });
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

  private async emergencyCuts(actions: string[]): Promise<void> {
    // CRITICAL urgency: cut any position losing more than $30
    const headers = getAlpacaHeaders();
    if (!headers) return;
    const creds = loadCredentials();
    const baseUrl = creds.alpaca?.baseUrl || ALPACA_TRADE_URL;

    try {
      const res = await fetch(`${baseUrl}/v2/positions`, {
        headers, signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const positions = (await res.json()) as any[];

      for (const pos of positions) {
        const pnl = parseFloat(pos.unrealized_pl || '0');
        const symbol = pos.symbol;
        const qty = Math.abs(parseFloat(pos.qty || '0'));

        if (pnl < -30) {
          console.log(`[Fin] EMERGENCY CUT: ${symbol} at $${pnl.toFixed(2)}`);
          await postToDiscord(`🚨 EMERGENCY CUT: ${symbol} at $${pnl.toFixed(2)}`);
          await this.sellPosition(baseUrl, headers, symbol, qty, actions, {
            reason: 'fin_emergency_cut',
            entryPrice: parseFloat(pos.avg_entry_price || '0') || null,
            exitPrice: parseFloat(pos.current_price || '0') || 0,
            pnl,
          });
          actions.push(`EMERGENCY CUT ${symbol} ($${pnl.toFixed(2)})`);
        }
      }
    } catch (e: any) {
      actions.push(`Emergency cuts error: ${e.message}`);
    }
  }

  // ── Brain-Powered Analysis — Fin as ex-Wall Street analyst ──────────

  private async brainAnalysis(dailyPnl: number, goalProgress: number, actions: string[]): Promise<void> {
    const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://brain.oceanicai.io';
    const brainKey = process.env.BRAIN_API_KEY || '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (brainKey) headers['Authorization'] = `Bearer ${brainKey}`;

    // Get current positions for context
    const alpacaHeaders = getAlpacaHeaders();
    let posContext = 'No position data';
    if (alpacaHeaders) {
      try {
        const creds = loadCredentials();
        const base = creds.alpaca?.baseUrl || 'https://paper-api.alpaca.markets';
        const res = await fetch(`${base}/v2/positions`, { headers: alpacaHeaders, signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const positions = await res.json() as any[];
          posContext = positions.map(p => `${p.symbol}: $${parseFloat(p.unrealized_pl).toFixed(2)} (${(parseFloat(p.unrealized_plpc)*100).toFixed(1)}%)`).join(', ');
        }
      } catch {}
    }

    // 1. Query Brain for analysis — Fin thinks like an ex-Citi equity analyst
    try {
      const res = await fetch(`${BRAIN_URL}/v1/transfer`, {
        method: 'POST', headers,
        body: JSON.stringify({
          prompt: `You are Fin, an ex-Citi equity research analyst now running trading at Deep Canyon. You are sharp, numbers-driven, and accountable.

Current positions: ${posContext}
Daily P&L: $${dailyPnl.toFixed(2)} (${goalProgress.toFixed(0)}% of $500 target)

Analyze: What's working? What's not? Should we cut any losers? Are we positioned for the right sectors given current macro (Iran war, oil surge, inflation fears)? Give 2-3 specific actionable items.`,
          context: `Day trader strategy: buy movers at open, hold, sell before close. Target $500/day minimum.`,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const analysis = typeof data.response === 'string' ? data.response : JSON.stringify(data.response);
        console.log(`[Fin] BRAIN ANALYSIS: ${analysis.substring(0, 200)}`);
        actions.push(`BRAIN: ${analysis.substring(0, 100)}`);

        // Store analysis for Warren and Discord bot to read
        this.store.set('fin:brain_analysis', JSON.stringify({
          analysis: analysis.substring(0, 500),
          timestamp: new Date().toISOString(),
          dailyPnl,
        }));
      }
    } catch {}

    // 2. Train SONA with today's outcomes — Fin learns from every trade
    try {
      const trades = this.store.getTodayTrades();
      if (trades.length > 0) {
        for (const trade of trades.slice(-5)) {
          await fetch(`${BRAIN_URL}/v1/train`, {
            method: 'POST', headers,
            body: JSON.stringify({
              input: `Trade: ${trade.ticker} ${trade.direction} | Reason: ${trade.reason}`,
              output: trade.pnl > 0 ? 'profitable' : 'loss',
              metadata: {
                domain: 'fin:trade_learning',
                ticker: trade.ticker,
                pnl: trade.pnl,
                reason: trade.reason,
                direction: trade.direction,
              },
            }),
            signal: AbortSignal.timeout(5000),
          });
        }
        console.log(`[Fin] Trained SONA on ${Math.min(trades.length, 5)} trades`);
      }
    } catch {}

    // 3. Search Brain for patterns relevant to current positions
    try {
      const res = await fetch(`${BRAIN_URL}/v1/memories/search?q=day+trading+movers+profitable+pattern&limit=3`, {
        headers, signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const patterns = (data.memories || data.results || []).slice(0, 3);
        for (const p of patterns) {
          if (p.content) console.log(`[Fin] Pattern: ${p.content.substring(0, 80)}`);
        }
      }
    } catch {}
  }

  private async sellPosition(
    baseUrl: string, headers: Record<string, string>,
    symbol: string, qty: number, actions: string[],
    context?: { reason: string; entryPrice: number | null; exitPrice: number; pnl: number },
  ): Promise<void> {
    try {
      // Crypto symbols: position API returns "AVAXUSD" but orders need "AVAX/USD"
      // Crypto also needs time_in_force: gtc (not day)
      const isCrypto = symbol.endsWith('USD') && !['SQQQ','TQQQ','SLV','GLD','GDX','DIA','DBO'].includes(symbol) && symbol.length > 4;
      const orderSymbol = isCrypto ? symbol.replace(/USD$/, '/USD') : symbol;
      const tif = isCrypto ? 'gtc' : 'day';
      const res = await fetch(`${baseUrl}/v2/orders`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: orderSymbol, qty: String(qty), side: 'sell', type: 'market', time_in_force: tif }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        actions.push(`SOLD ${symbol} x${qty}`);
        await postToDiscord(`SOLD ${orderSymbol} x${qty} (${tif})`);
        // Record the close so the circuit breaker + dashboards aren't blind.
        // PnL here is based on unrealized at decision time — the Alpaca
        // reconciler running in trade-engine will upsert the authoritative
        // fill price on its next pass.
        if (context) {
          let orderId: string | null = null;
          try {
            const body = await res.clone().json() as any;
            orderId = body?.id ?? null;
          } catch {}
          recordClosedTrade(this.store, {
            ticker: symbol,
            direction: 'long',
            reason: context.reason,
            qty,
            entryPrice: context.entryPrice,
            exitPrice: context.exitPrice,
            pnl: context.pnl,
            orderId,
            source: 'fin',
          });
        }
      } else {
        const body = await res.text();
        actions.push(`SELL FAILED ${symbol}: ${res.status} ${body}`);
        await postToDiscord(`⚠️ SELL FAILED ${orderSymbol}: ${res.status} ${body.substring(0, 100)}`);
      }
    } catch (e: any) {
      actions.push(`SELL ERROR ${symbol}: ${e.message}`);
      await postToDiscord(`❌ SELL ERROR ${symbol}: ${e.message}`);
    }
  }
}

/**
 * Trade Engine — Worker Process
 *
 * Standalone heartbeat loop (120s) that executes trades, manages positions,
 * and runs the neural trader. Communicates via shared SQLite state store.
 *
 * Heartbeat order:
 *   1. manage_positions (forex) — bank $50+ winners, cut -$20 losers
 *   2. check_exits (equity/crypto) — SL, trailing stop, TP, star concentration
 *   3. Read daily strategy + research stars from state store
 *   4. scan_signals — evaluate candidates, execute trades
 *   5. Write autonomy status to state store
 */

import { join } from 'path';
import { TradeExecutor } from '../../neural-trader/src/executor.js';
import { PositionManager } from '../../neural-trader/src/position-manager.js';
import { NeuralTrader } from '../../neural-trader/src/index.js';
import { ForexScanner } from '../../forex-scanner/src/index.js';
import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { CredentialVault } from '../../qudag/src/vault.js';
import { loadCredentials, getAlpacaHeaders, ALPACA_DATA_URL, FOREX_SERVICE_URL } from './config-bus.js';
import { DailyOptimizer, getMarketCondition } from '../../mincut/src/daily-optimizer.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { brain } from './brain-client.js';
import { BayesianIntelligence } from '../../shared/intelligence/bayesian-intelligence.js';

// Shared Bayesian instance — populated by gateway index.ts via eventBus
let _bayesian: BayesianIntelligence | null = null;
eventBus.on('intelligence:ready' as any, (bi: BayesianIntelligence) => { _bayesian = bi; });

// Forward trade:closed to parent process via IPC (Bayesian + Brain learning)
function emitTradeClosed(payload: { ticker: string; success: boolean; returnPct: number; reason: string }) {
  eventBus.emit('trade:closed' as any, payload);
  if (process.send) process.send({ type: 'trade:closed', payload });
}

const HEARTBEAT_MS = 120_000;
const MAX_POSITIONS = 6;
const BUDGET_MAX = 8_000;
const DAILY_LOSS_LIMIT = -500; // Hard circuit breaker — halt everything if day P&L exceeds this
const FOREX_BANK = 50;
const FOREX_CUT = -20;
const SL_DOMINANCE_HALT = 0.70;

interface ActionResult {
  action: string; priority: number; durationMs: number;
  status: 'success' | 'skipped' | 'error'; detail: string;
}

interface HeartbeatResult {
  heartbeatNumber: number; startedAt: string; durationMs: number;
  actions: ActionResult[]; positionCount: number; totalDeployed: number; errors: string[];
}

function getMarketContext() {
  const now = new Date();
  const fmt = (opt: Intl.DateTimeFormatOptions) =>
    now.toLocaleString('en-US', { timeZone: 'America/New_York', ...opt });
  const etHour = parseInt(fmt({ hour: '2-digit', hour12: false }));
  const etMin = parseInt(fmt({ minute: '2-digit' }));
  const etDay = fmt({ weekday: 'short' });
  const isWeekday = !['Sat', 'Sun'].includes(etDay);
  const isMarketOpen = isWeekday && ((etHour === 9 && etMin >= 30) || (etHour >= 10 && etHour < 16));
  const isAfterHours = isWeekday && etHour >= 16 && etHour < 20;
  return { etHour, etMin, etDay, isMarketOpen, isAfterHours };
}

function isCrypto(ticker: string): boolean {
  return ticker.includes('-') || ticker.includes('/') || (ticker.includes('USD') && ticker.length > 5);
}

function budgetPositionCount(positions: Array<{ ticker: string; marketValue: number }>, marketOpen: boolean): number {
  // Always count ALL positions — after-hours crypto shouldn't fill equity slots
  return positions.filter((p) => Math.abs(p.marketValue) > 0).length;
}

function totalDeployed(positions: Array<{ ticker: string; marketValue: number }>, marketOpen: boolean): number {
  return positions.filter((p) => marketOpen || isCrypto(p.ticker)).reduce((s, p) => s + Math.abs(p.marketValue), 0);
}

function slDominant(store: GatewayStateStore): boolean {
  try {
    const trades = store.getTodayTrades();
    // Only count actual entry-level stop losses, not star concentration cuts
    // Star concentration uses reason 'stop_loss' but they're position management, not bad entries
    const realEntries = trades.filter((t) => t.pnl < -30); // Only significant losses count
    if (realEntries.length < 5) return false;
    const slCount = realEntries.filter((t) => t.reason === 'stop_loss').length;
    const ratio = slCount / realEntries.length;
    if (ratio > SL_DOMINANCE_HALT) {
      console.log(`[TradeEngine] SL dominance: ${(ratio * 100).toFixed(0)}% (${slCount}/${realEntries.length} real losses)`);
    }
    return ratio > SL_DOMINANCE_HALT;
  } catch (e: any) {
    console.log(`[TradeEngine] SL check error: ${e.message} — allowing trades`);
    return false;
  }
}

// ─── Trade Engine ────────────────────────────────────────────────────────────

export class TradeEngine {
  private executor: TradeExecutor;
  private pm: PositionManager;
  private forex: ForexScanner;
  private neural: NeuralTrader;
  private store: GatewayStateStore;
  private hbCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private recent: HeartbeatResult[] = [];
  private dailyOptimizer: DailyOptimizer;
  private _lastStrategy: { riskBudget: number; takeProfitTarget: number; approach: string; maxNewPositions: number; actions: string[] } | null = null;
  private get _recentBuys(): Map<string, number> {
    try {
      const raw = this.store.get('recent_buys_today');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.date === new Date().toISOString().slice(0, 10)) return new Map(Object.entries(data.buys));
      }
    } catch {}
    return new Map();
  }
  private _trackBuy(ticker: string): void {
    const buys = this._recentBuys;
    buys.set(ticker, Date.now());
    const obj: Record<string, number> = {};
    for (const [k, v] of buys) obj[k] = v;
    this.store.set('recent_buys_today', JSON.stringify({ date: new Date().toISOString().slice(0, 10), buys: obj }));
  }

  // Persisted to state store — survives restarts
  private get _sessionSells(): Set<string> {
    try {
      const raw = this.store.get('session_sells_today');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.date === new Date().toISOString().slice(0, 10)) return new Set(data.tickers);
      }
    } catch {}
    return new Set();
  }
  private _addSessionSell(ticker: string): void {
    const sells = this._sessionSells;
    sells.add(ticker);
    this.store.set('session_sells_today', JSON.stringify({ date: new Date().toISOString().slice(0, 10), tickers: [...sells] }));
  }

  constructor() {
    this.neural = new NeuralTrader();
    this.dailyOptimizer = new DailyOptimizer();
    // Single credential source — config bus loads from vault + env
    const creds = loadCredentials();

    this.executor = new TradeExecutor({
      apiKey: creds.alpaca?.apiKey || '',
      apiSecret: creds.alpaca?.apiSecret || '',
      baseUrl: creds.alpaca?.baseUrl || 'https://paper-api.alpaca.markets',
      paperTrading: creds.alpaca?.mode !== 'live',
    });
    this.pm = new PositionManager();
    // Forex: use dedicated forex service on port 3003, or direct OANDA if creds available
    if (creds.oanda) {
      this.forex = new ForexScanner({ oandaApiKey: creds.oanda.apiKey, oandaAccountId: creds.oanda.accountId });
      console.log('[TradeEngine] Forex: direct OANDA connection');
    } else {
      // Proxy through forex service — create a minimal scanner that calls HTTP
      this.forex = new Proxy({} as any, {
        get: (_target, prop) => {
          if (prop === 'getOpenTrades') return async () => {
            try { const r = await fetch('http://localhost:3003/api/forex/positions'); const d = await r.json() as any; return d.positions || []; } catch { return []; }
          };
          if (prop === 'closePosition') return async (sym: string) => {
            const inst = sym.replace('/', '_');
            const r = await fetch(`http://localhost:3003/api/forex/position/${inst}/close`, { method: 'POST' });
            return r.json();
          };
          if (prop === 'evaluateSessionMomentum') return async () => [];
          if (prop === 'evaluateCarryTrades') return async () => [];
          if (prop === 'placeOrder') return async (inst: string, units: number, sl?: number, tp?: number) => {
            const r = await fetch('http://localhost:3003/api/forex/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instrument: inst, units, stopLoss: sl, takeProfit: tp }) });
            return r.json();
          };
          return () => {};
        }
      });
      console.log('[TradeEngine] Forex: proxying via forex service on :3003');
    }
    const dbPath = process.env.GATEWAY_DB_PATH || join(process.cwd(), '..', 'data', 'gateway-state.db');
    console.log(`[TradeEngine] DB: ${dbPath} (env=${!!process.env.GATEWAY_DB_PATH}, cwd=${process.cwd()})`);
    this.store = new GatewayStateStore(dbPath);
  }

  // ── Action 1: Forex Position Management (Priority 1) ──────────────────

  private async manageForexPositions(): Promise<ActionResult> {
    const t0 = Date.now();
    const ar = (s: ActionResult['status'], d: string): ActionResult =>
      ({ action: 'manage_positions', priority: 1, durationMs: Date.now() - t0, status: s, detail: d });
    try {
      const trades = await this.forex.getOpenTrades();
      if (trades.length === 0) return ar('skipped', 'No forex positions');

      const pos = trades.map((t: any) => ({
        id: t.id, instrument: t.instrument,
        units: parseInt(t.currentUnits), pl: parseFloat(t.unrealizedPL || '0'),
      }));
      const log: string[] = [];

      // Bank $50+ winners, cut -$20 losers
      for (const p of pos) {
        if (p.pl >= FOREX_BANK || p.pl < FOREX_CUT) {
          try {
            const sym = p.instrument.replace('_', '/');
            await this.forex.closePosition(sym);
            const dir = p.units > 0 ? 'long' : 'short';
            const reason = p.pl >= FOREX_BANK ? 'take_profit' : 'stop_loss';
            this.store.recordTrade({ ticker: sym, pnl: p.pl, direction: dir, reason, openedAt: '', closedAt: new Date().toISOString() });
            emitTradeClosed({ ticker: sym, success: p.pl > 0, returnPct: p.pl / 100, reason });
            brain.recordTradeClose(sym, p.pl, p.pl / 100, reason, dir).catch(() => {});
            log.push(`${p.pl >= FOREX_BANK ? 'BANKED' : 'CUT'} ${sym} $${p.pl.toFixed(2)}`);
          } catch (e: any) { log.push(`FAILED ${p.instrument}: ${e.message}`); }
        }
      }

      // Star concentration: star > $15, cut dogs losing > $2
      const remaining = pos.filter((p) => !log.some((l) => l.includes(p.instrument.replace('_', '/'))));
      if (remaining.length >= 2) {
        remaining.sort((a, b) => b.pl - a.pl);
        const star = remaining[0];
        if (star.pl > 15) {
          for (const dog of remaining.filter((p) => p.pl < -2)) {
            try {
              const sym = dog.instrument.replace('_', '/');
              await this.forex.closePosition(sym);
              log.push(`CUT DOG ${sym} $${dog.pl.toFixed(2)} -> star ${star.instrument.replace('_', '/')}`);
            } catch (e: any) { log.push(`FAILED ${dog.instrument}: ${e.message}`); }
          }
        }
      }

      if (log.length === 0) {
        const total = pos.reduce((s, p) => s + p.pl, 0);
        return ar('skipped', `${pos.length} forex pos, P&L: $${total.toFixed(2)} — holding`);
      }
      return ar('success', log.join(' | '));
    } catch (e: any) { return ar('error', e.message); }
  }

  // ── Action 2: Equity/Crypto Exits (Priority 2) ────────────────────────

  private async checkExits(): Promise<ActionResult> {
    const t0 = Date.now();
    const ar = (s: ActionResult['status'], d: string): ActionResult =>
      ({ action: 'check_exits', priority: 2, durationMs: Date.now() - t0, status: s, detail: d });
    try {
      const starActions = await this.pm.starConcentration(this.executor);
      const exitActions = await this.pm.checkPositions(this.executor);
      const all = [...starActions, ...exitActions];
      const cb = this.pm.isCircuitBreakerTripped() ? ' (circuit breaker active)' : '';

      if (all.length === 0) return ar('skipped', `Positions within bounds${cb}`);

      for (const trade of this.pm.getClosedTrades(5)) {
        this.store.recordTrade({
          ticker: trade.ticker, pnl: trade.pnl, direction: 'long',
          reason: trade.exitReason, openedAt: '', closedAt: trade.closedAt,
        });
        emitTradeClosed({
          ticker: trade.ticker, success: trade.pnl > 0,
          returnPct: trade.exitPrice && trade.entryPrice ? (trade.exitPrice - trade.entryPrice) / trade.entryPrice : trade.pnl / 100,
          reason: trade.exitReason,
        });
      }
      return ar(all.some((a) => a.includes('LOSS')) ? 'error' : 'success', all.join('; ') + cb);
    } catch (e: any) { return ar('error', e.message); }
  }

  // ── Action 3: Scan Signals & Execute (Priority 3) ─────────────────────

  private async scanSignals(
    strategy: { maxPositions?: number; budgetMax?: number },
    stars: Array<{ symbol: string; score: number }>,
  ): Promise<ActionResult> {
    const t0 = Date.now();
    const mkt = getMarketContext();
    const ar = (s: ActionResult['status'], d: string): ActionResult =>
      ({ action: 'scan_signals', priority: 3, durationMs: Date.now() - t0, status: s, detail: d });
    const details: string[] = [];

    try {
      if (this.pm.isCircuitBreakerTripped()) return ar('skipped', 'Circuit breaker — no new entries');
      if (slDominant(this.store)) return ar('skipped', 'SL dominance > 70% — halting entries');

      const positions = await this.executor.getPositions();
      const maxPos = strategy.maxPositions || MAX_POSITIONS;
      const budget = strategy.budgetMax || BUDGET_MAX;

      // Scan top movers FIRST so they're available for rotation decisions
      if (mkt.isMarketOpen) {
        try {
          const creds2 = loadCredentials();
          const moversRes = await fetch('https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=10', {
            headers: { 'APCA-API-KEY-ID': creds2.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds2.alpaca!.apiSecret },
            signal: AbortSignal.timeout(5000),
          });
          if (moversRes.ok) {
            const moversData = await moversRes.json() as any;
            const ownedSet = new Set(positions.map(p => p.ticker));
            const gainers = (moversData.gainers || [])
              .filter((m: any) => m.percent_change > 2 && m.price > 5 && m.price < 500)
              .filter((m: any) => !ownedSet.has(m.symbol))
              .slice(0, 5);
            for (const mover of gainers) {
              const moverScore = Math.min(0.96 + mover.percent_change / 500, 0.99);
              stars.push({ symbol: mover.symbol, sector: 'momentum', score: moverScore, catalyst: `+${mover.percent_change.toFixed(1)}% today` });
            }
            if (gainers.length > 0) details.push(`Top movers: ${gainers.map((g: any) => `${g.symbol} +${g.percent_change.toFixed(1)}%`).join(', ')}`);
          }
        } catch (e: any) { details.push(`Movers scan: ${e.message}`); }
      }

      // Sort all candidates by score — movers (0.96-0.99) rank above research stars (0.85-0.95)
      stars.sort((a, b) => b.score - a.score);

      const currentCount = budgetPositionCount(positions, mkt.isMarketOpen);
      if (currentCount >= maxPos) {
        // At max positions — rotate weakest for highest-scored candidate
        const weakest = positions
          .filter(p => Math.abs(p.marketValue) > 0)
          .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)[0];
        const bestStar = stars.filter(s => !new Set(positions.map(p => p.ticker)).has(s.symbol))[0];
        // Rotate if: weakest is losing OR flat with a hot mover available
        // BUT: don't rotate positions bought in the last 30 minutes (cooldown)
        const weakPnlPct = weakest ? weakest.unrealizedPnlPercent : 0;
        const buyTime = weakest ? this._recentBuys.get(weakest.ticker) : undefined;
        const heldMinutes = buyTime ? (Date.now() - buyTime) / 60_000 : 999;
        const onCooldown = heldMinutes < 30;
        const worthRotating = weakest && bestStar && !onCooldown && !this._sessionSells.has(bestStar.symbol) && (
          weakest.unrealizedPnl < -10 ||
          (weakPnlPct < 1 && bestStar.score > 0.96)
        );
        if (worthRotating) {
          // Rotate: sell weakest, then let the scan buy the star
          const isCrypto2 = isCrypto(weakest.ticker);
          const sellSymbol = isCrypto2 ? weakest.ticker.replace(/USD$/, '/USD') : weakest.ticker;
          const tif = isCrypto2 ? 'gtc' : 'day';
          try {
            const creds = loadCredentials();
            const headers = { 'APCA-API-KEY-ID': creds.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca!.apiSecret, 'Content-Type': 'application/json' };
            await fetch(`${creds.alpaca!.baseUrl}/v2/orders`, {
              method: 'POST', headers,
              body: JSON.stringify({ symbol: sellSymbol, qty: String(Math.abs(weakest.shares)), side: 'sell', type: 'market', time_in_force: tif }),
              signal: AbortSignal.timeout(10_000),
            });
            details.push(`ROTATED OUT ${weakest.ticker} ($${weakest.unrealizedPnl.toFixed(2)}) for ${bestStar.symbol}`);
            console.log(`[TradeEngine] ROTATION: sold ${weakest.ticker} ($${weakest.unrealizedPnl.toFixed(2)}) to make room for ${bestStar.symbol} (score: ${bestStar.score})`);
            emitTradeClosed({ ticker: weakest.ticker, success: weakest.unrealizedPnl > 0, returnPct: weakest.unrealizedPnlPercent / 100, reason: 'rotation' });
            this._addSessionSell(weakest.ticker); // don't rebuy this session
            // recentBuys auto-managed via state store
          } catch (e: any) { details.push(`Rotation failed: ${e.message}`); }
          // Continue to scan — position freed
        } else {
          return ar('skipped', `Max positions (${positions.length}/${maxPos})`);
        }
      }
      if (totalDeployed(positions, mkt.isMarketOpen) >= budget)
        return ar('skipped', `Budget deployed ($${totalDeployed(positions, mkt.isMarketOpen).toFixed(0)}/${budget})`);

      const owned = new Set(positions.map((p) => p.ticker));

      // Forex entries handled in heartbeat step 5 (rebuilt with technical analysis).

      // SL dominance check — halt equity entries if > 70% (equity trades only)
      const starTrades = this.store.getTodayTrades().filter(t => !isCrypto(t.ticker) && !t.ticker.includes('/') && !t.ticker.includes('_'));
      const starSlCount = starTrades.filter(t => t.reason === 'stop_loss').length;
      const starSlDom = starTrades.length >= 3 ? starSlCount / starTrades.length : 0;
      if (starSlDom > 0.7) {
        return ar('skipped', `Equity SL dominance ${(starSlDom * 100).toFixed(0)}% > 70% — HALTING entries`);
      }

      // Equity/Crypto from research stars + movers (already sorted by score)
      const eligibleStars = stars
        .filter((s) => !owned.has(s.symbol))
        .filter((s) => mkt.isMarketOpen || isCrypto(s.symbol))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      if (stars.length > 0) console.log(`  [scan] ${stars.length} stars, ${eligibleStars.length} eligible, owned: ${[...owned].join(',')}, market: ${mkt.isMarketOpen ? 'open' : 'closed'}`);

      for (const star of eligibleStars) {
        const fresh = await this.executor.getPositions();
        if (budgetPositionCount(fresh, mkt.isMarketOpen) >= maxPos) { details.push('Max positions — done'); break; }
        const deployed = totalDeployed(fresh, mkt.isMarketOpen);
        if (deployed >= budget) { details.push('Budget full — done'); break; }

        // FIX 1: Bayesian filter — adjustSignalConfidence before every buy
        let adjustedScore = star.score;
        if (_bayesian) {
          adjustedScore = _bayesian.adjustSignalConfidence(star.symbol, star.score, 'buy');
          const prior = _bayesian.getTickerPrior(star.symbol);
          // Hard reject: if Bayesian has enough data and posterior < 0.35, skip this ticker
          if (prior.observations >= 5 && prior.posterior < 0.35) {
            details.push(`SKIP ${star.symbol} — Bayesian reject (${(prior.posterior*100).toFixed(0)}% win rate, ${prior.observations} obs)`);
            continue;
          }
        }

        // FIX 2: Use MinCut allocations for position sizing
        const remaining = budget - deployed;
        const riskPct = this._lastStrategy?.riskBudget ?? 100;
        const size = Math.min(remaining * 0.20 * (riskPct / 100), this._lastStrategy?.takeProfitTarget ? 1400 : 1400);
        if (size < 50) continue;

        try {
          const price = await this.fetchPrice(star.symbol);
          if (!price || price <= 0) { details.push(`${star.symbol} — no price`); continue; }
          const qty = star.symbol.includes('-')
            ? Math.round((size / price) * 10000) / 10000
            : Math.floor(size / price);
          if (qty <= 0) continue;

          const signal = {
            id: `star-${Date.now()}-${star.symbol}`, ticker: star.symbol,
            direction: 'buy' as const, confidence: adjustedScore, timeframe: '1h' as const,
            indicators: {}, pattern: 'research_star', timestamp: new Date(), source: 'momentum' as const,
          };
          // Don't rebuy tickers we already sold this session
          if (this._sessionSells.has(star.symbol)) { details.push(`SKIP ${star.symbol} — sold this session`); continue; }

          const order = await this.executor.execute(signal, qty, size);
          details.push(`BUY ${qty} ${star.symbol} @$${price.toFixed(2)} — ${order.status}${adjustedScore !== star.score ? ` (adj: ${adjustedScore.toFixed(2)})` : ''}`);
          if (order.status === 'filled' || order.status === 'pending') {
            owned.add(star.symbol);
            this._trackBuy(star.symbol);
          }
        } catch (e: any) { details.push(`${star.symbol}: ${e.message}`); }
      }

      if (details.length === 0) details.push(`No signals (${mkt.isMarketOpen ? 'open' : 'closed'})`);
      const status = details.some((d) => d.includes('FAIL') || d.includes('error')) ? 'error' as const
        : details.some((d) => d.includes('BUY') || d.includes('FOREX')) ? 'success' as const : 'skipped' as const;
      return ar(status, details.join('; '));
    } catch (e: any) { return ar('error', e.message); }
  }

  private async fetchPrice(ticker: string): Promise<number | null> {
    const headers = getAlpacaHeaders();
    if (!headers) return null;
    const key = headers['APCA-API-KEY-ID'], sec = headers['APCA-API-SECRET-KEY'];
    if (!key || !sec) return null;
    try {
      const c = ticker.includes('-');
      const url = c
        ? `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${ticker.replace('-', '/')}`
        : `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${ticker}&feed=iex`;
      const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': sec } });
      if (!r.ok) return null;
      const d = (await r.json()) as any;
      const snaps = d.snapshots || d;
      const k = c ? ticker.replace('-', '/') : ticker;
      return snaps[k]?.latestTrade?.p || snaps[k]?.latestQuote?.ap || null;
    } catch { return null; }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────

  private _boughtToday = false;
  private _soldEod = false;

  private async heartbeat(): Promise<void> {
    if (this.stopping) return;
    this.hbCount++;
    const t0 = Date.now();
    const mkt = getMarketContext();
    const actions: ActionResult[] = [];
    const errors: string[] = [];

    // Reset daily flags — check against stored date, not just time window
    const today = new Date().toISOString().slice(0, 10);
    const lastTradeDate = this.store.get('trade_engine_last_date') || '';
    if (today !== lastTradeDate) {
      this._boughtToday = false;
      this._soldEod = false;
      // Session sells and recent buys auto-clear via date check in their getters
      this.store.set('trade_engine_last_date', today);
      console.log(`[TradeEngine] New trading day: ${today}`);
    }

    console.log(
      `\n[TradeEngine] === Heartbeat #${this.hbCount} === ${mkt.etDay} ` +
      `${mkt.etHour}:${String(mkt.etMin).padStart(2, '0')} ET — ` +
      `${mkt.isMarketOpen ? 'OPEN' : mkt.isAfterHours ? 'AFTER-HOURS' : 'CLOSED'}`,
    );

    // DAILY LOSS CIRCUIT BREAKER — checks BOTH realized AND unrealized P&L
    const allTodayTrades = this.store.getTodayTrades();
    const todayClosedPnl = allTodayTrades.reduce((s, t) => s + t.pnl, 0);
    let unrealizedPnl = 0;
    try {
      const pos = await this.executor.getPositions();
      unrealizedPnl = pos.reduce((s, p) => s + p.unrealizedPnl, 0);
    } catch {}
    const totalDayPnl = todayClosedPnl + unrealizedPnl;
    const equityCircuitBreaker = totalDayPnl < DAILY_LOSS_LIMIT;
    if (equityCircuitBreaker) {
      console.log(`  [CIRCUIT BREAKER] Daily P&L $${totalDayPnl.toFixed(2)} (realized $${todayClosedPnl.toFixed(2)} + unrealized $${unrealizedPnl.toFixed(2)}) exceeds $${DAILY_LOSS_LIMIT} — HALTED`);
      // Alert once per day
      const cbKey = `circuit_breaker_${today}`;
      if (!this.store.get(cbKey)) {
        this.store.set(cbKey, 'tripped');
        brain.recordRule(`CIRCUIT BREAKER TRIPPED ${today}: P&L $${todayClosedPnl.toFixed(2)} exceeded $${DAILY_LOSS_LIMIT} limit`, 'system').catch(() => {});
        const webhook = process.env.DISCORD_WEBHOOK_URL;
        if (webhook) {
          fetch(webhook, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `**CIRCUIT BREAKER** — Daily P&L $${todayClosedPnl.toFixed(2)} exceeded $${DAILY_LOSS_LIMIT} limit. Equity trading halted, forex management continues.` }),
          }).catch(() => {});
        }
      }
    }

    // 1. Forex position management (always runs — 24/5)
    try { const r = await this.manageForexPositions(); actions.push(r); if (r.status !== 'skipped') console.log(`  [1] ${r.detail} (${r.durationMs}ms)`); }
    catch (e: any) { errors.push(`manage_positions: ${e.message}`); }

    // 2. EOD SELL — liquidate all equity positions at 3:50 PM ET
    if (mkt.isMarketOpen && mkt.etHour === 15 && mkt.etMin >= 50 && !this._soldEod) {
      this._soldEod = true;
      try {
        const creds = loadCredentials();
        const headers = { 'APCA-API-KEY-ID': creds.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca!.apiSecret };
        const positions = await this.executor.getPositions();
        const equityPos = positions.filter(p => !isCrypto(p.ticker));
        for (const pos of equityPos) {
          try {
            await fetch(`${creds.alpaca!.baseUrl}/v2/positions/${pos.ticker}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
            console.log(`  [EOD] SOLD ${pos.ticker} P&L: $${pos.unrealizedPnl.toFixed(2)}`);
            emitTradeClosed({ ticker: pos.ticker, success: pos.unrealizedPnl > 0, returnPct: pos.unrealizedPnlPercent / 100, reason: 'eod_close' });
            brain.recordTradeClose(pos.ticker, pos.unrealizedPnl, pos.unrealizedPnlPercent / 100, 'eod_close', 'long').catch(() => {});
          } catch (e: any) { console.log(`  [EOD] FAILED ${pos.ticker}: ${e.message}`); }
        }
        actions.push({ action: 'eod_sell', priority: 0, durationMs: Date.now() - t0, status: 'success', detail: `EOD: sold ${equityPos.length} positions` });
      } catch (e: any) { errors.push(`eod_sell: ${e.message}`); }
    }

    // 3. BUY MOVERS — fill available slots during market hours (before 3:30 PM)
    //    PANIC PROTOCOL: circuit breaker + SL dominance before any equity buys
    //    Note: allTodayTrades already fetched above for circuit breaker
    const equityTrades = allTodayTrades.filter(t => !isCrypto(t.ticker) && !t.ticker.includes('/') && !t.ticker.includes('_'));
    const eqSlCount = equityTrades.filter(t => t.reason === 'stop_loss').length;
    const eqSlDominance = equityTrades.length > 0 ? eqSlCount / equityTrades.length : 0;

    const positions = await this.executor.getPositions();
    const equityCount = positions.filter(p => !isCrypto(p.ticker)).length;
    const openSlots = MAX_POSITIONS - equityCount;
    const totalDeployedNow = positions.reduce((s, p) => s + Math.abs(p.marketValue || p.costBasis || 0), 0);
    const budgetRemaining = BUDGET_MAX - totalDeployedNow;

    if (equityCircuitBreaker) {
      // Already logged above — skip equity entirely
    } else if (eqSlDominance > 0.7 && equityTrades.length >= 3) {
      console.log(`  [BUY] EQUITY SL DOMINANCE ${(eqSlDominance * 100).toFixed(0)}% (${eqSlCount}/${equityTrades.length}) > 70% — HALTING equity entries`);
    } else if (totalDeployedNow >= BUDGET_MAX) {
      console.log(`  [BUY] BUDGET FULL: $${totalDeployedNow.toFixed(0)} deployed >= $${BUDGET_MAX} max — skipping buys`);
    } else if (openSlots > 0 && budgetRemaining > 100 && (mkt.isMarketOpen ? (mkt.etHour < 15 || (mkt.etHour === 15 && mkt.etMin < 30)) : true)) {
      // Equity: market hours only (before 3:30 PM). Crypto: 24/7 via research stars.
      try {
        const creds = loadCredentials();
        const headers = { 'APCA-API-KEY-ID': creds.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca!.apiSecret };

        // PRIMARY: Research stars from state store (Alpaca movers + most-actives + crypto, refreshed every 120s)
        const researchStars = this.store.getResearchStars();
        let gainers: Array<{ symbol: string; price: number; percent_change: number }> = [];

        if (researchStars.length > 0) {
          const equityStars = researchStars.filter(s => !isCrypto(s.symbol));
          const cryptoStars = researchStars.filter(s => isCrypto(s.symbol));

          // Fetch equity prices
          if (equityStars.length > 0) {
            try {
              const syms = equityStars.map(s => s.symbol).slice(0, 10).join(',');
              const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${syms}&feed=iex`, { headers, signal: AbortSignal.timeout(5000) });
              if (snapRes.ok) {
                const snapData = await snapRes.json() as any;
                for (const star of equityStars) {
                  const snap = snapData[star.symbol];
                  if (!snap) continue;
                  const price = snap.latestTrade?.p || snap.latestQuote?.ap;
                  if (!price || price < 5 || price > 500) continue;
                  const pctMatch = star.catalyst.match(/\+?([\d.]+)%/);
                  const pct = pctMatch ? parseFloat(pctMatch[1]) : 0;
                  gainers.push({ symbol: star.symbol, price, percent_change: pct });
                }
              }
            } catch {}
          }

          // Fetch crypto prices
          if (cryptoStars.length > 0) {
            try {
              const syms = cryptoStars.map(s => s.symbol.replace('-', '/')).slice(0, 8).join(',');
              const snapRes = await fetch(`https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${syms}`, { headers, signal: AbortSignal.timeout(5000) });
              if (snapRes.ok) {
                const snapData = await snapRes.json() as any;
                const snaps = snapData.snapshots || snapData;
                for (const star of cryptoStars) {
                  const key = star.symbol.replace('-', '/');
                  const snap = snaps[key];
                  if (!snap) continue;
                  const price = snap.latestTrade?.p || snap.latestQuote?.ap;
                  if (!price) continue;
                  const pctMatch = star.catalyst.match(/\+?([\d.]+)%/);
                  const pct = pctMatch ? parseFloat(pctMatch[1]) : 0;
                  gainers.push({ symbol: star.symbol, price, percent_change: pct });
                }
              }
            } catch {}
          }

          // Filter: equity only during market hours, crypto 24/7
          if (!mkt.isMarketOpen) {
            gainers = gainers.filter(g => isCrypto(g.symbol));
          }
          if (gainers.length > 0) {
            const eq = gainers.filter(g => !isCrypto(g.symbol)).length;
            const cr = gainers.filter(g => isCrypto(g.symbol)).length;
            console.log(`  [BUY] Using research stars (${eq} equity, ${cr} crypto)`);
          }
        }

        // FALLBACK: Alpaca movers direct if research worker hasn't populated stars
        if (gainers.length === 0) {
          try {
            const moversRes = await fetch('https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=20', { headers, signal: AbortSignal.timeout(5000) });
            if (moversRes.ok) {
              const moversData = await moversRes.json() as any;
              gainers = (moversData.gainers || [])
                .filter((m: any) => m.percent_change > 2 && m.price > 5 && m.price < 500 && (m.trade_count || 0) > 5000)
                .slice(0, openSlots);
            }
            if (gainers.length > 0) console.log('  [BUY] Using Alpaca movers direct (no research stars)');
          } catch {}
        }

        // LAST RESORT: Yahoo Finance gainers (gap-from-close, less reliable for intraday)
        if (gainers.length === 0) {
          try {
            const yahooRes = await fetch('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=20', {
              headers: { 'User-Agent': 'MTWM/1.0' },
              signal: AbortSignal.timeout(10_000),
            });
            if (yahooRes.ok) {
              const yahooData = await yahooRes.json() as any;
              const quotes = yahooData?.finance?.result?.[0]?.quotes || [];
              gainers = quotes
                .filter((q: any) => q.regularMarketPrice > 5 && q.regularMarketPrice < 500 && q.regularMarketChangePercent > 5)
                .map((q: any) => ({ symbol: q.symbol, price: q.regularMarketPrice, percent_change: q.regularMarketChangePercent }))
                .slice(0, openSlots);
            }
            if (gainers.length > 0) console.log('  [BUY] Using Yahoo Finance (last resort)');
          } catch {}
        }

        // Merge morning plan tickers (priority — research-backed picks)
        let planTickers: string[] = [];
        try {
          const planRaw = this.store.get('morning_plan');
          if (planRaw) {
            const plan = JSON.parse(planRaw);
            const today = new Date().toISOString().slice(0, 10);
            if (plan.date === today && plan.tickers?.length > 0) {
              planTickers = plan.tickers;
              console.log(`  [BUY] Morning plan: ${planTickers.join(', ')}`);
            }
          }
        } catch {}
        for (const pt of planTickers) {
          if (!gainers.some(g => g.symbol === pt)) {
            try {
              const snap = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${pt}&feed=iex`, { headers, signal: AbortSignal.timeout(5000) });
              if (snap.ok) {
                const sd = await snap.json() as any;
                const price = sd[pt]?.latestTrade?.p;
                if (price && price > 5) gainers.unshift({ symbol: pt, price, percent_change: 0 });
              }
            } catch {}
          }
        }

        // Cap per-position to remaining budget / slots, never exceeding $1,400 per position
        const slotsToFill = Math.min(gainers.length || 1, openSlots);
        const perPosition = Math.min(Math.floor(budgetRemaining / slotsToFill), 1400);
        console.log(`  [BUY] ${gainers.length} candidates (${planTickers.length} from plan), $${perPosition}/pos, budget left: $${budgetRemaining.toFixed(0)}`);

        if (perPosition < 50) {
          console.log(`  [BUY] Per-position too small ($${perPosition}) — skipping`);
        }

        let spentThisHeartbeat = 0;
        for (const g of gainers.slice(0, openSlots)) {
          if (spentThisHeartbeat + perPosition > budgetRemaining) {
            console.log(`  [BUY] Budget exhausted this heartbeat — stopping`);
            break;
          }
          try {
            // Skip tickers we sold this session
            if (this._sessionSells.has(g.symbol)) {
              console.log(`  [BUY] SKIP ${g.symbol} — sold this session`);
              continue;
            }
            const history = await brain.getTickerHistory(g.symbol);
            if (history.shouldAvoid) {
              console.log(`  [BUY] SKIP ${g.symbol} — Trident says avoid (${history.wins}W/${history.losses}L)`);
              continue;
            }
            // Neural trader technical confirmation — fetch recent bars and analyze
            if (!isCrypto(g.symbol)) {
              try {
                const barsRes = await fetch(
                  `https://data.alpaca.markets/v2/stocks/${g.symbol}/bars?timeframe=15Min&limit=50&feed=iex`,
                  { headers, signal: AbortSignal.timeout(5000) },
                );
                if (barsRes.ok) {
                  const barsData = await barsRes.json() as any;
                  const bars = barsData.bars || [];
                  if (bars.length >= 30) {
                    for (const bar of bars) this.neural.addBar(g.symbol, bar.c, bar.v);
                    const neuralSignal = await this.neural.analyze(g.symbol);
                    if (neuralSignal && neuralSignal.direction !== 'buy') {
                      console.log(`  [BUY] SKIP ${g.symbol} — neural says ${neuralSignal.direction} (${(neuralSignal.confidence*100).toFixed(0)}%)`);
                      continue;
                    }
                    if (neuralSignal) {
                      console.log(`  [BUY] ${g.symbol} neural CONFIRMED: ${neuralSignal.direction} ${(neuralSignal.confidence*100).toFixed(0)}% — ${neuralSignal.pattern}`);
                    }
                  }
                }
              } catch {}
            }

            const qty = Math.floor(perPosition / g.price);
            if (qty <= 0) continue;
            const signal = {
              id: `mover-${Date.now()}-${g.symbol}`, ticker: g.symbol,
              direction: 'buy' as const, confidence: 0.9, timeframe: '1h' as const,
              indicators: {}, pattern: 'top_mover', timestamp: new Date(), source: 'momentum' as const,
            };
            const order = await this.executor.execute(signal, qty, perPosition);
            console.log(`  [BUY] ${qty} ${g.symbol} @$${g.price.toFixed(2)} (+${g.percent_change.toFixed(1)}%) — ${order.status}`);
            if (order.status === 'filled' || order.status === 'pending') {
              spentThisHeartbeat += qty * g.price;
              this._trackBuy(g.symbol);
            }
            brain.recordBuy(g.symbol, qty, g.price, `TOP MOVER +${g.percent_change.toFixed(1)}%`).catch(() => {});
          } catch (e: any) { console.log(`  [BUY] ${g.symbol} FAILED: ${e.message}`); }
        }
        actions.push({ action: 'buy_movers', priority: 1, durationMs: Date.now() - t0, status: 'success', detail: `Bought movers` });
      } catch (e: any) { errors.push(`buy_movers: ${e.message}`); }
    }

    // 4. Check exits — stop loss, trailing stops, circuit breaker (no rotation, just cut dogs)
    if (mkt.isMarketOpen) {
      try {
        const r = await this.checkExits();
        actions.push(r);
        if (r.status !== 'skipped') console.log(`  [EXITS] ${r.detail} (${r.durationMs}ms)`);
      } catch (e: any) { errors.push(`check_exits: ${e.message}`); }

      // Monitor
      if (this.hbCount % 5 === 0) {
        try {
          const positions = await this.executor.getPositions();
          const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
          console.log(`  [MONITOR] ${positions.length} positions | P&L: $${totalPnl.toFixed(2)}`);
        } catch {}
      }
    }

    // 5. Forex entries — rebuilt with RSI/EMA/BB/momentum (requires 3/4 indicators to agree)
    try {
      await this.forex.fetchQuotes();
      const fxSignals = this.forex.evaluateSessionMomentum();
      if (fxSignals.length > 0) {
        const top = fxSignals.sort((a, b) => b.confidence - a.confidence)[0];
        const open = await this.forex.getOpenTrades();
        if (open.length < 4) {
          try {
            await this.forex.placeOrder(top.symbol, top.direction === 'long' ? 25000 : -25000, top.stopLoss, top.takeProfit);
            console.log(`  [FOREX] ${top.direction.toUpperCase()} ${top.symbol} (${(top.confidence * 100).toFixed(0)}%) — ${top.rationale}`);
          } catch (e: any) { console.log(`  [FOREX] ORDER FAILED ${top.symbol}: ${e.message}`); }
        } else {
          console.log(`  [FOREX] Full (${open.length}/4 positions)`);
        }
      }
    } catch (e: any) { console.log(`  [FOREX] Error: ${e.message}`); }

    // Final position snapshot
    let posCount = 0, deployed = 0;
    try { const p = await this.executor.getPositions(); posCount = p.length; deployed = p.reduce((s, x) => s + Math.abs(x.marketValue), 0); } catch {}

    const dur = Date.now() - t0;
    const result: HeartbeatResult = { heartbeatNumber: this.hbCount, startedAt: new Date(t0).toISOString(), durationMs: dur, actions, positionCount: posCount, totalDeployed: deployed, errors };

    // 6. Write status to state store
    try {
      this.store.set('trade_engine_status', JSON.stringify({
        heartbeatNumber: this.hbCount, lastHeartbeat: result.startedAt, durationMs: dur,
        positionCount: posCount, totalDeployed: deployed,
        actionSummary: actions.map((a) => `${a.action}:${a.status}`).join(','),
        errors, recentActivity: actions.filter((a) => a.status !== 'skipped').map((a) => a.detail).slice(0, 5),
      }));
    } catch (e) { console.error('[TradeEngine] Status write failed:', e); }

    this.recent.push(result);
    if (this.recent.length > 10) this.recent.shift();

    const perf = this.pm.getPerformanceStats();
    console.log(
      `[TradeEngine] === #${this.hbCount} done === ${dur}ms | ${posCount} pos | ` +
      `$${deployed.toFixed(0)} deployed | Daily P&L: $${(perf.dailyPnl || 0).toFixed(2)} | ${errors.length ? `ERRORS: ${errors.length}` : 'OK'}`,
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  getRecentResults(): HeartbeatResult[] { return this.recent; }

  async start(): Promise<void> {
    console.log(`[TradeEngine] Starting — interval: ${HEARTBEAT_MS / 1000}s, max: ${MAX_POSITIONS} pos, budget: $${BUDGET_MAX}`);
    console.log(`[TradeEngine] Alpaca: ${process.env.ALPACA_API_KEY ? 'OK' : 'NOT SET'} | OANDA: ${process.env.OANDA_API_KEY ? 'OK' : 'NOT SET'}`);
    this.stopping = false;
    await this.heartbeat();
    this.timer = setInterval(() => { this.heartbeat().catch((e) => console.error('[TradeEngine] Heartbeat error:', e)); }, HEARTBEAT_MS);
  }

  async stop(): Promise<void> {
    console.log('[TradeEngine] Stopping...');
    this.stopping = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try {
      this.store.set('trade_engine_status', JSON.stringify({
        heartbeatNumber: this.hbCount, lastHeartbeat: new Date().toISOString(),
        durationMs: 0, positionCount: 0, totalDeployed: 0,
        actionSummary: 'shutdown', errors: [], recentActivity: ['Worker stopped'],
      }));
    } catch {}
    try { this.store.close(); } catch {}
    console.log('[TradeEngine] Stopped.');
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

const engine = new TradeEngine();

export async function start(): Promise<void> { await engine.start(); }

process.on('SIGTERM', async () => { console.log('[TradeEngine] SIGTERM'); await engine.stop(); process.exit(0); });
process.on('SIGINT', async () => { console.log('[TradeEngine] SIGINT'); await engine.stop(); process.exit(0); });

if (process.argv[1]?.includes('trade-engine')) {
  start().catch((e) => { console.error('[TradeEngine] Fatal:', e); process.exit(1); });
}

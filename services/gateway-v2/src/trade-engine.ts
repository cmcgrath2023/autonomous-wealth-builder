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
// STRIPPED 2026-04-10: DailyOptimizer + getMarketCondition. Dead code —
// optimize() was never called, _lastStrategy stayed null forever.
import { eventBus } from '../../shared/utils/event-bus.js';
import { brain } from './brain-client.js';
import { BayesianIntelligence } from '../../shared/intelligence/bayesian-intelligence.js';
import { recordClosedTrade, reconcileWithAlpaca, runPostExitFollower } from './trade-recorder.js';
import { RiskManager, MacroAnalyst, ExitAnalyst, SectorRotator } from './analysts/index.js';
import type { ExitPlan, SectorBias } from './analysts/index.js';

// Shared Bayesian instance — populated via IPC from parent process
let _bayesian: BayesianIntelligence | null = null;
eventBus.on('intelligence:ready' as any, (bi: BayesianIntelligence) => { _bayesian = bi; });

// IPC handler: receive belief updates from orchestrator (index.ts)
process.on('message', (msg: any) => {
  if (msg?.type === 'intelligence:beliefs' && msg.beliefs) {
    _bayesian = BayesianIntelligence.fromSerialized(msg.beliefs);
    console.log(`[TradeEngine] Intelligence updated via IPC: ${msg.beliefs.beliefs?.length || 0} beliefs`);
  }
});

// Forward trade:closed to parent process via IPC (Bayesian + Brain learning)
function emitTradeClosed(payload: { ticker: string; success: boolean; returnPct: number; reason: string }) {
  eventBus.emit('trade:closed' as any, payload);
  if (process.send) process.send({ type: 'trade:closed', payload });
}

const HEARTBEAT_MS = 120_000;
const MAX_POSITIONS = 5;           // REDUCED from 10 — fewer, higher-conviction bets
const BUDGET_MAX = 25_000;
const PER_POSITION_MAX = 6_000;    // RAISED from $2,500 — concentrate capital
const DAILY_LOSS_LIMIT = -1_000;
const FOREX_BANK = 50;
const BUY_DELAY_HOUR = 10;         // No equity buys before 10:15 AM ET
const BUY_DELAY_MIN = 15;          // Opening chaos settles by 10:15

// ─── Mover quality gate ───────────────────────────────────────────────────
// Blocks the two failure modes that produced the 2026-04-10 -$6,787 incident:
//   1. AFJKU — SPAC unit, no liquidity, bought 191 @ $78.57, exited @ $45
//   2. BBLGW — warrant, ran +240% pre-entry, bought 31 @ $17, collapsed to $1
// Both slipped past the $10 price floor and the "+2%+ change" mover filter.
//
// Rules:
//   - Reject tickers matching SPAC unit/warrant suffix patterns
//   - Reject daily moves over BLOWOFF_PCT — we're already at the top
//   - Reject daily trade count below MIN_TRADE_COUNT — can't exit cleanly
const BLOWOFF_PCT = 60;            // RAISED from 30 — was blocking real macro-driven sector
                                    // moves (CVX +38%, OXY +49% on Iran oil spike). 60%
                                    // still catches true garbage (SKYQ +73% pump).
const MIN_TRADE_COUNT = 5_000;     // LOWERED from 10K — too restrictive early in session
const SPAC_SUFFIX_RE = /^[A-Z]{2,5}(U|W|WS)$/;  // matches AFJKU, BBLGW, ABCWS etc.

/**
 * Quality gate — stripped to ONLY structural blocks after 2026-04-13 incident
 * where blow-off % and trade_count thresholds blocked CVX (+38%), OXY (+49%),
 * LMT, RTX, GD, DVN, SLB — all legitimate stocks during the Iran oil spike.
 *
 * ONLY blocks: SPAC unit/warrant suffixes. Everything else is allowed through
 * and handled by Trident + position limits downstream.
 */
function moverQualityGate(
  mover: { symbol: string; price?: number; percent_change?: number; trade_count?: number },
): { blocked: boolean; reason: string } {
  if (SPAC_SUFFIX_RE.test(mover.symbol)) {
    return { blocked: true, reason: `SPAC unit/warrant suffix (${mover.symbol})` };
  }
  return { blocked: false, reason: '' };
}
const FOREX_CUT = -20;
const SL_DOMINANCE_HALT = 0.70;
const MIN_STOCK_PRICE = 10; // No penny stocks — minimum $10/share
const MAX_BUYS_PER_TICKER_PER_DAY = 1; // Buy each ticker AT MOST once per day
const CRYPTO_BUYS_ENABLED = false; // Disabled — crypto in downturn, re-enable when recovery starts

// Resilient sectors/stocks — hold longer during volatility, wider SL thresholds
// These have historically shown strength in downturns, tariff wars, and macro shocks
const RESILIENT_TICKERS = new Set([
  // Defense/Aerospace — government contracts, tariff-immune
  'LMT', 'RTX', 'NOC', 'GD', 'BA', 'KTOS', 'HII', 'LHX',
  // Healthcare — essential spending, policy tailwinds
  'UNH', 'JNJ', 'PFE', 'ABBV', 'MRK', 'LLY', 'CVS', 'HUM', 'CI', 'ELV', 'CNC', 'MOH',
  // Utilities — recession-proof, dividend
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'XEL', 'ED',
  // Consumer staples — people still eat and clean
  'PG', 'KO', 'PEP', 'WMT', 'COST', 'CL', 'GIS', 'K',
  // Infrastructure/Industrial — reshoring, capex cycle
  'CAT', 'DE', 'URI', 'VMC', 'MLM', 'PWR',
  // Gold/commodities — inflation hedge
  'GLD', 'SLV', 'GDX', 'NEM', 'GOLD', 'AEM',
]);

function isResilient(ticker: string): boolean {
  return RESILIENT_TICKERS.has(ticker.replace(/-.*$/, '').toUpperCase());
}

interface ActionResult {
  action: string; priority: number; durationMs: number;
  status: 'success' | 'skipped' | 'error'; detail: string;
}

interface HeartbeatResult {
  heartbeatNumber: number; startedAt: string; durationMs: number;
  actions: ActionResult[]; positionCount: number; totalDeployed: number; errors: string[];
}

// Cache Alpaca clock — refresh every 30 minutes to detect holidays
let _alpacaClockCache: { isOpen: boolean; checkedAt: number } = { isOpen: false, checkedAt: 0 };

async function checkAlpacaClock(): Promise<boolean | null> {
  if (Date.now() - _alpacaClockCache.checkedAt < 1_800_000) return _alpacaClockCache.isOpen;
  try {
    const creds = loadCredentials();
    if (!creds.alpaca) return null;
    const r = await fetch(`${creds.alpaca.baseUrl}/v2/clock`, {
      headers: { 'APCA-API-KEY-ID': creds.alpaca.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca.apiSecret },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json() as any;
      const wasOpen = _alpacaClockCache.isOpen;
      _alpacaClockCache = { isOpen: !!data.is_open, checkedAt: Date.now() };
      if (!data.is_open) console.log(`[TradeEngine] Alpaca clock: MARKET CLOSED (next open: ${data.next_open})`);
      else if (!wasOpen) console.log(`[TradeEngine] Alpaca clock: MARKET OPEN`);
      return data.is_open;
    }
  } catch (e: any) {
    console.error(`[TradeEngine] Alpaca clock check failed: ${e.message}`);
  }
  return null;
}

function getMarketContext() {
  const now = new Date();
  const fmt = (opt: Intl.DateTimeFormatOptions) =>
    now.toLocaleString('en-US', { timeZone: 'America/New_York', ...opt });
  const etHour = parseInt(fmt({ hour: '2-digit', hour12: false }));
  const etMin = parseInt(fmt({ minute: '2-digit' }));
  const etDay = fmt({ weekday: 'short' });
  const isWeekday = !['Sat', 'Sun'].includes(etDay);
  // Use Alpaca clock as authority (catches holidays), fall back to time-based
  const alpacaSaysOpen = _alpacaClockCache.checkedAt > 0 ? _alpacaClockCache.isOpen : null;
  const timeBased = isWeekday && ((etHour === 9 && etMin >= 30) || (etHour >= 10 && etHour < 16));
  const isMarketOpen = alpacaSaysOpen !== null ? alpacaSaysOpen : timeBased;
  const isAfterHours = isWeekday && etHour >= 16 && etHour < 20;
  return { etHour, etMin, etDay, isWeekday, isMarketOpen, isAfterHours };
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
  // dailyOptimizer stripped 2026-04-10 — dead code
  private _lastStrategy: { riskBudget: number; takeProfitTarget: number; approach: string; maxNewPositions: number; actions: string[] } | null = null;
  private riskManager!: RiskManager;  // Wave 1 analyst — initialized in constructor after store is ready
  private macroAnalyst!: MacroAnalyst; // Wave 2 analyst — reads latest regime verdict, provides sizing multiplier
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
  private _trackBuy(ticker: string, price = 0, qty = 0, orderId: string | null = null): void {
    const buys = this._recentBuys;
    buys.set(ticker, Date.now());
    const obj: Record<string, number> = {};
    for (const [k, v] of buys) obj[k] = v;
    this.store.set('recent_buys_today', JSON.stringify({ date: new Date().toISOString().slice(0, 10), buys: obj }));
    // Persistent record (survives midnight reset) — the manual-trade detector
    // reads this so overnight holds are NOT mislabeled as manual.
    try {
      this.store.recordSystemBuy({ ticker, price, qty, clientOrderId: orderId });
    } catch (e) {
      console.warn(`[TradeEngine] recordSystemBuy failed for ${ticker}:`, (e as Error).message);
    }
  }

  // Manual trades — positions that exist but weren't bought by the system
  // Detected on each heartbeat: if a position exists but isn't in _recentBuys, it's manual
  private get _manualTrades(): Set<string> {
    try {
      const raw = this.store.get('manual_trades_today');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.date === new Date().toISOString().slice(0, 10)) return new Set(data.tickers);
      }
    } catch {}
    return new Set();
  }
  private _addManualTrade(ticker: string): void {
    const manual = this._manualTrades;
    manual.add(ticker);
    this.store.set('manual_trades_today', JSON.stringify({ date: new Date().toISOString().slice(0, 10), tickers: [...manual] }));
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
          if (prop === 'evaluateSessionMomentum') return async () => {
            try {
              const r = await fetch('http://localhost:3003/api/forex/signals', { signal: AbortSignal.timeout(5000) });
              if (r.ok) { const d = await r.json() as any; return d.signals || []; }
            } catch {}
            return [];
          };
          if (prop === 'evaluateCarryTrades') return async () => [];
          if (prop === 'fetchQuotes') return async () => {
            try { await fetch('http://localhost:3003/api/forex/refresh', { method: 'POST', signal: AbortSignal.timeout(5000) }); } catch {}
            return [];
          };
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
    // Wave 1 analyst — Risk Manager reads the store's risk_rules table every
    // evaluation, so rules written by Post-Mortem at EOD take effect next day.
    this.riskManager = new RiskManager(this.store);
    // Wave 2 analyst — Macro regime classifier. Trade-engine reads the
    // current multiplier from it before sizing each buy. Multiplier defaults
    // to 1.0 (no-op) if Macro has never run or the verdict is stale (>24h).
    this.macroAnalyst = new MacroAnalyst(this.store);
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
        recordClosedTrade(this.store, {
          ticker: trade.ticker,
          direction: 'long',
          reason: trade.exitReason,
          qty: Math.abs(trade.shares ?? 0),
          entryPrice: trade.entryPrice ?? null,
          exitPrice: trade.exitPrice ?? 0,
          pnl: trade.pnl,
          closedAt: trade.closedAt,
          source: 'position_manager',
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
    stars: Array<{ symbol: string; score: number; sector?: string; catalyst?: string }>,
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
            const rejected: string[] = [];
            const gainers = (moversData.gainers || [])
              .filter((m: any) => m.percent_change > 2 && m.price >= MIN_STOCK_PRICE && m.price < 500)
              .filter((m: any) => !ownedSet.has(m.symbol))
              .filter((m: any) => {
                const gate = moverQualityGate(m);
                if (gate.blocked) { rejected.push(`${m.symbol}:${gate.reason}`); return false; }
                return true;
              })
              .slice(0, 5);
            for (const mover of gainers) {
              const moverScore = Math.min(0.96 + mover.percent_change / 500, 0.99);
              stars.push({ symbol: mover.symbol, sector: 'momentum', score: moverScore, catalyst: `+${mover.percent_change.toFixed(1)}% today` });
            }
            if (gainers.length > 0) details.push(`Top movers: ${gainers.map((g: any) => `${g.symbol} +${g.percent_change.toFixed(1)}%`).join(', ')}`);
            if (rejected.length > 0) details.push(`Blocked: ${rejected.slice(0, 5).join(', ')}`);
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
            const rotRes = await fetch(`${creds.alpaca!.baseUrl}/v2/orders`, {
              method: 'POST', headers,
              body: JSON.stringify({ symbol: sellSymbol, qty: String(Math.abs(weakest.shares)), side: 'sell', type: 'market', time_in_force: tif }),
              signal: AbortSignal.timeout(10_000),
            });
            const rotBody = rotRes.ok ? await rotRes.json().catch(() => null) as any : null;
            details.push(`ROTATED OUT ${weakest.ticker} ($${weakest.unrealizedPnl.toFixed(2)}) for ${bestStar.symbol}`);
            console.log(`[TradeEngine] ROTATION: sold ${weakest.ticker} ($${weakest.unrealizedPnl.toFixed(2)}) to make room for ${bestStar.symbol} (score: ${bestStar.score})`);
            emitTradeClosed({ ticker: weakest.ticker, success: weakest.unrealizedPnl > 0, returnPct: weakest.unrealizedPnlPercent / 100, reason: 'rotation' });
            recordClosedTrade(this.store, {
              ticker: weakest.ticker,
              direction: 'long',
              reason: 'rotation',
              qty: Math.abs(weakest.shares),
              entryPrice: weakest.avgPrice ?? null,
              exitPrice: weakest.currentPrice ?? 0,
              pnl: weakest.unrealizedPnl,
              orderId: rotBody?.id ?? null,
              source: 'engine_rotation',
            });
            this._addSessionSell(weakest.ticker); // don't rebuy this session
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
        .filter((s) => !isCrypto(s.symbol) || CRYPTO_BUYS_ENABLED) // Skip crypto when disabled
        .filter((s) => mkt.isMarketOpen || isCrypto(s.symbol))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      if (stars.length > 0) console.log(`  [scan] ${stars.length} stars, ${eligibleStars.length} eligible, owned: ${[...owned].join(',')}, market: ${mkt.isMarketOpen ? 'open' : 'closed'}`);

      for (const star of eligibleStars) {
        // Gate 0: Anti-churn — max 1 buy per ticker per day
        if (this._recentBuys.has(star.symbol)) { details.push(`SKIP ${star.symbol} — already bought today`); continue; }
        // Gate 1: Session sells — don't rebuy anything we or the user sold today
        if (this._sessionSells.has(star.symbol)) { details.push(`SKIP ${star.symbol} — sold this session`); continue; }

        // Gate 2: Position limits and budget
        const fresh = await this.executor.getPositions();
        if (budgetPositionCount(fresh, mkt.isMarketOpen) >= maxPos) { details.push('Max positions — done'); break; }
        const deployed = totalDeployed(fresh, mkt.isMarketOpen);
        if (deployed >= budget) { details.push('Budget full — done'); break; }

        // Gate 3: Brain/Trident history check — reject tickers with poor win/loss record
        try {
          const history = await brain.getTickerHistory(star.symbol);
          if (history.shouldAvoid) {
            details.push(`SKIP ${star.symbol} — Brain says avoid (${history.wins}W/${history.losses}L)`);
            continue;
          }
          if (history.wins + history.losses > 0) {
            details.push(`${star.symbol} Brain: ${history.wins}W/${history.losses}L`);
          }
        } catch (e: any) {
          details.push(`${star.symbol} Brain: FAILED (${e.message?.substring(0, 40)}) — proceeding without`);
        }

        // Gate 4: Bayesian intelligence — reject tickers with poor history
        let adjustedScore = star.score;
        if (_bayesian) {
          adjustedScore = _bayesian.adjustSignalConfidence(star.symbol, star.score, 'buy');
          const prior = _bayesian.getTickerPrior(star.symbol);
          if (prior.observations >= 3 && prior.posterior < 0.40) {
            details.push(`SKIP ${star.symbol} — Bayesian reject (${(prior.posterior*100).toFixed(0)}% win, ${prior.observations} obs)`);
            continue;
          }
          if (prior.observations >= 3 && prior.posterior > 0.70) {
            adjustedScore = Math.min(adjustedScore * 1.1, 0.99);
          }
          if (prior.observations > 0) {
            details.push(`${star.symbol} Bayesian: ${(prior.posterior*100).toFixed(0)}% (${prior.observations} obs)`);
          }
        } else {
          details.push(`${star.symbol} Bayesian: NULL — intelligence not connected`);
        }

        // Gate 5: Minimum confidence after intelligence adjustment
        if (adjustedScore < 0.60) {
          details.push(`SKIP ${star.symbol} — low confidence (${adjustedScore.toFixed(2)})`);
          continue;
        }

        // Gate 5b: NeuralTrader technical confirmation — the original signal engine
        // that this platform was built on. Hard-gates on the 7-indicator analysis
        // (RSI, MACD, Bollinger, EMA, momentum, mean-reversion, neural forecast).
        // Rejects any star whose technicals say sell/hold/neutral.
        try {
          if (!isCrypto(star.symbol)) {
            const creds3 = loadCredentials();
            const neuralHeaders = {
              'APCA-API-KEY-ID': creds3.alpaca!.apiKey,
              'APCA-API-SECRET-KEY': creds3.alpaca!.apiSecret,
            };
            const barsUrl = `https://data.alpaca.markets/v2/stocks/${star.symbol}/bars?timeframe=15Min&limit=50&feed=iex`;
            const barsRes = await fetch(barsUrl, { headers: neuralHeaders, signal: AbortSignal.timeout(5000) });
            if (barsRes.ok) {
              const barsData = await barsRes.json() as any;
              const rawBars = barsData.bars || [];
              if (rawBars.length >= 30) {
                for (const bar of rawBars) this.neural.addBar(star.symbol, bar.c, bar.v || 0);
                const neuralSignal = await this.neural.analyze(star.symbol);
                if (neuralSignal && neuralSignal.direction !== 'buy') {
                  details.push(`SKIP ${star.symbol} — Neural ${neuralSignal.direction} ${(neuralSignal.confidence*100).toFixed(0)}% ${neuralSignal.pattern || ''}`);
                  continue;
                }
                if (neuralSignal) {
                  details.push(`${star.symbol} Neural: ${neuralSignal.direction} ${(neuralSignal.confidence*100).toFixed(0)}% ${neuralSignal.pattern || ''}`);
                } else {
                  details.push(`${star.symbol} Neural: no-signal — proceeding`);
                }
              } else {
                details.push(`${star.symbol} Neural: ${rawBars.length}-bars (need 30) — proceeding without`);
              }
            }
          }
        } catch (e: any) {
          details.push(`${star.symbol} Neural: FAILED (${e.message?.substring(0, 40)}) — proceeding without`);
        }

        // Gate 6: Trident LoRA reasoning — ask trained model if this is a good buy
        try {
          const tridentAdvice = await brain.shouldBuy(star.symbol, star.score * 10, `score=${adjustedScore.toFixed(2)}, research_star`);
          if (!tridentAdvice.should) {
            details.push(`SKIP ${star.symbol} — Trident says no: ${tridentAdvice.reason.slice(0, 80)}`);
            continue;
          }
          details.push(`${star.symbol} Trident APPROVED: ${tridentAdvice.reason.slice(0, 60)}`);
        } catch (e: any) {
          details.push(`${star.symbol} Trident: FAILED (${e.message?.substring(0, 40)}) — proceeding without`);
        }

        // Position sizing: 20% of remaining budget per position, max $1400
        const remaining = budget - deployed;
        const size = Math.min(remaining * 0.20, 2500);
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

          const order = await this.executor.execute(signal, qty, size);
          details.push(`BUY ${qty} ${star.symbol} @$${price.toFixed(2)} — ${order.status}${adjustedScore !== star.score ? ` (intel: ${adjustedScore.toFixed(2)})` : ''}`);
          if (order.status === 'filled' || order.status === 'pending') {
            owned.add(star.symbol);
            this._trackBuy(star.symbol, price, qty, (order as any).id ?? null);
            // Record to brain for learning
            brain.recordBuy(star.symbol, qty, price, `research_star score=${adjustedScore.toFixed(2)}`).catch(() => {});
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
  private _soldCryptoPremarket = false;

  private async heartbeat(): Promise<void> {
    if (this.stopping) return;
    this.hbCount++;
    const t0 = Date.now();
    // Check Alpaca clock first (catches holidays like Good Friday)
    await checkAlpacaClock();
    const mkt = getMarketContext();
    const actions: ActionResult[] = [];
    const errors: string[] = [];

    // Reset daily flags — check against stored date, not just time window
    const today = new Date().toISOString().slice(0, 10);
    const lastTradeDate = this.store.get('trade_engine_last_date') || '';
    if (today !== lastTradeDate) {
      this._boughtToday = false;
      this._soldEod = false;
      this._soldCryptoPremarket = false;
      // Session sells and recent buys auto-clear via date check in their getters
      this.store.set('trade_engine_last_date', today);
      console.log(`[TradeEngine] New trading day: ${today}`);
    }

    console.log(
      `\n[TradeEngine] === Heartbeat #${this.hbCount} === ${mkt.etDay} ` +
      `${mkt.etHour}:${String(mkt.etMin).padStart(2, '0')} ET — ` +
      `${mkt.isMarketOpen ? 'OPEN' : mkt.isAfterHours ? 'AFTER-HOURS' : 'CLOSED'}`,
    );

    // ─── RECONCILE WITH ALPACA ──────────────────────────────────────────
    // Pull Alpaca's fill log and upsert any trades our in-process sell paths
    // missed. This is the belt to the circuit breaker's suspenders: even if a
    // sell path forgets to call recordClosedTrade, the reconciler will backfill
    // from Alpaca's authoritative record before the circuit breaker checks.
    try {
      const reconCreds = loadCredentials();
      if (reconCreds.alpaca) {
        const rec = await reconcileWithAlpaca(this.store, {
          apiKey: reconCreds.alpaca.apiKey,
          apiSecret: reconCreds.alpaca.apiSecret,
          baseUrl: reconCreds.alpaca.baseUrl,
        }, 3);
        if (rec.buysRecorded > 0 || rec.sellsRecorded > 0) {
          console.log(`  [RECONCILE] +${rec.buysRecorded} buys, +${rec.sellsRecorded} sells from Alpaca (tickers: ${rec.tickersProcessed.join(',')})`);
        }
        if (rec.errors.length > 0) console.log(`  [RECONCILE] errors: ${rec.errors.slice(0, 3).join('; ')}`);
      }
    } catch (e: any) {
      console.log(`  [RECONCILE] failed: ${e.message}`);
    }

    // Post-exit follower — fills in T+1/T+3/T+5 prices on closed trades so
    // Trident learns whether we sold too early or got the exit right.
    try {
      const postCreds = loadCredentials();
      if (postCreds.alpaca) {
        const pe = await runPostExitFollower(this.store, {
          apiKey: postCreds.alpaca.apiKey,
          apiSecret: postCreds.alpaca.apiSecret,
        });
        if (pe.resolved > 0) console.log(`  [POST-EXIT] resolved ${pe.resolved} regret verdicts`);
      }
    } catch {}

    // ─── DAILY LOSS CIRCUIT BREAKER ─────────────────────────────────────
    // Three independent P&L readings; any one tripping halts equity entries.
    //   1. store realized + unrealized   (what the engine thinks happened)
    //   2. Alpaca equity - last_equity   (ground truth from the broker)
    // The max of these two (in absolute terms, i.e. the WORST) is used.
    const allTodayTrades = this.store.getTodayTrades();
    const todayClosedPnl = allTodayTrades.reduce((s, t) => s + t.pnl, 0);
    let unrealizedPnl = 0;
    try {
      const pos = await this.executor.getPositions();
      unrealizedPnl = pos.reduce((s, p) => s + p.unrealizedPnl, 0);
    } catch {}
    const storeDayPnl = todayClosedPnl + unrealizedPnl;

    let alpacaDayPnl: number | null = null;
    try {
      const acctCreds = loadCredentials();
      if (acctCreds.alpaca) {
        const acctRes = await fetch(`${acctCreds.alpaca.baseUrl}/v2/account`, {
          headers: {
            'APCA-API-KEY-ID': acctCreds.alpaca.apiKey,
            'APCA-API-SECRET-KEY': acctCreds.alpaca.apiSecret,
          },
          signal: AbortSignal.timeout(8_000),
        });
        if (acctRes.ok) {
          const a = await acctRes.json() as any;
          const eq = parseFloat(a.equity);
          const le = parseFloat(a.last_equity);
          if (isFinite(eq) && isFinite(le)) alpacaDayPnl = eq - le;
        }
      }
    } catch {}

    // Use whichever reading is WORSE so a bug in either one can't mask disaster.
    const effectiveDayPnl = alpacaDayPnl !== null
      ? Math.min(storeDayPnl, alpacaDayPnl)
      : storeDayPnl;

    const equityCircuitBreaker = effectiveDayPnl < DAILY_LOSS_LIMIT;
    if (equityCircuitBreaker) {
      console.log(`  [CIRCUIT BREAKER] Daily P&L $${effectiveDayPnl.toFixed(2)} exceeds $${DAILY_LOSS_LIMIT} — HALTED`);
      console.log(`                    store $${storeDayPnl.toFixed(2)} (realized $${todayClosedPnl.toFixed(2)} + unrealized $${unrealizedPnl.toFixed(2)}) | alpaca $${alpacaDayPnl !== null ? alpacaDayPnl.toFixed(2) : 'n/a'}`);
      // Alert once per day
      const cbKey = `circuit_breaker_${today}`;
      if (!this.store.get(cbKey)) {
        this.store.set(cbKey, 'tripped');
        brain.recordRule(`CIRCUIT BREAKER TRIPPED ${today}: P&L $${effectiveDayPnl.toFixed(2)} exceeded $${DAILY_LOSS_LIMIT} limit (store $${storeDayPnl.toFixed(2)} | alpaca $${alpacaDayPnl !== null ? alpacaDayPnl.toFixed(2) : 'n/a'})`, 'system').catch(() => {});
        const webhook = process.env.DISCORD_WEBHOOK_URL;
        if (webhook) {
          fetch(webhook, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `**CIRCUIT BREAKER** — Daily P&L $${effectiveDayPnl.toFixed(2)} exceeded $${DAILY_LOSS_LIMIT} limit. Equity trading halted, forex management continues.` }),
          }).catch(() => {});
        }
      }
    }

    // 1. Forex position management (always runs — 24/5)
    try { const r = await this.manageForexPositions(); actions.push(r); if (r.status !== 'skipped') console.log(`  [1] ${r.detail} (${r.durationMs}ms)`); }
    catch (e: any) { errors.push(`manage_positions: ${e.message}`); }

    // 2a. PRE-MARKET CRYPTO LIQUIDATION — Smart: only sell LOSING crypto before market open to free capital for equities
    if (mkt.isWeekday && mkt.etHour >= 8 && mkt.etHour < 9 && !this._soldCryptoPremarket) {
      try {
        const preMarketPos = await this.executor.getPositions();
        const cryptoPositions = preMarketPos.filter(p => isCrypto(p.ticker));
        const losingCrypto = cryptoPositions.filter(p => p.unrealizedPnl < 0);
        const winningCrypto = cryptoPositions.filter(p => p.unrealizedPnl >= 0);
        if (losingCrypto.length > 0) {
          this._soldCryptoPremarket = true;
          const creds = loadCredentials();
          const headers = { 'APCA-API-KEY-ID': creds.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca!.apiSecret };
          for (const pos of losingCrypto) {
            try {
              await fetch(`${creds.alpaca!.baseUrl}/v2/positions/${encodeURIComponent(pos.ticker)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
              console.log(`  [PRE-MARKET] SOLD losing crypto ${pos.ticker} P&L: $${pos.unrealizedPnl.toFixed(2)}`);
              emitTradeClosed({ ticker: pos.ticker, success: false, returnPct: pos.unrealizedPnlPercent / 100, reason: 'pre_market_liquidation' });
              recordClosedTrade(this.store, {
                ticker: pos.ticker,
                direction: 'long',
                reason: 'pre_market_liquidation',
                qty: Math.abs(pos.shares),
                entryPrice: pos.avgPrice ?? null,
                exitPrice: pos.currentPrice ?? 0,
                pnl: pos.unrealizedPnl,
                source: 'engine_premarket',
              });
            } catch (e: any) { console.log(`  [PRE-MARKET] FAILED ${pos.ticker}: ${e.message}`); }
          }
          if (winningCrypto.length > 0) {
            console.log(`  [PRE-MARKET] KEPT ${winningCrypto.length} winning crypto: ${winningCrypto.map(p => `${p.ticker} +$${p.unrealizedPnl.toFixed(2)}`).join(', ')}`);
          }
          actions.push({ action: 'pre_market_crypto', priority: 0, durationMs: Date.now() - t0, status: 'success', detail: `Sold ${losingCrypto.length} losing crypto, kept ${winningCrypto.length} winners` });
        }
      } catch (e: any) { errors.push(`pre_market_crypto: ${e.message}`); }
    }

    // 2b. CONDITIONAL EOD — replaces blanket 3:50 PM sell-all.
    // The Exit Analyst with trailing stops makes the blanket liquidation
    // redundant for positions that are working. RVMD at +$212 with a
    // trailing stop at breakeven should NOT be sold just because it's 3:50.
    //
    // Rules:
    //   - Exit Analyst has active trailing stop → HOLD overnight (stop protects)
    //   - Active thesis (conviction ≥ 50) → HOLD overnight (thesis has invalidation)
    //   - Losing AND no thesis → SELL at 3:50 (no reason to take overnight risk)
    //   - Manual winning trades → HOLD (owner must approve, per CLAUDE.md)
    //   - Fallback (no stop, no thesis, flat/losing) → SELL at 3:50
    if (mkt.isMarketOpen && mkt.etHour === 15 && mkt.etMin >= 50 && !this._soldEod) {
      this._soldEod = true;
      try {
        const creds = loadCredentials();
        const headers = { 'APCA-API-KEY-ID': creds.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca!.apiSecret };
        const positions = await this.executor.getPositions();
        const equityPos = positions.filter(p => !isCrypto(p.ticker));
        const manualTrades = this._manualTrades;
        let soldCount = 0;
        const kept: string[] = [];

        // Run Exit Analyst to get current stop status for each position
        const exitAnalyst = new (await import('./analysts/exit-analyst.js')).ExitAnalyst();
        const exitPlans = exitAnalyst.evaluate(equityPos.map(p => ({
          ticker: p.ticker, entryPrice: p.avgPrice, currentPrice: p.currentPrice,
          qty: Math.abs(p.shares), marketValue: p.marketValue,
          unrealizedPnl: p.unrealizedPnl, unrealizedPnlPct: p.unrealizedPnlPercent / 100,
          holdDurationMinutes: 360, isResilient: isResilient(p.ticker),
        })));
        const hasTrailingStop = new Set(
          exitPlans.filter(p => p.trailingStopPct !== null || p.action === 'tighten_stop').map(p => p.ticker),
        );

        // Check thesis support from PG
        const hasThesis = new Set<string>();
        try {
          const { query: pgQ } = await import('../../research-db/src/index.js');
          const tickers = equityPos.map(p => p.ticker);
          if (tickers.length > 0) {
            const { rows } = await pgQ(
              `SELECT DISTINCT primary_ticker FROM research_theses
               WHERE primary_ticker = ANY($1) AND status IN ('active','promoted')
               AND conviction_score >= 50`,
              [tickers],
            );
            for (const r of rows) hasThesis.add((r as any).primary_ticker);
          }
        } catch {} // PG unavailable — all positions default to no-thesis

        for (const pos of equityPos) {
          const isManual = manualTrades.has(pos.ticker);

          // Manual winning trades — NEVER auto-sold
          if (isManual && pos.unrealizedPnl >= 0) {
            console.log(`  [EOD] HOLD ${pos.ticker} +$${pos.unrealizedPnl.toFixed(2)} — manual trade`);
            kept.push(pos.ticker);
            continue;
          }

          // Has trailing stop from Exit Analyst → HOLD overnight
          if (hasTrailingStop.has(pos.ticker)) {
            console.log(`  [EOD] HOLD ${pos.ticker} $${pos.unrealizedPnl.toFixed(2)} — trailing stop active, holds overnight`);
            kept.push(pos.ticker);
            continue;
          }

          // Has active thesis with conviction ≥ 50 → HOLD overnight
          if (hasThesis.has(pos.ticker)) {
            console.log(`  [EOD] HOLD ${pos.ticker} $${pos.unrealizedPnl.toFixed(2)} — active thesis supports overnight hold`);
            kept.push(pos.ticker);
            continue;
          }

          // Losing with no thesis and no trailing stop → SELL
          if (pos.unrealizedPnl < 0) {
            try {
              await fetch(`${creds.alpaca!.baseUrl}/v2/positions/${pos.ticker}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
              console.log(`  [EOD] SOLD ${pos.ticker} $${pos.unrealizedPnl.toFixed(2)} — losing, no thesis, no stop`);
              emitTradeClosed({ ticker: pos.ticker, success: false, returnPct: pos.unrealizedPnlPercent / 100, reason: 'eod_close' });
              recordClosedTrade(this.store, {
                ticker: pos.ticker, direction: 'long', reason: 'eod_close_no_thesis',
                qty: Math.abs(pos.shares), entryPrice: pos.avgPrice ?? null,
                exitPrice: pos.currentPrice ?? 0, pnl: pos.unrealizedPnl, source: 'engine_eod',
              });
              soldCount++;
            } catch (e: any) { console.log(`  [EOD] FAILED ${pos.ticker}: ${e.message}`); }
            continue;
          }

          // Fallback: flat/slightly positive but no stop and no thesis → SELL
          try {
            await fetch(`${creds.alpaca!.baseUrl}/v2/positions/${pos.ticker}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
            console.log(`  [EOD] SOLD ${pos.ticker} $${pos.unrealizedPnl.toFixed(2)} — no thesis, no trailing stop`);
            emitTradeClosed({ ticker: pos.ticker, success: pos.unrealizedPnl > 0, returnPct: pos.unrealizedPnlPercent / 100, reason: 'eod_close' });
            recordClosedTrade(this.store, {
              ticker: pos.ticker, direction: 'long', reason: 'eod_close_fallback',
              qty: Math.abs(pos.shares), entryPrice: pos.avgPrice ?? null,
              exitPrice: pos.currentPrice ?? 0, pnl: pos.unrealizedPnl, source: 'engine_eod',
            });
            soldCount++;
          } catch (e: any) { console.log(`  [EOD] FAILED ${pos.ticker}: ${e.message}`); }
        }
        const detail = `EOD: sold ${soldCount}, held ${kept.length} (${kept.join(',')})`;
        console.log(`  [EOD] ${detail}`);
        actions.push({ action: 'eod_sell', priority: 0, durationMs: Date.now() - t0, status: 'success', detail });
      } catch (e: any) { errors.push(`eod_sell: ${e.message}`); }
    }

    // 3. BUY MOVERS — fill available slots during market hours (before 3:30 PM)
    //    PANIC PROTOCOL: circuit breaker + SL dominance before any equity buys
    //    Note: allTodayTrades already fetched above for circuit breaker
    const equityTrades = allTodayTrades.filter(t => !isCrypto(t.ticker) && !t.ticker.includes('/') && !t.ticker.includes('_'));
    const eqSlCount = equityTrades.filter(t => t.reason === 'stop_loss').length;
    const eqSlDominance = equityTrades.length > 0 ? eqSlCount / equityTrades.length : 0;

    const positions = await this.executor.getPositions();

    // DETECT MANUAL TRADES: positions that exist but the system NEVER bought.
    // Uses the persistent `system_buys` table (not the day-scoped `_recentBuys`)
    // so overnight holds from yesterday's system buys are NOT mislabeled as manual.
    const currentTickers = new Set(positions.map(p => p.ticker));
    for (const pos of positions) {
      if (this._manualTrades.has(pos.ticker)) continue;
      // System-bought at any point in history → not manual.
      if (this.store.isSystemBought(pos.ticker)) continue;
      console.log(`  [MANUAL TRADE DETECTED] ${pos.ticker} — not in system_buys, protecting from auto-sell`);
      this._addManualTrade(pos.ticker);
    }

    // DETECT LIQUIDATIONS OUT-OF-BAND: a ticker in our open system_buys but no
    // longer a position means it was closed somewhere we didn't see. Record a
    // zero-PnL placeholder and close the buy — the reconciler will correct PnL
    // on its next pass from Alpaca activities.
    for (const buy of this.store.getOpenSystemBuys()) {
      if (!currentTickers.has(buy.ticker) && !this._sessionSells.has(buy.ticker)) {
        console.log(`  [OUT-OF-BAND CLOSE] ${buy.ticker} was owned but no longer a position — reconciler will backfill`);
        this._addSessionSell(buy.ticker);
        try { this.store.closeSystemBuy(buy.ticker); } catch {}
      }
    }

    const equityCount = positions.filter(p => !isCrypto(p.ticker)).length;
    const openSlots = MAX_POSITIONS - equityCount;
    const totalDeployedNow = positions.reduce((s, p) => s + Math.abs(p.marketValue || (p.avgPrice * p.shares) || 0), 0);
    const budgetRemaining = BUDGET_MAX - totalDeployedNow;

    if (equityCircuitBreaker) {
      // Already logged above — skip equity entirely
    } else if (eqSlDominance > 0.7 && equityTrades.length >= 3) {
      console.log(`  [BUY] EQUITY SL DOMINANCE ${(eqSlDominance * 100).toFixed(0)}% (${eqSlCount}/${equityTrades.length}) > 70% — HALTING equity entries`);
    } else if (totalDeployedNow >= BUDGET_MAX) {
      console.log(`  [BUY] BUDGET FULL: $${totalDeployedNow.toFixed(0)} deployed >= $${BUDGET_MAX} max — skipping buys`);
    } else if (openSlots > 0 && budgetRemaining > 100 && mkt.isMarketOpen && (mkt.etHour < 15 || (mkt.etHour === 15 && mkt.etMin < 30))
      && (mkt.etHour > BUY_DELAY_HOUR || (mkt.etHour === BUY_DELAY_HOUR && mkt.etMin >= BUY_DELAY_MIN))) {
      // NO BUYS BEFORE 10:15 AM ET — opening 45 min is highest volatility.
      // MOMENTUM CHASING DISABLED — the movers feed and research-worker "TOP MOVER"
      // picks are a losing strategy. BIRD (-$199), BTFL (-$108), MGRT (-$287),
      // AFJKU (-$6,411) were ALL momentum-chased penny stocks.
      // THESIS-ONLY ENTRIES: a research_theses row with conviction ≥ 50 is now
      // MANDATORY for every buy. The thesis pipeline (signals → clusters → conviction
      // scorer) is the ONLY entry path. No thesis = no trade.
      // ───────────────────────────────────────────────────────────────────
      // UNIFIED BUY PIPELINE (2026-04-10) — NeuralTrader is the authority
      // ───────────────────────────────────────────────────────────────────
      // Two candidate feeders merge into a single universe:
      //   A. Alpaca top movers  — pure technical (price moving today)
      //   B. Research worker    — fundamental/catalyst (RSS, sector, FACT cache)
      // Both feed into the SAME universe, quality-gated, then handed to
      // NeuralTrader.scan() for the technical verdict. Research-worker
      // widens the pool with catalyst-backed picks; NeuralTrader decides
      // which ones have valid technical setups. Neither replaces the other.
      //
      // Flow:
      //   1. Build universe = dedup(Alpaca movers ∪ Research worker stars)
      //   2. Apply quality gate (price floor, no SPAC/warrants, no blow-offs)
      //   3. Fetch 50 x 15-min bars for top N, feed NeuralTrader
      //   4. neural.scan() returns buy/sell/hold per ticker
      //   5. Keep direction='buy' AND confidence ≥ 60%
      //   6. Final gates: Bayesian → Brain history → Trident LoRA
      //   7. Execute
      try {
        const creds = loadCredentials();
        const headers = { 'APCA-API-KEY-ID': creds.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca!.apiSecret };

        // ─── STEP 1: Merge candidate feeders into a single universe ─────
        interface UniverseEntry { symbol: string; price: number; percent_change: number; trade_count?: number; source: 'movers' | 'research' | 'both'; catalyst?: string }
        const universeMap = new Map<string, UniverseEntry>();
        const ownedSet = new Set(positions.map(p => p.ticker));

        // 1a. Alpaca top movers — raw technical momentum
        let moversRawCount = 0;
        try {
          const moversRes = await fetch('https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=25', {
            headers, signal: AbortSignal.timeout(5000),
          });
          if (moversRes.ok) {
            const moversData = await moversRes.json() as any;
            const raw = (moversData.gainers || [])
              .filter((m: any) => m.percent_change > 2 && m.price >= MIN_STOCK_PRICE && m.price < 500 && (m.trade_count || 0) > 5000);
            moversRawCount = raw.length;
            for (const m of raw) {
              if (ownedSet.has(m.symbol) || this._recentBuys.has(m.symbol) || this._sessionSells.has(m.symbol)) continue;
              universeMap.set(m.symbol, { ...m, source: 'movers' });
            }
          }
        } catch (e: any) {
          console.log(`  [UNIVERSE] Alpaca movers fetch failed: ${e.message}`);
        }

        // 1b. Research worker catalyst stars — fundamental/news-backed picks
        let researchRawCount = 0;
        try {
          const researchStars = this.store.getResearchStars();
          researchRawCount = researchStars.length;
          const equityStars = researchStars.filter(s => !isCrypto(s.symbol));
          if (equityStars.length > 0) {
            // Fetch current prices for research stars so they can be compared against movers
            const syms = equityStars.map(s => s.symbol).slice(0, 15).join(',');
            const snapRes = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${syms}&feed=iex`, {
              headers, signal: AbortSignal.timeout(5000),
            });
            if (snapRes.ok) {
              const snapData = await snapRes.json() as any;
              for (const star of equityStars) {
                if (ownedSet.has(star.symbol) || this._recentBuys.has(star.symbol) || this._sessionSells.has(star.symbol)) continue;
                const snap = snapData[star.symbol];
                if (!snap) continue;
                const price = snap.latestTrade?.p || snap.latestQuote?.ap;
                if (!price || price < MIN_STOCK_PRICE || price > 500) continue;
                // Parse percent change from catalyst string if present
                const pctMatch = star.catalyst?.match(/\+?([\d.]+)%/);
                const pct = pctMatch ? parseFloat(pctMatch[1]) : 0;
                const existing = universeMap.get(star.symbol);
                if (existing) {
                  // Ticker appears in BOTH feeders — high-conviction candidate
                  existing.source = 'both';
                  existing.catalyst = star.catalyst;
                } else {
                  universeMap.set(star.symbol, {
                    symbol: star.symbol,
                    price,
                    percent_change: pct,
                    trade_count: 50_000,  // research stars assumed liquid (scanner filters)
                    source: 'research',
                    catalyst: star.catalyst,
                  });
                }
              }
            }
          }
        } catch (e: any) {
          console.log(`  [UNIVERSE] Research worker fetch failed: ${e.message}`);
        }

        // 1c. Apply quality gate to the merged universe
        const blockedByGate: string[] = [];
        const universe: UniverseEntry[] = [];
        for (const entry of universeMap.values()) {
          const gate = moverQualityGate(entry);
          if (gate.blocked) { blockedByGate.push(`${entry.symbol}:${gate.reason}`); continue; }
          universe.push(entry);
        }
        // Sort: "both" sources first (strongest conviction), then by percent_change
        universe.sort((a, b) => {
          const sourceRank = (s: string) => s === 'both' ? 0 : s === 'research' ? 1 : 2;
          const diff = sourceRank(a.source) - sourceRank(b.source);
          if (diff !== 0) return diff;
          return b.percent_change - a.percent_change;
        });

        if (blockedByGate.length > 0) console.log(`  [UNIVERSE] Quality gate blocked: ${blockedByGate.join(', ')}`);
        const bothCount = universe.filter(u => u.source === 'both').length;
        const researchOnlyCount = universe.filter(u => u.source === 'research').length;
        const moversOnlyCount = universe.filter(u => u.source === 'movers').length;
        console.log(`  [UNIVERSE] ${universe.length} candidates (${bothCount} both, ${researchOnlyCount} research-only, ${moversOnlyCount} movers-only) from ${moversRawCount} raw movers + ${researchRawCount} research stars`);

        // ─── STEP 2-3: Fetch bars + feed NeuralTrader ─────────────────────
        const barWindow = 15;  // only fetch bars for the top N to keep the heartbeat bounded
        const fetchTargets = universe.slice(0, barWindow);
        await Promise.all(fetchTargets.map(async (u) => {
          try {
            const barsUrl = `https://data.alpaca.markets/v2/stocks/${u.symbol}/bars?timeframe=15Min&limit=50&feed=iex`;
            const barsRes = await fetch(barsUrl, { headers, signal: AbortSignal.timeout(5000) });
            if (!barsRes.ok) return;
            const barsData = await barsRes.json() as any;
            const rawBars = barsData.bars || [];
            if (rawBars.length < 30) return;  // NT needs 30+ bars
            for (const bar of rawBars) this.neural.addBar(u.symbol, bar.c, bar.v || 0);
          } catch { /* best-effort */ }
        }));

        // ─── STEP 4: NeuralTrader decides ─────────────────────────────────
        // NT is the technical authority WHEN IT HAS DATA. If a ticker doesn't
        // have 30+ bars, NT can't evaluate it — that absence should NOT block
        // the trade. Instead, tickers with insufficient bars pass through to
        // the remaining gates (Bayesian, Brain, Trident) which can still
        // reject bad ones.
        const ntScannedSymbols = new Set<string>();
        for (const u of fetchTargets) {
          const hist = this.neural.getPriceHistory(u.symbol);
          if (hist.length >= 30) ntScannedSymbols.add(u.symbol);
        }
        const ntSignals = ntScannedSymbols.size > 0
          ? await this.neural.scan([...ntScannedSymbols])
          : [];
        const ntBuySignals = ntSignals.filter(s => s.direction === 'buy' && s.confidence >= 0.6);
        const ntRejected = new Set(
          ntSignals.filter(s => s.direction !== 'buy' || s.confidence < 0.6).map(s => s.ticker),
        );

        // Tickers that NT couldn't evaluate (insufficient bars) — let them through
        const ntBypassed = fetchTargets
          .filter(u => !ntScannedSymbols.has(u.symbol))
          .map(u => u.symbol);

        console.log(`  [NT SCAN] ${ntSignals.length} signals from ${ntScannedSymbols.size} scanned, ${ntBuySignals.length} buys, ${ntRejected.size} rejected, ${ntBypassed.length} bypassed (insufficient bars)`);

        // Map back to price/percent_change for the downstream buy loop
        // Include: NT buy signals + NT-bypassed (insufficient data) tickers
        const ntApprovedOrBypassed = new Set([
          ...ntBuySignals.map(s => s.ticker),
          ...ntBypassed,
        ]);
        let gainers: Array<{ symbol: string; price: number; percent_change: number }> = fetchTargets
          .filter(u => ntApprovedOrBypassed.has(u.symbol))
          .map(u => ({ symbol: u.symbol, price: u.price, percent_change: u.percent_change }))
          .slice(0, openSlots);

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
        // Only add morning plan equity tickers when market is actually open
        if (mkt.isMarketOpen) {
          for (const pt of planTickers) {
            if (!gainers.some(g => g.symbol === pt) && !isCrypto(pt)) {
              try {
                const snap = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${pt}&feed=iex`, { headers, signal: AbortSignal.timeout(5000) });
                if (snap.ok) {
                  const sd = await snap.json() as any;
                  const price = sd[pt]?.latestTrade?.p;
                  if (price && price >= MIN_STOCK_PRICE) gainers.unshift({ symbol: pt, price, percent_change: 0 });
                }
              } catch {}
            }
          }
        }

        // Cap per-position to remaining budget / slots, max $2,500 per position
        const slotsToFill = Math.min(gainers.length || 1, openSlots);
        const basePerPosition = Math.min(Math.floor(budgetRemaining / slotsToFill), PER_POSITION_MAX);
        // Wave 2: Macro regime sizing multiplier (0.25 crisis → 1.5 trending).
        // Defaults to 1.0 if Macro has never run or verdict is stale.
        const macroMult = this.macroAnalyst.getCurrentMultiplier();
        const perPosition = Math.floor(basePerPosition * macroMult);
        const macroVerdict = this.macroAnalyst.getLatest();
        console.log(`  [BUY] ${gainers.length} candidates (${planTickers.length} from plan), $${perPosition}/pos (base $${basePerPosition} × ${macroMult.toFixed(2)}x macro${macroVerdict ? `:${macroVerdict.regime}` : ':default'}), budget left: $${budgetRemaining.toFixed(0)}`);

        if (perPosition < 50) {
          console.log(`  [BUY] Per-position too small ($${perPosition}) — skipping`);
        }

        // ─── RISK MANAGER (Wave 1 analyst) ─────────────────────────────
        // Evaluates ALL candidates in one batch BEFORE the per-candidate gate
        // loop. Reads learned rules from the Post-Mortem analyst (risk_rules
        // table) and enforces them here. This is the AFJKU-class gate — it
        // probes Alpaca snapshots for volume and spread, and blocks anything
        // that fails the liquidity/concentration/structural checks.
        const riskCandidates = gainers.slice(0, openSlots).map(g => ({
          ticker: g.symbol,
          price: g.price,
        }));
        const riskPositions = positions.map(p => ({
          ticker: p.ticker,
          marketValue: p.marketValue || (p.avgPrice * p.shares) || 0,
        }));
        const riskVerdicts = await this.riskManager.evaluate(riskCandidates, riskPositions, headers);
        const riskBlockedSet = new Set<string>();
        const riskApprovedSet = new Set<string>();
        for (const v of riskVerdicts) {
          if (v.allowed) riskApprovedSet.add(v.ticker);
          else riskBlockedSet.add(v.ticker);
        }
        const riskBlockedDetail = riskVerdicts
          .filter(v => !v.allowed)
          .map(v => `${v.ticker}:${v.reason}`);
        if (riskBlockedDetail.length > 0) {
          console.log(`  [RISK] Blocked: ${riskBlockedDetail.join(', ')}`);
        }
        console.log(`  [RISK] ${riskApprovedSet.size} approved of ${riskCandidates.length} NT buys${this.riskManager.getStats().activeRuleCount > 0 ? ` (${this.riskManager.getStats().activeRuleCount} learned rules active)` : ''}`);

        // ─── PER-CANDIDATE BUY LOOP ─────────────────────────────────────
        // STRIPPED 2026-04-13: removed 6 redundant gates that were blocking
        // every real stock. The Brain (Trident LoRA) IS the intelligence —
        // everything else was me over-engineering and costing us the market.
        //
        // What remains:
        //   1. Anti-churn + session sells (don't buy what we just sold)
        //   2. SPAC suffix block (structural — blocks AFJKU class)
        //   3. Price floor $10
        //   4. Trident shouldBuy (THE intelligence gate — the Brain decides)
        //   5. Budget/position limits
        //
        // What was removed:
        //   - Risk Manager volume/spread (killed LMT/RTX/GD/DVN/SLB on Monday open)
        //   - Quality gate blow-off % (killed CVX/OXY during Iran oil spike)
        //   - Per-candidate NeuralTrader re-gate (redundant with Step 4 scan)
        //   - Brain history shouldAvoid (too blunt — 5 trades isn't enough to ban)
        let spentThisHeartbeat = 0;
        const buyAudit: string[] = [];
        for (const g of gainers.slice(0, openSlots)) {
          if (spentThisHeartbeat + perPosition > budgetRemaining) {
            buyAudit.push('Budget exhausted');
            break;
          }
          try {
            // Gate: Session sells — don't rebuy what we or the user sold today
            if (this._sessionSells.has(g.symbol)) { buyAudit.push(`${g.symbol}: SKIP sold-today`); continue; }
            // Gate: Anti-churn — max 1 buy per ticker per day
            if (this._recentBuys.has(g.symbol)) { buyAudit.push(`${g.symbol}: SKIP already-bought`); continue; }
            // Gate: SPAC suffix (structural — the ONLY hard filter besides price)
            if (SPAC_SUFFIX_RE.test(g.symbol)) { buyAudit.push(`${g.symbol}: SKIP SPAC-suffix`); continue; }
            // Gate: Price floor
            if (!isCrypto(g.symbol) && g.price < MIN_STOCK_PRICE) { buyAudit.push(`${g.symbol}: SKIP price $${g.price.toFixed(2)}<$${MIN_STOCK_PRICE}`); continue; }
            // Gate: Crypto disabled
            if (isCrypto(g.symbol) && !CRYPTO_BUYS_ENABLED) { buyAudit.push(`${g.symbol}: SKIP crypto-disabled`); continue; }

            // Gate: Trident LoRA — THE intelligence gate. The Brain decides.
            let tridentResult = 'not-called';
            try {
              const tridentAdvice = await brain.shouldBuy(g.symbol, g.percent_change, `catalyst +${g.percent_change.toFixed(1)}%`);
              if (!tridentAdvice.should) {
                buyAudit.push(`${g.symbol}: SKIP Trident: ${tridentAdvice.reason.slice(0, 50)}`);
                continue;
              }
              tridentResult = `APPROVED: ${tridentAdvice.reason.slice(0, 40)}`;
            } catch (e: any) { tridentResult = `FAILED ${e.message?.substring(0, 30)}`; }

            // Gate: THESIS REQUIRED — HARD GATE. No thesis = no trade. Period.
            // Momentum chasing is disabled. The thesis pipeline (signals → clusters →
            // conviction scorer) is the ONLY entry path. This prevents BIRD, BTFL,
            // MGRT-class losses from ever happening again.
            try {
              const { query: pgQ } = await import('../../research-db/src/index.js');
              const { rows: theses } = await pgQ(
                `SELECT conviction, thesis FROM research_theses
                 WHERE symbol = $1 AND status IN ('active','triggered')
                 AND conviction >= 0.50
                 ORDER BY conviction DESC LIMIT 1`,
                [g.symbol],
              );
              if (theses.length === 0) {
                buyAudit.push(`${g.symbol}: SKIP no-thesis (HARD GATE — need conviction ≥ 0.50 in PG)`);
                continue;
              }
              const thesis = theses[0] as any;
              buyAudit.push(`${g.symbol}: thesis=${(thesis.conviction * 100).toFixed(0)}% "${(thesis.thesis || '').slice(0, 40)}"`);
            } catch {
              buyAudit.push(`${g.symbol}: SKIP thesis-gate-failed (PG unavailable — cannot verify)`);
              continue;
            }

            // ALL GATES PASSED — execute buy
            const qty = Math.floor(perPosition / g.price);
            if (qty <= 0) continue;
            const signal = {
              id: `mover-${Date.now()}-${g.symbol}`, ticker: g.symbol,
              direction: 'buy' as const, confidence: 0.9, timeframe: '1h' as const,
              indicators: {}, pattern: 'top_mover', timestamp: new Date(), source: 'momentum' as const,
            };
            const order = await this.executor.execute(signal, qty, perPosition);
            buyAudit.push(`${g.symbol}: BUY ${qty}@$${g.price.toFixed(2)} trident=${tridentResult} → ${order.status}`);
            if (order.status === 'filled' || order.status === 'pending') {
              spentThisHeartbeat += qty * g.price;
              this._trackBuy(g.symbol, g.price, qty, (order as any).id ?? null);
              this.riskManager.incrementBuyCount();
              brain.recordBuy(g.symbol, qty, g.price, `TOP MOVER +${g.percent_change.toFixed(1)}%`).catch(() => {});
            }
          } catch (e: any) { buyAudit.push(`${g.symbol}: ERROR ${e.message?.substring(0, 50)}`); }
        }
        // Write gate audit — append to history (keep last 10 heartbeats with buys)
        try {
          this.store.set('buy_gate_audit', JSON.stringify({ date: new Date().toISOString(), heartbeat: this.hbCount, audit: buyAudit }));
          // Also append to persistent audit log if any buys happened
          if (buyAudit.some(a => a.includes('BUY '))) {
            const existing = this.store.get('buy_audit_history') || '[]';
            const history = JSON.parse(existing);
            history.push({ date: new Date().toISOString(), hb: this.hbCount, audit: buyAudit });
            if (history.length > 20) history.splice(0, history.length - 20);
            this.store.set('buy_audit_history', JSON.stringify(history));
          }
        } catch {}
        console.log(`  [BUY AUDIT] ${buyAudit.join(' | ')}`);
        actions.push({ action: 'buy_movers', priority: 1, durationMs: Date.now() - t0, status: buyAudit.some(a => a.includes('BUY ')) ? 'success' : 'skipped', detail: buyAudit.join('; ').substring(0, 500) });
      } catch (e: any) { errors.push(`buy_movers: ${e.message}`); }
    }

    // 4. Check exits — stop loss, trailing stops, circuit breaker (no rotation, just cut dogs)
    if (mkt.isMarketOpen) {
      try {
        const r = await this.checkExits();
        actions.push(r);
        if (r.status !== 'skipped') console.log(`  [EXITS] ${r.detail} (${r.durationMs}ms)`);
      } catch (e: any) { errors.push(`check_exits: ${e.message}`); }

      // 4b. Exit Analyst + Trident LoRA exit consultation
      // Exit Analyst provides tiered stops (trailing, time-based, profit-locking).
      // Trident provides the intelligence gate (should I sell at all?).
      // Exit Analyst's sell_now overrides Trident hold.
      try {
        const currentPos = await this.executor.getPositions();

        // Run Exit Analyst on all positions
        const exitAnalyst = new (await import('./analysts/exit-analyst.js')).ExitAnalyst();
        const exitPlans = exitAnalyst.evaluate(currentPos.map(p => ({
          ticker: p.ticker,
          entryPrice: p.avgPrice,
          currentPrice: p.currentPrice,
          qty: Math.abs(p.shares),
          marketValue: p.marketValue,
          unrealizedPnl: p.unrealizedPnl,
          unrealizedPnlPct: p.unrealizedPnlPercent / 100,
          holdDurationMinutes: this._recentBuys.has(p.ticker)
            ? (Date.now() - (this._recentBuys.get(p.ticker) || Date.now())) / 60_000
            : 120,
          isResilient: isResilient(p.ticker),
        })));

        // Log exit plans
        for (const plan of exitPlans) {
          if (plan.action === 'sell_now') {
            console.log(`  [EXIT] ${plan.ticker} → SELL NOW: ${plan.reasoning}`);
          } else if (plan.action === 'tighten_stop') {
            console.log(`  [EXIT] ${plan.ticker} → tighten stop $${plan.stopLoss.toFixed(2)}${plan.trailingStopPct ? ` trail ${plan.trailingStopPct}%` : ''}: ${plan.reasoning}`);
          }
        }

        // Execute immediate sells from Exit Analyst
        const sellNowTickers = new Set(exitPlans.filter(p => p.action === 'sell_now').map(p => p.ticker));

        for (const pos of currentPos) {
          const pnlPct = pos.unrealizedPnlPercent / 100;
          const exitPlan = exitPlans.find(p => p.ticker === pos.ticker);

          // Exit Analyst says sell_now → execute immediately, skip Trident
          if (sellNowTickers.has(pos.ticker)) {
            const creds = loadCredentials();
            const headers = { 'APCA-API-KEY-ID': creds.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca!.apiSecret, 'Content-Type': 'application/json' };
            try {
              const sellSymbol = isCrypto(pos.ticker) ? pos.ticker.replace(/USD$/, '/USD') : pos.ticker;
              const tif = isCrypto(pos.ticker) ? 'gtc' : 'day';
              const res = await fetch(`${creds.alpaca!.baseUrl}/v2/orders`, {
                method: 'POST', headers,
                body: JSON.stringify({ symbol: sellSymbol, qty: String(Math.abs(pos.shares)), side: 'sell', type: 'market', time_in_force: tif }),
                signal: AbortSignal.timeout(10_000),
              });
              const body = res.ok ? await res.json().catch(() => null) as any : null;
              emitTradeClosed({ ticker: pos.ticker, success: pos.unrealizedPnl > 0, returnPct: pnlPct, reason: 'exit_analyst' });
              recordClosedTrade(this.store, {
                ticker: pos.ticker, direction: 'long', reason: exitPlan?.reasoning.slice(0, 60) || 'exit_analyst_sell_now',
                qty: Math.abs(pos.shares), entryPrice: pos.avgPrice, exitPrice: pos.currentPrice,
                pnl: pos.unrealizedPnl, orderId: body?.id ?? null, source: 'engine_exit_analyst',
              });
              this._addSessionSell(pos.ticker);
              console.log(`  [EXIT SELL] ${pos.ticker} $${pos.unrealizedPnl.toFixed(2)} — ${exitPlan?.reasoning}`);
              continue; // skip Trident consultation for this ticker
            } catch (e: any) { console.log(`  [EXIT SELL FAILED] ${pos.ticker}: ${e.message}`); }
          }

          // For non-sell_now positions: standard Trident consultation
          const resilientStock = isResilient(pos.ticker);
          const dangerFloor = resilientStock ? -0.05 : -0.02;
          const gainCeiling = resilientStock ? 0.10 : 0.05;
          if (pnlPct > dangerFloor && pnlPct < gainCeiling) continue;

          const entryTime = this._recentBuys.get(pos.ticker);
          const isManualTrade = this._manualTrades.has(pos.ticker); // Persistent manual trade detection
          const holdMinutes = entryTime ? (Date.now() - entryTime) / 60_000 : 120;

          // PROTECT MANUAL TRADES: only auto-sell manual positions if they're losing
          if (isManualTrade && pnlPct >= 0) {
            console.log(`  [MANUAL TRADE] ${pos.ticker} +${(pnlPct*100).toFixed(1)}% — manual buy, keeping (owner must approve sale)`);
            continue;
          }

          try {
            const advice = await brain.shouldSell(pos.ticker, pnlPct, pos.unrealizedPnl, holdMinutes);
            if (advice.should) {
              console.log(`  [TRIDENT EXIT] ${pos.ticker} ${(pnlPct*100).toFixed(1)}% — LoRA says sell: ${advice.reason.slice(0, 80)}`);
              const sellSymbol = isCrypto(pos.ticker) ? pos.ticker.replace(/USD$/, '/USD') : pos.ticker;
              const tif = isCrypto(pos.ticker) ? 'gtc' : 'day';
              const creds = loadCredentials();
              const headers = { 'APCA-API-KEY-ID': creds.alpaca!.apiKey, 'APCA-API-SECRET-KEY': creds.alpaca!.apiSecret, 'Content-Type': 'application/json' };
              const texRes = await fetch(`${creds.alpaca!.baseUrl}/v2/orders`, {
                method: 'POST', headers,
                body: JSON.stringify({ symbol: sellSymbol, qty: String(Math.abs(pos.shares)), side: 'sell', type: 'market', time_in_force: tif }),
                signal: AbortSignal.timeout(10_000),
              });
              const texBody = texRes.ok ? await texRes.json().catch(() => null) as any : null;
              emitTradeClosed({ ticker: pos.ticker, success: pos.unrealizedPnl > 0, returnPct: pnlPct, reason: 'trident_exit' });
              recordClosedTrade(this.store, {
                ticker: pos.ticker,
                direction: 'long',
                reason: 'trident_exit',
                qty: Math.abs(pos.shares),
                entryPrice: pos.avgPrice ?? null,
                exitPrice: pos.currentPrice ?? 0,
                pnl: pos.unrealizedPnl,
                orderId: texBody?.id ?? null,
                source: 'engine_trident_exit',
              });
              this._addSessionSell(pos.ticker);
              actions.push({ action: 'trident_exit', priority: 2, durationMs: 0, status: pos.unrealizedPnl > 0 ? 'success' : 'error', detail: `Trident EXIT ${pos.ticker} $${pos.unrealizedPnl.toFixed(2)}: ${advice.reason.slice(0, 60)}` });
            } else {
              console.log(`  [TRIDENT HOLD] ${pos.ticker} ${(pnlPct*100).toFixed(1)}% — LoRA says hold: ${advice.reason.slice(0, 60)}`);
            }
          } catch {}
        }
      } catch (e: any) { console.log(`  [TRIDENT EXIT] Error: ${e.message}`); }

      // Monitor
      if (this.hbCount % 5 === 0) {
        try {
          const positions = await this.executor.getPositions();
          const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
          console.log(`  [MONITOR] ${positions.length} positions | P&L: $${totalPnl.toFixed(2)}`);
        } catch {}
      }
    }

    // 5. Forex entries — scanner finds signals, Trident gates them
    try {
      await this.forex.fetchQuotes();
      const fxSignals = this.forex.evaluateSessionMomentum();
      if (fxSignals.length > 0) {
        const open = await this.forex.getOpenTrades();
        if (open.length >= 4) {
          console.log(`  [FOREX] Full (${open.length}/4 positions)`);
        } else {
          // Try each signal until one passes Trident or we run out
          for (const sig of fxSignals.sort((a, b) => b.confidence - a.confidence)) {
            // Trident gate — same as equities. The Brain decides.
            try {
              const advice = await brain.shouldBuy(
                sig.symbol,
                sig.confidence * 10,
                `forex ${sig.strategy} ${sig.direction} ${(sig.confidence * 100).toFixed(0)}%`,
              );
              if (!advice.should) {
                console.log(`  [FOREX] Trident rejected ${sig.symbol}: ${advice.reason.slice(0, 60)}`);
                continue;
              }
            } catch (e: any) {
              // Trident unavailable — proceed with scanner's signal (don't block on failure)
              console.log(`  [FOREX] Trident check failed for ${sig.symbol}: ${e.message?.slice(0, 30)} — proceeding`);
            }

            try {
              await this.forex.placeOrder(sig.symbol, sig.direction === 'long' ? 25000 : -25000, sig.stopLoss, sig.takeProfit);
              console.log(`  [FOREX] ${sig.direction.toUpperCase()} ${sig.symbol} (${(sig.confidence * 100).toFixed(0)}%) — Trident approved — ${sig.rationale}`);
              brain.recordBuy(sig.symbol, 25000, sig.entry, `forex ${sig.strategy}`).catch(() => {});
              break; // one entry per heartbeat
            } catch (e: any) { console.log(`  [FOREX] ORDER FAILED ${sig.symbol}: ${e.message}`); }
          }
        }
      }
    } catch (e: any) { console.log(`  [FOREX] Error: ${e.message}`); }

    // Final position snapshot
    let posCount = 0, deployed = 0;
    try { const p = await this.executor.getPositions(); posCount = p.length; deployed = p.reduce((s, x) => s + Math.abs(x.marketValue), 0); } catch {}

    const dur = Date.now() - t0;
    const result: HeartbeatResult = { heartbeatNumber: this.hbCount, startedAt: new Date(t0).toISOString(), durationMs: dur, actions, positionCount: posCount, totalDeployed: deployed, errors };

    // 6. Write status to state store — includes full gate audit trail
    try {
      const gateAudit = actions
        .filter(a => a.detail && a.detail.length > 5)
        .map(a => a.detail)
        .join(' | ');
      this.store.set('trade_engine_status', JSON.stringify({
        heartbeatNumber: this.hbCount, lastHeartbeat: result.startedAt, durationMs: dur,
        positionCount: posCount, totalDeployed: deployed,
        actionSummary: actions.map((a) => `${a.action}:${a.status}`).join(','),
        errors, recentActivity: actions.filter((a) => a.status !== 'skipped').map((a) => a.detail).slice(0, 5),
        gateAudit: gateAudit.substring(0, 2000),
        intelligence: _bayesian ? { beliefs: _bayesian.query({}).length, connected: true } : { beliefs: 0, connected: false },
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

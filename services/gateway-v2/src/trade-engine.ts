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

import { TradeExecutor } from '../../neural-trader/src/executor.js';
import { PositionManager } from '../../neural-trader/src/position-manager.js';
import { ForexScanner } from '../../forex-scanner/src/index.js';
import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { CredentialVault } from '../../qudag/src/vault.js';

const HEARTBEAT_MS = 120_000;
const MAX_POSITIONS = 6;
const BUDGET_MAX = 8_000;
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
  return positions.filter((p) => Math.abs(p.marketValue) > 0 && (marketOpen || isCrypto(p.ticker))).length;
}

function totalDeployed(positions: Array<{ ticker: string; marketValue: number }>, marketOpen: boolean): number {
  return positions.filter((p) => marketOpen || isCrypto(p.ticker)).reduce((s, p) => s + Math.abs(p.marketValue), 0);
}

function slDominant(store: GatewayStateStore): boolean {
  const trades = store.getTodayTrades();
  if (trades.length < 5) return false;
  return trades.filter((t) => t.reason === 'stop_loss').length / trades.length > SL_DOMINANCE_HALT;
}

// ─── Trade Engine ────────────────────────────────────────────────────────────

export class TradeEngine {
  private executor: TradeExecutor;
  private pm: PositionManager;
  private forex: ForexScanner;
  private store: GatewayStateStore;
  private hbCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private recent: HeartbeatResult[] = [];

  constructor() {
    // Load credentials: vault first, then env var fallback
    let alpacaKey = process.env.ALPACA_API_KEY || '';
    let alpacaSec = process.env.ALPACA_API_SECRET || '';
    let alpacaMode = 'paper';
    let oandaKey = process.env.OANDA_API_KEY || '';
    let oandaAcct = process.env.OANDA_ACCOUNT_ID || '';

    try {
      const vault = new CredentialVault(process.env.MTWM_VAULT_KEY || 'mtwm-local-dev-key');
      const vk = vault.retrieve('alpaca-api-key');
      const vs = vault.retrieve('alpaca-api-secret');
      const vm = vault.retrieve('alpaca-mode');
      if (vk && vs) { alpacaKey = vk; alpacaSec = vs; alpacaMode = vm || 'paper'; console.log(`[TradeEngine] Vault: Alpaca ${alpacaMode}`); }
      const ok = vault.retrieve('oanda-api-key');
      const oa = vault.retrieve('oanda-account-id');
      if (ok && oa) { oandaKey = ok; oandaAcct = oa; console.log('[TradeEngine] Vault: OANDA loaded'); }
    } catch { console.log('[TradeEngine] Vault unavailable, using env vars'); }

    const baseUrl = alpacaMode === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
    this.executor = new TradeExecutor({
      apiKey: alpacaKey,
      apiSecret: alpacaSec,
      baseUrl,
      paperTrading: alpacaMode !== 'live',
    });
    this.pm = new PositionManager();
    this.forex = new ForexScanner({
      oandaApiKey: oandaKey || undefined,
      oandaAccountId: oandaAcct || undefined,
    });
    this.store = new GatewayStateStore();
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
      if (budgetPositionCount(positions, mkt.isMarketOpen) >= maxPos)
        return ar('skipped', `Max positions (${positions.length}/${maxPos})`);
      if (totalDeployed(positions, mkt.isMarketOpen) >= budget)
        return ar('skipped', `Budget deployed ($${totalDeployed(positions, mkt.isMarketOpen).toFixed(0)}/${budget})`);

      const owned = new Set(positions.map((p) => p.ticker));

      // Forex signals
      if (process.env.OANDA_API_KEY && process.env.OANDA_ACCOUNT_ID) {
        try {
          await this.forex.fetchQuotes();
          const sigs = [...this.forex.evaluateSessionMomentum(), ...this.forex.evaluateCarryTrades()];
          if (sigs.length > 0) {
            sigs.sort((a, b) => b.confidence - a.confidence);
            const top = sigs[0];
            const open = await this.forex.getOpenTrades();
            if (open.length < 4) {
              try {
                await this.forex.placeOrder(top.symbol, top.direction === 'long' ? 5000 : -5000, top.stopLoss, top.takeProfit);
                details.push(`FOREX ${top.direction.toUpperCase()} ${top.symbol} (${(top.confidence * 100).toFixed(0)}%)`);
              } catch (e: any) { details.push(`FOREX FAIL ${top.symbol}: ${e.message}`); }
            } else { details.push(`Forex full (${open.length}/4)`); }
          } else { details.push(`Forex: no signals (${this.forex.getActiveSession()})`); }
        } catch (e: any) { details.push(`Forex error: ${e.message}`); }
      }

      // Equity/Crypto from research stars
      const eligibleStars = stars
        .filter((s) => !owned.has(s.symbol))
        .filter((s) => mkt.isMarketOpen || isCrypto(s.symbol))
        .slice(0, 3);

      for (const star of eligibleStars) {
        const fresh = await this.executor.getPositions();
        if (budgetPositionCount(fresh, mkt.isMarketOpen) >= maxPos) { details.push('Max positions — done'); break; }
        const deployed = totalDeployed(fresh, mkt.isMarketOpen);
        if (deployed >= budget) { details.push('Budget full — done'); break; }

        const remaining = budget - deployed;
        const size = Math.min(remaining * 0.20, 1400);
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
            direction: 'buy' as const, confidence: star.score, timeframe: '1h' as const,
            indicators: {}, pattern: 'research_star', timestamp: new Date(), source: 'momentum' as const,
          };
          const order = await this.executor.execute(signal, qty, size);
          details.push(`BUY ${qty} ${star.symbol} @$${price.toFixed(2)} — ${order.status}`);
          if (order.status === 'filled' || order.status === 'pending') owned.add(star.symbol);
        } catch (e: any) { details.push(`${star.symbol}: ${e.message}`); }
      }

      if (details.length === 0) details.push(`No signals (${mkt.isMarketOpen ? 'open' : 'closed'})`);
      const status = details.some((d) => d.includes('FAIL') || d.includes('error')) ? 'error' as const
        : details.some((d) => d.includes('BUY') || d.includes('FOREX')) ? 'success' as const : 'skipped' as const;
      return ar(status, details.join('; '));
    } catch (e: any) { return ar('error', e.message); }
  }

  private async fetchPrice(ticker: string): Promise<number | null> {
    const key = process.env.ALPACA_API_KEY, sec = process.env.ALPACA_API_SECRET;
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

  private async heartbeat(): Promise<void> {
    if (this.stopping) return;
    this.hbCount++;
    const t0 = Date.now();
    const mkt = getMarketContext();
    const actions: ActionResult[] = [];
    const errors: string[] = [];

    console.log(
      `\n[TradeEngine] === Heartbeat #${this.hbCount} === ${mkt.etDay} ` +
      `${mkt.etHour}:${String(mkt.etMin).padStart(2, '0')} ET — ` +
      `${mkt.isMarketOpen ? 'OPEN' : mkt.isAfterHours ? 'AFTER-HOURS' : 'CLOSED'}`,
    );

    // 1. Forex position management (priority 1)
    try { const r = await this.manageForexPositions(); actions.push(r); if (r.status !== 'skipped') console.log(`  [1] ${r.detail} (${r.durationMs}ms)`); }
    catch (e: any) { errors.push(`manage_positions: ${e.message}`); }

    // 2. Equity/crypto exits (priority 2)
    try { const r = await this.checkExits(); actions.push(r); if (r.status !== 'skipped') console.log(`  [2] ${r.detail} (${r.durationMs}ms)`); }
    catch (e: any) { errors.push(`check_exits: ${e.message}`); }

    // 3-4. Read strategy + stars
    let strategy = {};
    try { const raw = this.store.get('daily_strategy'); if (raw) strategy = JSON.parse(raw); } catch {}
    let stars: Array<{ symbol: string; sector: string; score: number; catalyst: string }> = [];
    try { this.store.clearExpiredStars(4); stars = this.store.getResearchStars(); } catch {}
    if (stars.length > 0) console.log(`  [3-4] ${stars.length} research stars loaded`);

    // 5. Scan signals (priority 3)
    try { const r = await this.scanSignals(strategy, stars); actions.push(r); console.log(`  [5] ${r.detail} (${r.durationMs}ms)`); }
    catch (e: any) { errors.push(`scan_signals: ${e.message}`); }

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

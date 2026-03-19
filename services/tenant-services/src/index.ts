/**
 * TenantServiceManager -- per-tenant service scoping for multi-tenant operation.
 *
 * Bridge layer between the single-tenant gateway and multi-tenant SaaS.
 * Each tenant gets isolated instances of TradeExecutor, PositionManager,
 * BayesianIntelligence, adaptive state, and (optionally) ForexScanner,
 * all configured with their own broker credentials and trading rules.
 *
 * Shared resources (news-desk, research stars, market quotes, neural model)
 * are passed in via SharedContext at heartbeat time.
 */

import { TradeExecutor } from '../../neural-trader/src/executor.js';
import type { BrokerConfig } from '../../neural-trader/src/executor.js';
import { PositionManager } from '../../neural-trader/src/position-manager.js';
import type { PositionRules, DailyGoalConfig } from '../../neural-trader/src/position-manager.js';
import { BayesianIntelligence } from '../../shared/intelligence/bayesian-intelligence.js';
import { ForexScanner } from '../../forex-scanner/src/index.js';
import type { TenantDB, DecryptedCredentials } from '../../tenant-db/src/index.js';
import type { TenantConfigRow } from '../../tenant-db/src/schema.js';

// ── Interfaces ────────────────────────────────────────────────────────

export interface AdaptiveState {
  // US Equities
  momentumStarThreshold: number;
  minPrice: number;
  maxPriceForMomentum: number;
  avoidTickers: Set<string>;
  preferTickers: Set<string>;
  stopLossDominance: number;

  // Forex
  forexThreshold: number;
  forexAvoidPairs: Set<string>;
  forexPreferPairs: Set<string>;
  forexMaxPositions: number;
  forexBudget: number;
  forexMaxUnitsPerTrade: number;
  forexKnownTradeIds: Set<string>;

  // Global
  lastAdaptation: string;
}

export interface TenantConfig {
  tenantId: string;
  simulatedCapital: number;
  maxPositions: number;
  cryptoPct: number;
  equityPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  dailyGoal: number;
  autonomyLevel: number;
  heartbeatMs: number;
}

export interface TenantServices {
  executor: TradeExecutor;
  positionManager: PositionManager;
  bayesianIntel: BayesianIntelligence;
  adaptiveState: AdaptiveState;
  forexScanner?: ForexScanner;
  config: TenantConfig;
}

export interface SharedContext {
  researchStars: Map<string, any>;
  newsFindings: string[];
  marketQuotes: Map<string, { price: number; change: number }>;
  neuralTrader: any; // shared neural model
}

export interface HeartbeatResult {
  tenantId: string;
  timestamp: string;
  exitActions: string[];
  positionActions: string[];
  signalActions: string[];
  errors: string[];
  skipped: boolean;
  skipReason?: string;
}

// ── Default adaptive state ────────────────────────────────────────────

function createDefaultAdaptiveState(): AdaptiveState {
  return {
    momentumStarThreshold: 0.55,
    minPrice: 5.0,
    maxPriceForMomentum: 500,
    avoidTickers: new Set(),
    preferTickers: new Set(),
    stopLossDominance: 0,

    forexThreshold: 0.55,
    forexAvoidPairs: new Set(),
    forexPreferPairs: new Set(),
    forexMaxPositions: 2,
    forexBudget: 1000,
    forexMaxUnitsPerTrade: 25000,
    forexKnownTradeIds: new Set(),

    lastAdaptation: '',
  };
}

// ── Default tenant config ─────────────────────────────────────────────

function createDefaultConfig(tenantId: string): TenantConfig {
  return {
    tenantId,
    simulatedCapital: 5000,
    maxPositions: 5,
    cryptoPct: 0.3,
    equityPct: 0.7,
    stopLossPct: 0.03,
    takeProfitPct: 0.08,
    dailyGoal: 500,
    autonomyLevel: 3,
    heartbeatMs: 30000,
  };
}

// ── Config row to TenantConfig mapper ─────────────────────────────────

function configRowToTenantConfig(tenantId: string, row: TenantConfigRow): TenantConfig {
  return {
    tenantId,
    simulatedCapital: row.simulated_capital,
    maxPositions: row.max_positions,
    cryptoPct: row.crypto_pct,
    equityPct: row.equity_pct,
    stopLossPct: row.stop_loss_pct,
    takeProfitPct: row.take_profit_pct,
    dailyGoal: row.daily_goal,
    autonomyLevel: row.autonomy_level,
    heartbeatMs: row.heartbeat_ms,
  };
}

// ── TenantServiceManager ──────────────────────────────────────────────

export class TenantServiceManager {
  private tenants: Map<string, TenantServices> = new Map();

  /**
   * Returns the service bundle for a tenant.
   * If no services exist yet, creates them with default configuration.
   * For full initialization from the database, call initFromDB instead.
   */
  getServices(tenantId: string): TenantServices {
    const existing = this.tenants.get(tenantId);
    if (existing) return existing;

    // Create with defaults -- no broker keys, so executor will reject trades
    // until initFromDB is called with real credentials.
    const config = createDefaultConfig(tenantId);
    const services = this.createServiceBundle(config);
    this.tenants.set(tenantId, services);
    return services;
  }

  /**
   * Initialize tenant services from the database.
   * Loads credentials, config, and Bayesian beliefs, then creates
   * executor and scanner instances with the tenant's own broker keys.
   */
  async initFromDB(tenantId: string, db: TenantDB): Promise<TenantServices> {
    // If already loaded, tear down first to pick up any credential changes
    if (this.tenants.has(tenantId)) {
      this.destroyServices(tenantId);
    }

    // Load config
    const configRow = db.getTenantConfig(tenantId);
    const config = configRow
      ? configRowToTenantConfig(tenantId, configRow)
      : createDefaultConfig(tenantId);

    // Load Alpaca credentials
    const alpacaCreds = db.getTenantCredentials(tenantId, 'alpaca');

    // Load OANDA credentials (optional)
    const oandaCreds = db.getTenantCredentials(tenantId, 'oanda');

    // Build the service bundle
    const services = this.createServiceBundle(config, alpacaCreds, oandaCreds);

    // Hydrate Bayesian beliefs from DB
    const beliefs = db.getBeliefs(tenantId);
    for (const belief of beliefs) {
      const tags = typeof belief.tags === 'string' ? JSON.parse(belief.tags) : belief.tags;
      services.bayesianIntel.recordOutcome(belief.belief_id, {
        domain: belief.domain,
        subject: belief.subject,
        tags: tags || [],
        contributors: [],
      }, belief.alpha > belief.beta, belief.avg_return);
    }

    this.tenants.set(tenantId, services);
    console.log(
      `[TenantServices] Initialized tenant=${tenantId} ` +
      `alpaca=${alpacaCreds ? 'yes' : 'no'} ` +
      `oanda=${oandaCreds ? 'yes' : 'no'} ` +
      `maxPos=${config.maxPositions} capital=$${config.simulatedCapital}`,
    );

    return services;
  }

  /**
   * Tear down services for a tenant (disconnect, free memory).
   */
  destroyServices(tenantId: string): void {
    const services = this.tenants.get(tenantId);
    if (!services) return;

    // ForexScanner extends EventEmitter -- remove all listeners
    if (services.forexScanner) {
      services.forexScanner.removeAllListeners();
    }

    this.tenants.delete(tenantId);
    console.log(`[TenantServices] Destroyed services for tenant=${tenantId}`);
  }

  /**
   * Number of tenants with active service instances.
   */
  getActiveServiceCount(): number {
    return this.tenants.size;
  }

  /**
   * List all loaded tenant IDs.
   */
  getLoadedTenants(): string[] {
    return Array.from(this.tenants.keys());
  }

  /**
   * Check whether a specific tenant's services are loaded.
   */
  isLoaded(tenantId: string): boolean {
    return this.tenants.has(tenantId);
  }

  // ── Heartbeat ─────────────────────────────────────────────────────

  /**
   * Run per-tenant heartbeat actions using shared context from the
   * single gateway loop.
   *
   * Actions:
   *   1. check_exits   -- position manager stop-loss/take-profit/trailing
   *   2. manage_positions -- forex star concentration (if forex enabled)
   *   3. scan_signals  -- evaluate shared signals against tenant config
   *
   * Respects tenant autonomy level, max positions, and budget.
   */
  async runTenantHeartbeat(
    tenantId: string,
    sharedContext: SharedContext,
  ): Promise<HeartbeatResult> {
    const result: HeartbeatResult = {
      tenantId,
      timestamp: new Date().toISOString(),
      exitActions: [],
      positionActions: [],
      signalActions: [],
      errors: [],
      skipped: false,
    };

    const services = this.tenants.get(tenantId);
    if (!services) {
      result.skipped = true;
      result.skipReason = 'tenant services not loaded';
      return result;
    }

    const { executor, positionManager, bayesianIntel, adaptiveState, forexScanner, config } = services;

    // ── 1. Check exits (always runs -- protect capital first) ──────
    try {
      const starActions = await positionManager.starConcentration(executor);
      const exitActions = await positionManager.checkPositions(executor);
      result.exitActions = [...starActions, ...exitActions];
    } catch (err: any) {
      result.errors.push(`check_exits error: ${err.message}`);
    }

    // ── 2. Manage forex positions (if scanner configured) ──────────
    if (forexScanner) {
      try {
        const openTrades = await forexScanner.getOpenTrades();
        if (openTrades.length >= 2) {
          // Classify positions and cut losers when a star exists
          const positions = openTrades.map((t: any) => ({
            id: t.id,
            instrument: t.instrument,
            units: parseFloat(t.currentUnits || t.initialUnits),
            unrealizedPL: parseFloat(t.unrealizedPL || '0'),
            price: parseFloat(t.price || '0'),
          }));

          const star = positions.reduce((best: any, p: any) =>
            p.unrealizedPL > best.unrealizedPL ? p : best, positions[0]);

          const dogs = positions.filter((p: any) =>
            p.unrealizedPL < -5 && p.id !== star.id);

          for (const dog of dogs) {
            if (star.unrealizedPL > 10) {
              try {
                const symbol = dog.instrument.replace('_', '/');
                await forexScanner.closePosition(symbol);
                result.positionActions.push(
                  `CUT DOG: ${symbol} PL=$${dog.unrealizedPL.toFixed(2)} ` +
                  `-- star ${star.instrument.replace('_', '/')} PL=$${star.unrealizedPL.toFixed(2)}`,
                );
              } catch (closeErr: any) {
                result.errors.push(`forex close error (${dog.instrument}): ${closeErr.message}`);
              }
            }
          }
        }

        if (result.positionActions.length === 0 && openTrades.length > 0) {
          result.positionActions.push(
            `Forex: ${openTrades.length} position(s) -- no management action needed`,
          );
        }
      } catch (err: any) {
        result.errors.push(`manage_positions error: ${err.message}`);
      }
    }

    // ── 3. Scan signals from shared context ────────────────────────
    if (config.autonomyLevel < 2) {
      result.signalActions.push('autonomy level too low for auto-trade');
    } else {
      try {
        const currentPositions = await executor.getPositions();
        const ownedTickers = new Set(currentPositions.map(p => p.ticker));

        // Check position limit
        if (currentPositions.length >= config.maxPositions) {
          result.signalActions.push(
            `At max positions (${currentPositions.length}/${config.maxPositions}) -- skipping signal scan`,
          );
        } else if (positionManager.isCircuitBreakerTripped()) {
          result.signalActions.push('Circuit breaker active -- no new entries');
        } else {
          // Evaluate research stars from shared context against tenant's adaptive state
          for (const [symbol, starData] of sharedContext.researchStars) {
            if (ownedTickers.has(symbol)) continue;
            if (adaptiveState.avoidTickers.has(symbol)) continue;

            const quote = sharedContext.marketQuotes.get(symbol);
            if (!quote) continue;
            if (quote.price < adaptiveState.minPrice) continue;
            if (quote.price > adaptiveState.maxPriceForMomentum) continue;

            // Check score against tenant's threshold
            const score = starData.score ?? 0;
            if (score < adaptiveState.momentumStarThreshold) continue;

            // Calculate position size from tenant's budget
            const positionBudget = config.simulatedCapital / config.maxPositions;
            const quantity = Math.floor(positionBudget / quote.price);
            if (quantity < 1) continue;

            // At autonomy >= 3, auto-execute; otherwise just log the signal
            if (config.autonomyLevel >= 3) {
              const signal = {
                id: `mt-${tenantId}-${Date.now()}`,
                ticker: symbol,
                direction: 'buy' as const,
                confidence: score,
                timeframe: '1h' as const,
                indicators: {},
                pattern: starData.catalyst || 'research_star',
                timestamp: new Date(),
                source: 'neural_trader' as const,
              };

              const order = await executor.execute(signal, quantity, positionBudget);
              result.signalActions.push(
                `${order.status === 'filled' ? 'BOUGHT' : order.status.toUpperCase()} ` +
                `${symbol} x${quantity} @ $${quote.price.toFixed(2)} ` +
                `(score=${score.toFixed(2)})`,
              );

              // Stop if we've hit max positions
              if (currentPositions.length + result.signalActions.length >= config.maxPositions) break;
            } else {
              result.signalActions.push(
                `SIGNAL: ${symbol} score=${score.toFixed(2)} -- autonomy too low to auto-execute`,
              );
            }
          }

          if (result.signalActions.length === 0) {
            result.signalActions.push('No actionable signals for tenant');
          }
        }
      } catch (err: any) {
        result.errors.push(`scan_signals error: ${err.message}`);
      }
    }

    return result;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private createServiceBundle(
    config: TenantConfig,
    alpacaCreds?: DecryptedCredentials | null,
    oandaCreds?: DecryptedCredentials | null,
  ): TenantServices {
    // Trade executor -- configured with tenant's Alpaca keys
    const brokerConfig: Partial<BrokerConfig> = {};
    if (alpacaCreds) {
      brokerConfig.apiKey = alpacaCreds.apiKey;
      brokerConfig.apiSecret = alpacaCreds.apiSecret;
      brokerConfig.paperTrading = alpacaCreds.mode === 'paper';
      brokerConfig.baseUrl = alpacaCreds.mode === 'paper'
        ? 'https://paper-api.alpaca.markets'
        : 'https://api.alpaca.markets';
    }
    const executor = new TradeExecutor(brokerConfig);

    // Position manager -- configured with tenant's rules
    const positionRules: Partial<PositionRules> = {
      stopLossPct: config.stopLossPct,
      takeProfitPct: config.takeProfitPct,
    };
    const goalConfig: Partial<DailyGoalConfig> = {
      targetDailyPnl: config.dailyGoal,
    };
    const positionManager = new PositionManager(positionRules, goalConfig);

    // Bayesian intelligence -- fresh instance per tenant
    const bayesianIntel = new BayesianIntelligence();

    // Adaptive state -- tenant's own thresholds
    const adaptiveState = createDefaultAdaptiveState();

    // Forex scanner -- only if OANDA credentials are provided
    let forexScanner: ForexScanner | undefined;
    if (oandaCreds && oandaCreds.apiKey) {
      forexScanner = new ForexScanner({
        oandaApiKey: oandaCreds.apiKey,
        oandaAccountId: oandaCreds.accountId || undefined,
        oandaMode: oandaCreds.mode === 'live' ? 'live' : 'practice',
      });
    }

    return {
      executor,
      positionManager,
      bayesianIntel,
      adaptiveState,
      forexScanner,
      config,
    };
  }
}

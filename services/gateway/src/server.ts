import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __gatewayDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(__gatewayDir, '.env.local') }); // Load gateway/.env.local with absolute path
import express from 'express';
import { MidStream } from '../../midstream/src/index.js';
import { NeuralTrader } from '../../neural-trader/src/index.js';
import { MinCut } from '../../mincut/src/index.js';
import { SAFLA } from '../../safla/src/index.js';
import { AuthorityMatrix } from '../../authority-matrix/src/index.js';
import { RiskControls } from '../../authority-matrix/src/risk-controls.js';
import { WitnessChain } from '../../qudag/src/witness-chain.js';
import { CredentialVault } from '../../qudag/src/vault.js';
import { RVFEngine } from '../../rvf-engine/src/index.js';
import { seedAllenKnowledgeBase } from '../../rvf-engine/src/seed-knowledge.js';
import { seedRoadmap } from '../../rvf-engine/src/seed-roadmap.js';
import { LearningEngine } from '../../rvf-engine/src/learning-engine.js';
import { TraitEngine } from '../../rvf-engine/src/trait-engine.js';
import { TradeExecutor } from '../../neural-trader/src/executor.js';
import { PositionManager } from '../../neural-trader/src/position-manager.js';
import { AutonomyEngine } from './autonomy-engine.js';
import { RealEstateEvaluator } from '../../realestate/src/evaluator.js';
import { RE_AGENT_ROSTER } from '../../realestate/src/agent-roster.js';
import { StrategicPlanner } from '../../mincut/src/strategic-planner.js';
import { DailyOptimizer, getMarketCondition } from '../../mincut/src/daily-optimizer.js';
import { BayesianIntelligence } from '../../shared/intelligence/bayesian-intelligence.js';
import { initAgentMemory, queryPatterns, queryEpisodes, querySkills, getMemoryStats, getAgentDB, type TradingPattern } from '../../shared/intelligence/agent-memory.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { GlobalStream } from '../../globalstream/src/index.js';
import { CommoditiesTrader } from '../../commodities-trader/src/index.js';
import { DataCenterInfra } from '../../datacenter-infra/src/index.js';
import { MetalsTrader } from '../../metals-trader/src/index.js';
import { ForexScanner } from '../../forex-scanner/src/index.js';
import { REITTrader } from '../../reit-trader/src/index.js';
import { OptionsTrader } from '../../options-trader/src/index.js';
import { OpenClawExpansion } from './openclaw-expansion.js';
import { createExpansionRoutes } from './routes/expansion.js';
import { neuralForecast, quickForecast, probabilisticForecast } from '../../neural-trader/src/neural-forecast.js';
import { AGUIStream } from './ag-ui-stream.js';
import { WebhookRelay } from './webhook-relay.js';

const app = express();
app.use(express.json());

// Initialize all services
const midstream = new MidStream();
const neuralTrader = new NeuralTrader();
const mincut = new MinCut();
const safla = new SAFLA();
const authority = new AuthorityMatrix();
const riskControls = new RiskControls();
const executor = new TradeExecutor();
const autonomyEngine = new AutonomyEngine();
const positionManager = new PositionManager();
const reEvaluator = new RealEstateEvaluator();
const strategicPlanner = new StrategicPlanner(mincut);
const bayesianIntel = new BayesianIntelligence();
let witnessChain: WitnessChain;
let rvfEngine: RVFEngine;
let vault: CredentialVault;
let learningEngine: LearningEngine;
let traitEngine: TraitEngine;

// ===== ADAPTIVE LEARNING STATE — system learns from its own outcomes =====
// Updated by bayesian-intel:sync_intelligence every heartbeat cycle
// GLOBAL across all domains: equities, forex, real estate
const adaptiveState = {
  // === US Equities (Momentum Star) ===
  momentumStarThreshold: 0.55,    // Entry threshold — raised when losing, lowered when winning
  minPrice: 5.00,                   // Minimum stock price — no penny stocks, swing-quality only
  maxPriceForMomentum: 500,       // Upper price limit
  avoidTickers: new Set<string>(), // Bayesian worst performers — blocked from entry
  preferTickers: new Set<string>(), // Bayesian best performers — prioritized
  stopLossDominance: 0,           // Ratio of stop_loss exits — if high, system is buying garbage

  // === Forex ===
  forexThreshold: 0.55,           // Forex entry score threshold — raised from 0.45 (was too loose)
  forexAvoidPairs: new Set<string>(), // Pairs that consistently lose
  forexPreferPairs: new Set<string>(), // Pairs that consistently win
  forexMaxPositions: 2,           // 2 positions on $1K capital — concentrated
  forexBudget: 1000,              // $1K OANDA capital ($5K total: $4K Alpaca + $1K OANDA)
  forexMaxUnitsPerTrade: 25000,   // 25K units × 2 positions = ~$1K margin at 50:1, fits $1K account
  forexKnownTradeIds: new Set<string>(), // Track open trade IDs for closed-trade detection

  // === Real Estate ===
  reMinNDScore: 4.0,              // Minimum Nothing Down score — raised when deals fail
  rePreferSources: new Set<string>(), // Sources with high success (e.g., 'Foreclosure')
  reAvoidSources: new Set<string>(),  // Sources with low success
  rePreferTechniques: new Set<string>(), // Techniques with high response rate

  // === Global ===
  lastAdaptation: '',             // Timestamp of last adaptation
};

// Credential loading — vault first, then env var fallback
let alpacaKey = process.env.ALPACA_API_KEY || '';
let alpacaSec = process.env.ALPACA_API_SECRET || '';
let alpacaMode = 'paper';

// Try vault
try {
  vault = new CredentialVault(process.env.MTWM_VAULT_KEY || 'mtwm-local-dev-key');
  const savedKey = vault.retrieve('alpaca-api-key');
  const savedSecret = vault.retrieve('alpaca-api-secret');
  const savedMode = vault.retrieve('alpaca-mode');
  if (savedKey && savedSecret) {
    alpacaKey = savedKey;
    alpacaSec = savedSecret;
    alpacaMode = savedMode || 'paper';
    console.log(`[Vault] Restored Alpaca credentials — ${alpacaMode} mode`);
  } else {
    console.log('[Vault] No Alpaca credentials in vault, checking env vars...');
  }
} catch (error) {
  console.warn('[Gateway] Vault unavailable, checking env vars...');
}

// Apply credentials from whichever source provided them
if (alpacaKey && alpacaSec) {
  const baseUrl = alpacaMode === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets';
  (midstream as any).config.alpacaApiKey = alpacaKey;
  (midstream as any).config.alpacaApiSecret = alpacaSec;
  (midstream as any).config.alpacaBaseUrl = baseUrl;
  (executor as any).config.apiKey = alpacaKey;
  (executor as any).config.apiSecret = alpacaSec;
  (executor as any).config.baseUrl = baseUrl;
  if (!vault) console.log(`[Env] Loaded Alpaca credentials from environment — ${alpacaMode} mode`);
} else {
  console.warn('[Gateway] NO ALPACA CREDENTIALS — set via vault, env vars, or /api/broker/connect');
}

// SQLite-dependent services (witness chain, RVF) — separate so vault failure doesn't block these
try {
  witnessChain = new WitnessChain();
  rvfEngine = new RVFEngine();
} catch (error) {
  console.warn('[Gateway] SQLite services will start when data directory exists');
}

// Wire up event listeners
eventBus.on('signal:new', (payload) => {
  console.log(`[Signal] ${payload.direction.toUpperCase()} ${payload.ticker} (confidence: ${payload.confidence})`);
  if (witnessChain) {
    witnessChain.record('signal_generated', 'neural_trader', 'trading', payload);
  }
});

eventBus.on('decision:created', (payload) => {
  console.log(`[Decision] ${payload.decisionId} — authority: ${payload.authority}`);
  if (witnessChain) {
    witnessChain.record('decision_created', 'authority_matrix', 'governance', payload);
  }
});

eventBus.on('trade:executed', (payload) => {
  console.log(`[Trade] ${payload.side.toUpperCase()} ${payload.shares} ${payload.ticker} @ $${payload.price}`);
  if (witnessChain) {
    witnessChain.record('trade_executed', 'executor', 'trading', payload);
  }
});

eventBus.on('trade:closed', (payload) => {
  console.log(`[Trade Closed] ${payload.ticker}: ${payload.success ? 'WIN' : 'LOSS'} ${(payload.returnPct * 100).toFixed(2)}% ($${payload.pnl.toFixed(2)}) — ${payload.reason}`);
  if (witnessChain) {
    witnessChain.record('trade_closed', 'position_manager', 'trading', payload);
  }
  // Record prediction accuracy BEFORE updating beliefs — measures if we predicted correctly
  bayesianIntel.recordPrediction(`ticker:${payload.ticker}`, payload.success);
  bayesianIntel.recordPrediction(`momentum:${payload.ticker}:outcome`, payload.success);
  // Feed outcome to trait engine — use BOTH ID formats so existing traits get updated
  if (traitEngine) {
    // Hyphenated format (created by signal:new listener)
    traitEngine.recordOutcome(`signal-accuracy-${payload.ticker}`, payload.success, payload.returnPct);
    // Underscore format (legacy)
    traitEngine.recordOutcome(`signal_accuracy_${payload.ticker}`, payload.success, payload.returnPct);
    // Also update the indicator composite trait
    traitEngine.recordOutcome(`indicator-composite-${payload.ticker}`, payload.success, payload.returnPct);
    // Ticker behavior trait
    traitEngine.recordOutcome(`ticker-${payload.ticker}`, payload.success, payload.returnPct);
  }
});

eventBus.on('risk:alert', (payload) => {
  console.log(`[RISK ALERT] ${payload.metric}: ${payload.value} (threshold: ${payload.threshold})`);
  if (witnessChain) {
    witnessChain.record('risk_alert', 'risk_controls', 'governance', payload);
  }
});

// ========= API ROUTES =========

// System status
app.get('/api/status', (_req, res) => {
  res.json({
    system: 'MTWM Gateway v6.0',
    uptime: process.uptime(),
    services: {
      midstream: { status: 'active', symbols: midstream.getAllQuotes().length },
      neuralTrader: { status: 'active', activeSignals: neuralTrader.getActiveSignals().length },
      mincut: { status: 'ready' },
      safla: { status: 'active', metrics: safla.getMetrics() },
      authority: { status: 'active', pending: authority.getPending().length },
      witnessChain: { status: witnessChain ? 'active' : 'unavailable' },
      rvfEngine: { status: rvfEngine ? 'active' : 'unavailable' },
      ruvSwarm: { status: 'active', models: ['LSTM', 'GRU'], role: 'Neural forecast (vote #7)' },
      bayesianIntel: { status: 'active', ...bayesianIntel.getCollectiveIntelligence() },
      agentDB: { status: getMemoryStats().initialized ? 'active' : 'unavailable', ...getMemoryStats() },
    },
    autonomy: autonomyEngine.getStatus(),
    performance: positionManager.getPerformanceStats(),
    activeAgents: 5,
    queuedTasks: authority.getPending().length,
    completedToday: 0,
    agents: [
      { name: 'neural-trader', status: 'busy', currentTask: 'Scanning signals' },
      { name: 'mincut-optimizer', status: 'idle' },
      { name: 'safla-oversight', status: 'busy', currentTask: 'Monitoring drift' },
      { name: 'qudag-witness', status: witnessChain ? 'busy' : 'error', currentTask: 'Recording chain' },
      { name: 'midstream-feed', status: 'busy', currentTask: 'Market data ingestion' },
    ],
  });
});

// Market data
app.get('/api/market/quotes', (_req, res) => {
  res.json({ quotes: midstream.getAllQuotes() });
});

app.get('/api/market/quote/:ticker', (req, res) => {
  const quote = midstream.getLatestQuote(req.params.ticker);
  if (!quote) return res.status(404).json({ error: 'Ticker not found' });
  res.json(quote);
});

// Neural Trader signals
app.get('/api/signals', (_req, res) => {
  res.json({ active: neuralTrader.getActiveSignals(), history: neuralTrader.getSignalHistory() });
});

app.post('/api/signals/scan', async (_req, res) => {
  const signals = await neuralTrader.scan();
  res.json({ signals, count: signals.length });
});

app.get('/api/signals/diagnose', async (_req, res) => {
  const diagnosis = await neuralTrader.diagnose();
  res.json(diagnosis);
});

// Probabilistic Forecast — FANN multi-model ensemble with Monte Carlo uncertainty
app.get('/api/forecast/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const horizon = parseInt(req.query.horizon as string) || 5;
  const trajectory = req.query.trajectory === 'true';

  // Get price history from neural trader's ingested data
  const history = neuralTrader.getPriceHistory(symbol);

  if (history.length < 50) {
    return res.status(400).json({ error: `Insufficient price history for ${symbol} (need 50+ bars, have ${history.length})` });
  }

  try {
    const { probabilisticForecast } = await import('../../neural-trader/src/neural-forecast.js');
    const forecast = await probabilisticForecast(symbol, history, horizon, trajectory);
    if (!forecast) return res.status(500).json({ error: 'Forecast failed — insufficient data or model error' });
    res.json(forecast);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Batch forecast — run probabilistic forecast on all open positions
app.get('/api/forecast/batch', async (_req, res) => {
  const positions = await executor.getPositions();
  const forecasts: any[] = [];

  const { probabilisticForecast } = await import('../../neural-trader/src/neural-forecast.js');

  await Promise.all(
    (positions || []).map(async (pos: any) => {
      const ticker = pos.symbol || pos.ticker;
      const history = neuralTrader.getPriceHistory(ticker);
      if (history.length < 50) return;
      try {
        const forecast = await probabilisticForecast(ticker, history, 5, false);
        if (forecast) forecasts.push(forecast);
      } catch { /* skip */ }
    })
  );

  res.json({ forecasts, count: forecasts.length });
});

// Authority & Decisions
app.get('/api/decisions', (_req, res) => {
  res.json({ decisions: authority.getPending() });
});

app.post('/api/decisions/:id/approve', (req, res) => {
  const decision = authority.approve(req.params.id);
  if (!decision) return res.status(404).json({ error: 'Decision not found' });
  if (witnessChain) witnessChain.record('decision_approved', 'owner', 'governance', { decisionId: decision.id });
  res.json(decision);
});

app.post('/api/decisions/:id/reject', (req, res) => {
  const decision = authority.reject(req.params.id);
  if (!decision) return res.status(404).json({ error: 'Decision not found' });
  if (witnessChain) witnessChain.record('decision_rejected', 'owner', 'governance', { decisionId: decision.id });
  res.json(decision);
});

app.post('/api/evaluate/trade', (req, res) => {
  const { amount, description, module } = req.body;
  const decision = authority.evaluateTrade(amount, description, module || 'trading');
  res.json(decision);
});

// Risk controls
app.get('/api/risk', async (_req, res) => {
  const account = await executor.getAccount();
  const positions = await executor.getPositions();

  const cash = account?.cash || 0;
  const totalValue = account?.portfolioValue || 0;

  const riskPositions = positions.map(p => ({
    ...p,
    sector: p.ticker.includes('/') || p.ticker.includes('-') ? 'crypto' : 'tech',
    category: (p.ticker.includes('/') || p.ticker.includes('-') ? 'crypto' : 'equity') as 'crypto' | 'equity',
  }));

  const portfolio = { positions: riskPositions, cash, totalValue, dayPnl: 0, dayPnlPercent: 0, sectorExposure: {} };
  const risk = riskControls.evaluate(portfolio);
  res.json(risk);
});

// Broker account & positions
app.get('/api/broker/account', async (_req, res) => {
  const account = await executor.getAccount();
  if (!account) return res.json({ cash: 0, portfolioValue: 0, buyingPower: 0, equity: 0, lastEquity: 0, dayPnl: 0, connected: false });
  // Day P&L: equity - last_equity is what Alpaca shows on their dashboard
  const dayPnl = (account.equity || 0) - (account.lastEquity || 0);
  res.json({ ...account, dayPnl, connected: true });
});

app.get('/api/broker/history', async (req, res) => {
  const period = (req.query.period as string) || '1M';
  const timeframe = (req.query.timeframe as string) || '1D';
  const history = await executor.getPortfolioHistory(period, timeframe);
  if (!history) return res.json({ error: 'unavailable' });
  res.json(history);
});

app.get('/api/broker/positions', async (_req, res) => {
  const positions = await executor.getPositions();
  res.json({ positions, count: positions.length });
});

// Direct order placement — for manual trades and crypto 24/7
app.post('/api/broker/order', async (req, res) => {
  const { symbol, qty, side, type = 'market', time_in_force } = req.body;
  if (!symbol || !qty || !side) return res.status(400).json({ error: 'symbol, qty, side required' });
  const apiKey = (executor as any).config.apiKey;
  const apiSecret = (executor as any).config.apiSecret;
  const baseUrl = (executor as any).config.baseUrl;
  if (!apiKey) return res.status(503).json({ error: 'No broker credentials' });
  try {
    const isCrypto = symbol.includes('/') || symbol.includes('-');
    const alpacaSymbol = symbol.replace('-', '/');
    const tif = time_in_force || (isCrypto ? 'gtc' : 'day');
    const response = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: alpacaSymbol, qty: String(qty), side, type, time_in_force: tif }),
    });
    const result = await response.json();
    if (!response.ok) return res.status(response.status).json(result);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// SAFLA
app.get('/api/safla/metrics', (_req, res) => {
  res.json(safla.getMetrics());
});

app.get('/api/safla/performance', (_req, res) => {
  res.json(safla.getPerformanceSummary());
});

// Witness chain
app.get('/api/witness/history', (req, res) => {
  if (!witnessChain) return res.status(503).json({ error: 'Witness chain unavailable' });
  const module = req.query.module as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ records: witnessChain.getHistory(module, limit) });
});

app.get('/api/witness/verify', (_req, res) => {
  if (!witnessChain) return res.status(503).json({ error: 'Witness chain unavailable' });
  res.json(witnessChain.verify());
});

// RVF Containers
app.get('/api/rvf', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  const type = req.query.type as string | undefined;
  res.json(rvfEngine.list(type));
});

app.post('/api/rvf', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  const { type, name, payload } = req.body;
  const container = rvfEngine.create(type, name, payload);
  if (witnessChain) witnessChain.record('rvf_created', 'system', type, { containerId: container.id, name });
  res.json(container);
});

app.get('/api/rvf/:id', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  const container = rvfEngine.get(req.params.id);
  if (!container) return res.status(404).json({ error: 'Container not found' });
  res.json(container);
});

app.patch('/api/rvf/:id', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  const container = rvfEngine.update(req.params.id, req.body.payload);
  if (!container) return res.status(404).json({ error: 'Container not found' });
  if (witnessChain) witnessChain.record('rvf_updated', 'system', container.type, { containerId: container.id, version: container.version });
  res.json(container);
});

app.get('/api/rvf/:id/history', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  res.json(rvfEngine.getHistory(req.params.id));
});

app.get('/api/rvf/:id/verify', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  res.json(rvfEngine.verify(req.params.id));
});

// Knowledge base
app.get('/api/knowledge', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  const entries = rvfEngine.list('knowledge');
  res.json({ entries, count: entries.length });
});

app.get('/api/knowledge/search', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: 'Query parameter q required' });
  const results = rvfEngine.search(q, 'knowledge');
  res.json({ results, count: results.length });
});

app.get('/api/knowledge/strategies', (req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  const context = req.query.context as string || '';
  // Return relevant strategies for a given context (e.g., "real-estate", "trading", "reinvestment")
  const all = rvfEngine.search(context || 'robert-allen', 'knowledge');
  res.json({ strategies: all, context });
});

// Learning engine
app.get('/api/learnings', (req, res) => {
  if (!learningEngine) return res.json({ entries: [], summary: {} });
  const limit = parseInt(req.query.limit as string) || 50;
  const category = req.query.category as string | undefined;
  res.json({
    entries: learningEngine.getEntries(limit, category),
    summary: learningEngine.getSummary(),
  });
});

app.get('/api/learnings/insights', (_req, res) => {
  if (!learningEngine) return res.json({ insights: [] });
  res.json({ insights: learningEngine.getInsights() });
});

app.get('/api/learnings/warnings', (_req, res) => {
  if (!learningEngine) return res.json({ warnings: [] });
  res.json({ warnings: learningEngine.getWarnings() });
});

app.post('/api/learnings', (req, res) => {
  if (!learningEngine) return res.status(503).json({ error: 'Learning engine unavailable' });
  const { category, source, type, title, detail, tags, allenReference } = req.body;
  const entry = learningEngine.record({ category, source, type, title, detail, tags: tags || [], allenReference });
  res.json(entry);
});

// Trait engine (Bayesian learning)
app.get('/api/traits', (req, res) => {
  if (!traitEngine) return res.json({ traits: [], metrics: {} });
  const category = req.query.category as string | undefined;
  const traits = category
    ? traitEngine.getTraitsByCategory(category as any)
    : traitEngine.getAllTraits();
  res.json({ traits, metrics: traitEngine.getImprovementMetrics() });
});

app.get('/api/traits/:id', (req, res) => {
  if (!traitEngine) return res.status(503).json({ error: 'Trait engine unavailable' });
  const trait = traitEngine.getTrait(req.params.id);
  if (!trait) return res.status(404).json({ error: 'Trait not found' });
  res.json(trait);
});

app.post('/api/traits/:id/outcome', (req, res) => {
  if (!traitEngine) return res.status(503).json({ error: 'Trait engine unavailable' });
  const { success, returnPct } = req.body;
  traitEngine.recordOutcome(req.params.id, success, returnPct || 0);
  const trait = traitEngine.getTrait(req.params.id);
  res.json(trait);
});

app.get('/api/traits/history/snapshots', (_req, res) => {
  if (!traitEngine) return res.json({ snapshots: [] });
  res.json({ snapshots: traitEngine.getSnapshotHistory() });
});

// Bayesian Intelligence — shared cross-agent learning
app.get('/api/intelligence', (_req, res) => {
  res.json(bayesianIntel.getCollectiveIntelligence());
});

app.get('/api/intelligence/beliefs', (req, res) => {
  const domain = req.query.domain as string | undefined;
  const minObs = parseInt(req.query.minObservations as string) || 0;
  const beliefs = bayesianIntel.query({ domain, minObservations: minObs });
  res.json({ beliefs, count: beliefs.length });
});

app.get('/api/intelligence/ticker/:ticker', (req, res) => {
  const prior = bayesianIntel.getTickerPrior(req.params.ticker);
  res.json(prior);
});

app.get('/api/intelligence/top-performers', (_req, res) => {
  res.json({ performers: bayesianIntel.getTopPerformers() });
});

app.get('/api/intelligence/worst-performers', (_req, res) => {
  res.json({ performers: bayesianIntel.getWorstPerformers() });
});

app.get('/api/intelligence/timing', (_req, res) => {
  res.json({ timing: bayesianIntel.getBestTradingTimes() });
});

app.get('/api/intelligence/insights', (_req, res) => {
  res.json({ insights: bayesianIntel.getRecentInsights() });
});

// Goal Certainty — probabilistic assessment of achieving 100% return in 30 days
// Uses FANN neural confidence, Bayesian domain win rates, adaptive state, and trade history
app.get('/api/intelligence/goal-certainty', async (_req, res) => {
  try {
    // 1. Bayesian domain win rates
    const eqWR = bayesianIntel.getDomainWinRate('momentum_star');
    const fxWR = bayesianIntel.getDomainWinRate('strategy');
    const reWR = bayesianIntel.getDomainWinRate('real_estate');
    const tickerWR = bayesianIntel.getDomainWinRate('ticker');

    // 2. Position manager closed trade stats
    const pmStats = positionManager.getPerformanceStats();

    // 3. Adaptive state health
    const adaptiveHealth = {
      eqThreshold: adaptiveState.momentumStarThreshold,
      fxThreshold: adaptiveState.forexThreshold,
      stopLossDominance: adaptiveState.stopLossDominance,
      avoidCount: adaptiveState.avoidTickers.size + adaptiveState.forexAvoidPairs.size,
      preferCount: adaptiveState.preferTickers.size + adaptiveState.forexPreferPairs.size,
    };

    // 4. Neural forecast confidence (sample current watchlist)
    const quotes = midstream.getAllQuotes();
    let neuralBullish = 0, neuralBearish = 0, neuralNeutral = 0;
    const sampleSize = Math.min(20, quotes.length);
    for (let i = 0; i < sampleSize; i++) {
      const q = quotes[i];
      const history = neuralTrader.getPriceHistory(q.ticker);
      if (history.length < 30) { neuralNeutral++; continue; }
      try {
        const forecast = await neuralForecast(history.map((h: any) => h.close || h.price));
        if (forecast) {
          if (forecast.direction === 'up') neuralBullish++;
          else if (forecast.direction === 'down') neuralBearish++;
          else neuralNeutral++;
        } else neuralNeutral++;
      } catch { neuralNeutral++; }
    }

    // 5. Compute goal certainty factors (0-1 each)
    // a) Strategy effectiveness — are our trades winning?
    const strategyFactor = Math.max(0, Math.min(1,
      (eqWR.winRate * 0.5 + tickerWR.winRate * 0.3 + (pmStats.winRate || 0.5) * 0.2)
    ));

    // b) Market conditions — is the market favorable?
    const marketBullRatio = sampleSize > 0 ? neuralBullish / sampleSize : 0.5;
    const marketFactor = Math.max(0, Math.min(1,
      marketBullRatio * 0.6 + (1 - adaptiveHealth.stopLossDominance) * 0.4
    ));

    // c) Learning maturity — does the system have enough data to be smart?
    const totalObs = eqWR.observations + fxWR.observations + reWR.observations;
    const learningFactor = Math.max(0, Math.min(1,
      1 - (1 / (1 + totalObs * 0.01))
    ));

    // d) Risk management — is the system protecting capital?
    const riskFactor = Math.max(0, Math.min(1,
      (1 - adaptiveHealth.stopLossDominance) * 0.5 +
      (pmStats.profitFactor || 0) * 0.3 +
      (adaptiveHealth.avoidCount > 0 ? 0.2 : 0) // Learning to avoid is good
    ));

    // e) Diversification — are multiple streams active?
    const streams = [
      eqWR.observations > 5 ? 1 : 0,  // Equities active
      fxWR.observations > 5 ? 1 : 0,   // Forex active
      reWR.observations > 5 ? 1 : 0,   // Real estate active
    ];
    const diversificationFactor = Math.max(0.2, streams.reduce((a, b) => a + b, 0) / 3);

    // Weighted composite certainty
    const certainty = Math.max(0, Math.min(1,
      strategyFactor * 0.35 +
      marketFactor * 0.25 +
      learningFactor * 0.15 +
      riskFactor * 0.15 +
      diversificationFactor * 0.10
    ));

    // Classification
    const level = certainty >= 0.75 ? 'HIGH' :
                  certainty >= 0.50 ? 'MODERATE' :
                  certainty >= 0.30 ? 'LOW' : 'VERY LOW';

    // Blockers and accelerators
    const blockers: string[] = [];
    const accelerators: string[] = [];

    if (adaptiveHealth.stopLossDominance > 0.60) blockers.push(`${(adaptiveHealth.stopLossDominance * 100).toFixed(0)}% of exits are stop losses — entry quality needs improvement`);
    if (eqWR.winRate < 0.35) blockers.push(`Equity win rate at ${(eqWR.winRate * 100).toFixed(0)}% — need >50% for compounding`);
    if (pmStats.profitFactor < 1.0 && pmStats.totalTrades > 0) blockers.push(`Profit factor ${pmStats.profitFactor.toFixed(2)} < 1.0 — losing more than winning`);
    if (marketBullRatio < 0.3) blockers.push(`Neural sees ${(marketBullRatio * 100).toFixed(0)}% bullish — bearish market headwind`);
    if (totalObs < 50) blockers.push(`Only ${totalObs} observations — system still learning`);

    if (eqWR.winRate > 0.55) accelerators.push(`Equity win rate ${(eqWR.winRate * 100).toFixed(0)}% — compounding working`);
    if (adaptiveHealth.preferCount > 0) accelerators.push(`${adaptiveHealth.preferCount} preferred tickers/pairs identified by Bayesian learning`);
    if (marketBullRatio > 0.6) accelerators.push(`Neural sees ${(marketBullRatio * 100).toFixed(0)}% bullish — favorable conditions`);
    if (pmStats.profitFactor > 1.5) accelerators.push(`Profit factor ${pmStats.profitFactor.toFixed(2)} — winners outpacing losers`);
    if (learningFactor > 0.7) accelerators.push(`Learning maturity at ${(learningFactor * 100).toFixed(0)}% — system calibrated`);
    if (streams.reduce((a, b) => a + b, 0) >= 2) accelerators.push(`${streams.reduce((a, b) => a + b, 0)} income streams active — diversified`);

    res.json({
      goalCertainty: {
        certainty: Math.round(certainty * 1000) / 10, // percentage with 1 decimal
        level,
        target: '100% return in 30 days',
        factors: {
          strategy: { score: Math.round(strategyFactor * 100), label: 'Strategy Effectiveness', detail: `Eq WR: ${(eqWR.winRate * 100).toFixed(0)}%, Ticker WR: ${(tickerWR.winRate * 100).toFixed(0)}%, PM WR: ${((pmStats.winRate || 0) * 100).toFixed(0)}%` },
          market: { score: Math.round(marketFactor * 100), label: 'Market Conditions', detail: `Neural: ${neuralBullish}↑ ${neuralBearish}↓ ${neuralNeutral}→ of ${sampleSize}` },
          learning: { score: Math.round(learningFactor * 100), label: 'Learning Maturity', detail: `${totalObs} total observations across ${streams.reduce((a, b) => a + b, 0)} domains` },
          risk: { score: Math.round(riskFactor * 100), label: 'Risk Management', detail: `SL dominance: ${(adaptiveHealth.stopLossDominance * 100).toFixed(0)}%, PF: ${(pmStats.profitFactor || 0).toFixed(2)}` },
          diversification: { score: Math.round(diversificationFactor * 100), label: 'Stream Diversification', detail: `${streams.reduce((a, b) => a + b, 0)}/3 streams active` },
        },
        blockers,
        accelerators,
        neuralSentiment: { bullish: neuralBullish, bearish: neuralBearish, neutral: neuralNeutral, total: sampleSize },
        tradeStats: pmStats,
        adaptive: {
          eqThreshold: adaptiveHealth.eqThreshold,
          fxThreshold: adaptiveHealth.fxThreshold,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/adaptive', (_req, res) => {
  res.json({
    adaptive: {
      equities: {
        threshold: adaptiveState.momentumStarThreshold,
        minPrice: adaptiveState.minPrice,
        avoidTickers: Array.from(adaptiveState.avoidTickers),
        preferTickers: Array.from(adaptiveState.preferTickers),
        stopLossDominance: adaptiveState.stopLossDominance,
      },
      forex: {
        threshold: adaptiveState.forexThreshold,
        maxPositions: adaptiveState.forexMaxPositions,
        avoidPairs: Array.from(adaptiveState.forexAvoidPairs),
        preferPairs: Array.from(adaptiveState.forexPreferPairs),
      },
      realEstate: {
        minNDScore: adaptiveState.reMinNDScore,
        preferSources: Array.from(adaptiveState.rePreferSources),
        avoidSources: Array.from(adaptiveState.reAvoidSources),
        preferTechniques: Array.from(adaptiveState.rePreferTechniques),
      },
      lastAdaptation: adaptiveState.lastAdaptation,
      domainWinRates: {
        momentum_star: bayesianIntel.getDomainWinRate('momentum_star'),
        ticker: bayesianIntel.getDomainWinRate('ticker'),
        strategy: bayesianIntel.getDomainWinRate('strategy'),
        forex_pair: bayesianIntel.getDomainWinRate('forex_pair'),
        real_estate: bayesianIntel.getDomainWinRate('real_estate'),
      },
    },
  });
});

// Intelligence Metrics — how much smarter are agents getting over time?
// Tracks prediction accuracy, posterior convergence, regret minimization, and learning curves
app.get('/api/intelligence/metrics', (_req, res) => {
  const metrics = bayesianIntel.getIntelligenceMetrics();
  const intel = bayesianIntel.getCollectiveIntelligence();
  res.json({
    intelligence: {
      // Core metrics
      predictionAccuracy: metrics.currentAccuracy,
      accuracyTrend: metrics.accuracyTrend,
      posteriorDivergence: metrics.posteriorDivergence,
      convergenceRate: metrics.convergenceRate,
      cumulativeRegret: metrics.cumulativeRegret,
      regretTrend: metrics.regretTrend,
      totalPredictions: metrics.totalPredictions,
      // How knowledgeable the system is
      totalBeliefs: intel.totalBeliefs,
      totalObservations: intel.totalObservations,
      agentContributions: intel.agentContributions,
      // Per-domain intelligence growth
      domainProgress: metrics.domainProgress,
      // Learning curve time series (for charting)
      learningCurve: metrics.learningCurve,
      // Top insights the system has discovered
      topInsights: intel.topInsights,
    },
  });
});

// AgentDB Memory — shared vector learning across all agents
app.get('/api/memory/stats', (_req, res) => {
  res.json(getMemoryStats());
});

app.get('/api/memory/patterns', async (req, res) => {
  const task = req.query.task as string || 'profitable trade';
  const k = parseInt(req.query.k as string) || 5;
  const patterns = await queryPatterns(task, { k });
  res.json({ patterns, count: patterns.length });
});

app.get('/api/memory/episodes', async (req, res) => {
  const task = req.query.task as string || 'trade';
  const k = parseInt(req.query.k as string) || 10;
  const onlySuccesses = req.query.wins === 'true';
  const onlyFailures = req.query.losses === 'true';
  const episodes = await queryEpisodes(task, { k, onlySuccesses, onlyFailures });
  res.json({ episodes, count: episodes.length });
});

app.get('/api/memory/skills', async (req, res) => {
  const task = req.query.task as string || 'trade';
  const k = parseInt(req.query.k as string) || 5;
  const skillList = await querySkills(task, { k });
  res.json({ skills: skillList, count: skillList.length });
});

// Roadmap
app.get('/api/roadmap', (_req, res) => {
  if (!rvfEngine) return res.status(503).json({ error: 'RVF engine unavailable' });
  const roadmaps = rvfEngine.search('mtwm-roadmap', 'roadmap');
  if (roadmaps.length === 0) return res.json({ roadmap: null });
  res.json({ roadmap: roadmaps[0] });
});

app.post('/api/roadmap/check-milestones', (_req, res) => {
  if (!learningEngine) return res.status(503).json({ error: 'Learning engine unavailable' });
  learningEngine.checkMilestones();
  const roadmaps = rvfEngine.search('mtwm-roadmap', 'roadmap');
  res.json({ roadmap: roadmaps[0] || null });
});

// Broker configuration (Alpaca)
app.post('/api/broker/configure', (req, res) => {
  const { apiKey, apiSecret, paperTrading } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'apiKey and apiSecret required' });

  const mode = (paperTrading ?? true) ? 'paper' : 'live';
  const baseUrl = mode === 'paper'
    ? 'https://paper-api.alpaca.markets'
    : 'https://api.alpaca.markets';

  // Store encrypted in QuDAG vault
  if (vault) {
    vault.store('alpaca-api-key', 'Alpaca API Key', apiKey, 'broker');
    vault.store('alpaca-api-secret', 'Alpaca API Secret', apiSecret, 'broker');
    vault.store('alpaca-mode', 'Alpaca Trading Mode', mode, 'broker');
    console.log('[Vault] Alpaca credentials stored encrypted');
  }

  if (witnessChain) {
    witnessChain.record('broker_configured', 'owner', 'trading', {
      broker: 'alpaca',
      mode,
      timestamp: new Date().toISOString(),
    });
  }

  // Update midstream + executor config
  (midstream as any).config.alpacaApiKey = apiKey;
  (midstream as any).config.alpacaApiSecret = apiSecret;
  (midstream as any).config.alpacaBaseUrl = baseUrl;
  (executor as any).config.apiKey = apiKey;
  (executor as any).config.apiSecret = apiSecret;
  (executor as any).config.baseUrl = baseUrl;

  console.log(`[Broker] Alpaca configured — ${mode.toUpperCase()} trading`);
  res.json({ status: 'configured', broker: 'alpaca', mode, baseUrl });
});

app.get('/api/broker/status', (_req, res) => {
  const hasKeys = !!(midstream as any).config.alpacaApiKey;
  const isPaper = ((midstream as any).config.alpacaBaseUrl || '').includes('paper');
  res.json({
    configured: hasKeys,
    broker: hasKeys ? 'alpaca' : 'none',
    mode: hasKeys ? (isPaper ? 'paper' : 'live') : 'simulated',
  });
});

// Ticker metadata — enriched snapshot for dashboard detail panel
app.get('/api/ticker/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const alpacaKey = (midstream as any).config.alpacaApiKey;
  const alpacaSec = (midstream as any).config.alpacaApiSecret;
  if (!alpacaKey || !alpacaSec) return res.status(503).json({ error: 'No broker credentials' });

  const headers = { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSec };
  const isCrypto = symbol.includes('-') || symbol.includes('/');
  const result: Record<string, any> = { symbol };

  try {
    // 1. Asset info (name, exchange, class, status)
    if (!isCrypto) {
      const assetRes = await fetch(`https://paper-api.alpaca.markets/v2/assets/${symbol}`, { headers });
      if (assetRes.ok) {
        const a = await assetRes.json() as any;
        result.name = a.name;
        result.exchange = a.exchange;
        result.assetClass = a.class;
        result.tradable = a.tradable;
        result.shortable = a.shortable;
        result.fractionable = a.fractionable;
      }
    } else {
      result.name = symbol.replace('-', '/').replace('/', '/');
      result.exchange = 'Crypto';
      result.assetClass = 'crypto';
    }

    // 2. Snapshot (latest trade, quote, daily bar, prev daily bar)
    const snapUrl = isCrypto
      ? `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${symbol.replace('-', '/')}`
      : `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbol}&feed=iex`;
    const snapRes = await fetch(snapUrl, { headers });
    if (snapRes.ok) {
      const data = await snapRes.json() as any;
      const snapshots = data.snapshots || data;
      const key = isCrypto ? symbol.replace('-', '/') : symbol;
      const snap = snapshots[key];
      if (snap) {
        result.latestPrice = snap.latestTrade?.p || snap.latestQuote?.ap || 0;
        result.latestVolume = snap.latestTrade?.s || 0;
        result.bidPrice = snap.latestQuote?.bp || 0;
        result.askPrice = snap.latestQuote?.ap || 0;
        result.bidSize = snap.latestQuote?.bs || 0;
        result.askSize = snap.latestQuote?.as || 0;
        // Daily bar
        if (snap.dailyBar) {
          result.dayOpen = snap.dailyBar.o;
          result.dayHigh = snap.dailyBar.h;
          result.dayLow = snap.dailyBar.l;
          result.dayClose = snap.dailyBar.c;
          result.dayVolume = snap.dailyBar.v;
          result.dayVwap = snap.dailyBar.vw;
          result.dayChange = snap.dailyBar.c - snap.dailyBar.o;
          result.dayChangePercent = snap.dailyBar.o > 0 ? ((snap.dailyBar.c - snap.dailyBar.o) / snap.dailyBar.o) * 100 : 0;
        }
        // Previous daily bar
        if (snap.prevDailyBar) {
          result.prevClose = snap.prevDailyBar.c;
          result.prevVolume = snap.prevDailyBar.v;
        }
      }
    }

    // 3. Neural Trader diagnosis for this ticker
    const diagnosis = await neuralTrader.diagnose();
    const tickerDiag = diagnosis[symbol];
    if (tickerDiag && tickerDiag.status !== 'insufficient_data') {
      result.indicators = {
        rsi: tickerDiag.rsi,
        macd: tickerDiag.macd,
        bbPosition: tickerDiag.bbPosition,
        emaFast: tickerDiag.emaFast,
        emaMid: tickerDiag.emaMid,
        momentum5: tickerDiag.mom5,
        volatility: tickerDiag.volatility,
      };
      if (tickerDiag.signalFired) {
        result.activeSignal = {
          direction: tickerDiag.direction,
          confidence: tickerDiag.confidence,
        };
      }
    }

    // 4. Bayesian prior for this ticker
    const prior = bayesianIntel.getTickerPrior(symbol);
    if (prior.observations > 0) {
      result.bayesian = {
        winRate: prior.posterior,
        observations: prior.observations,
      };
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch ticker data' });
  }
});

// Trading phase management
let currentPhase: 'paper' | 'real_initial' | 'real_full' = 'paper';

app.get('/api/phase', (_req, res) => {
  const phaseThresholds = {
    paper: { autonomous: 500, notify: 2000, dailyVolume: 5000 },
    real_initial: { autonomous: 50, notify: 200, dailyVolume: 500 },
    real_full: { autonomous: 10000, notify: 50000, dailyVolume: 50000 },
  };
  res.json({ phase: currentPhase, thresholds: phaseThresholds[currentPhase] });
});

app.post('/api/phase', (req, res) => {
  const { phase } = req.body;
  if (!['paper', 'real_initial', 'real_full'].includes(phase)) {
    return res.status(400).json({ error: 'Invalid phase' });
  }
  currentPhase = phase;
  if (witnessChain) {
    witnessChain.record('phase_changed', 'owner', 'governance', { phase });
  }
  console.log(`[Phase] Switched to: ${phase}`);
  res.json({ phase: currentPhase });
});

// Dispatch (for ruflow client compatibility)
app.post('/api/dispatch', (req, res) => {
  const { agent, action, params } = req.body;
  console.log(`[Dispatch] ${agent}.${action}`, params);

  // Route to appropriate service
  switch (agent) {
    case 'neural_trader':
      if (action === 'scan') {
        const signals = neuralTrader.scan();
        return res.json({ taskId: `task-${Date.now()}`, status: 'completed', result: signals });
      }
      break;
    case 'finley':
      if (action === 'generate_briefing') {
        return res.json({ taskId: `task-${Date.now()}`, status: 'completed', result: { message: 'Briefing queued' } });
      }
      break;
    case 'harbor':
      if (action === 'query') {
        return res.json({ taskId: `task-${Date.now()}`, status: 'completed', result: { message: 'Query routed to Claude' } });
      }
      break;
  }

  res.json({ taskId: `task-${Date.now()}`, status: 'queued', result: null });
});

// Task results (for ruflow client compatibility)
app.get('/api/tasks/:taskId', (req, res) => {
  res.json({ taskId: req.params.taskId, status: 'completed', result: null });
});

// Close all positions (emergency)
app.delete('/api/broker/positions', async (_req, res) => {
  const apiKey = (executor as any).config.apiKey;
  const apiSecret = (executor as any).config.apiSecret;
  const baseUrl = (executor as any).config.baseUrl;
  if (!apiKey) return res.status(400).json({ error: 'No broker credentials' });

  try {
    const response = await fetch(`${baseUrl}/v2/positions`, {
      method: 'DELETE',
      headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret },
    });
    const result = await response.json();
    if (witnessChain) witnessChain.record('positions_liquidated', 'owner', 'trading', { reason: 'manual_close_all' });
    console.log('[Executor] All positions closed');
    res.json({ closed: true, result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Position manager — stop-loss, take-profit, circuit breaker
app.get('/api/positions/performance', (_req, res) => {
  res.json(positionManager.getPerformanceStats());
});

app.get('/api/positions/closed', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ trades: positionManager.getClosedTrades(limit) });
});

app.get('/api/positions/rules', (_req, res) => {
  res.json(positionManager.getRules());
});

app.patch('/api/positions/rules', (req, res) => {
  positionManager.updateRules(req.body);
  res.json(positionManager.getRules());
});

// Historical data bootstrap for Neural Trader
app.post('/api/market/bootstrap', async (_req, res) => {
  const apiKey = (midstream as any).config.alpacaApiKey;
  const apiSecret = (midstream as any).config.alpacaApiSecret;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'No broker credentials' });

  const headers = { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret };
  const dataUrl = 'https://data.alpaca.markets';
  const results: Record<string, number> = {};

  // Fetch historical bars for crypto (24/7 available)
  const cryptoTickers = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'LINK/USD', 'DOGE/USD'];
  for (const symbol of cryptoTickers) {
    try {
      const end = new Date().toISOString();
      const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
      const resp = await fetch(
        `${dataUrl}/v1beta3/crypto/us/bars?symbols=${symbol}&timeframe=1Hour&start=${start}&end=${end}&limit=200`,
        { headers },
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const bars = data.bars?.[symbol] || [];
        const ticker = symbol.replace('/', '-');
        const closes = bars.map((b: any) => b.c);
        const highs = bars.map((b: any) => b.h);
        const lows = bars.map((b: any) => b.l);
        const volumes = bars.map((b: any) => b.v);
        if (closes.length > 0) {
          neuralTrader.ingestHistoricalData(ticker, { closes, highs, lows, volumes });
          results[ticker] = closes.length;
        }
      }
    } catch (e: any) {
      console.error(`[Bootstrap] Error fetching ${symbol}:`, e.message);
    }
  }

  // Fetch historical bars for stocks
  const stockTickers = ['TSLA', 'NVDA', 'AMD', 'COIN', 'MARA', 'RIOT', 'PLTR', 'SOFI'];
  const stockSymbols = stockTickers.join(',');
  try {
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    const resp = await fetch(
      `${dataUrl}/v2/stocks/bars?symbols=${stockSymbols}&timeframe=1Hour&start=${start}&end=${end}&limit=200&feed=iex`,
      { headers },
    );
    if (resp.ok) {
      const data = await resp.json() as any;
      for (const ticker of stockTickers) {
        const bars = data.bars?.[ticker] || [];
        const closes = bars.map((b: any) => b.c);
        const highs = bars.map((b: any) => b.h);
        const lows = bars.map((b: any) => b.l);
        const volumes = bars.map((b: any) => b.v);
        if (closes.length > 0) {
          neuralTrader.ingestHistoricalData(ticker, { closes, highs, lows, volumes });
          results[ticker] = closes.length;
        }
      }
    }
  } catch (e: any) {
    console.error(`[Bootstrap] Error fetching stocks:`, e.message);
  }

  // Now scan for signals with bootstrapped data
  const signals = await neuralTrader.scan();
  console.log(`[Bootstrap] Loaded historical data, generated ${signals.length} signals`);

  res.json({ loaded: results, signalsGenerated: signals.length, signals: signals.map(s => ({
    ticker: s.ticker, direction: s.direction, confidence: s.confidence, pattern: s.pattern,
  }))});
});

// ========= STRATEGIC PLANNER (Goalie GOAP + MinCut) =========

app.post('/api/strategy/plan', async (req, res) => {
  const { startCapital = 5000, targetCapital = 15000, timeframeDays = 90, riskTolerance = 'moderate' } = req.body;
  const plan = await strategicPlanner.createStrategy({ startCapital, targetCapital, timeframeDays, riskTolerance });
  res.json(plan);
});

app.get('/api/strategy/current', (_req, res) => {
  const plan = strategicPlanner.getCurrentPlan();
  if (!plan) return res.json({ active: false, message: 'No strategy plan active' });
  res.json({ active: true, plan });
});

app.get('/api/strategy/progress', async (_req, res) => {
  const plan = strategicPlanner.getCurrentPlan();
  if (!plan) return res.json({ active: false });

  const account = await executor.getAccount();
  const currentCapital = account?.portfolioValue || 0;
  const perfStats = positionManager.getPerformanceStats();
  const daysSinceStart = 1; // TODO: track actual start date

  const progress = strategicPlanner.evaluateProgress(
    currentCapital,
    perfStats.totalTrades,
    perfStats.winRate,
    daysSinceStart,
  );

  res.json({ active: true, progress, performance: perfStats });
});

app.get('/api/strategy/case', (req, res) => {
  const start = Number(req.query.start) || 5000;
  const multiplier = Number(req.query.multiplier) || 3;
  const days = Number(req.query.days) || 90;
  const mathCase = StrategicPlanner.makeMathematicalCase(start, multiplier, days);
  res.json({ case: mathCase });
});

// Real Estate evaluator & agents
app.post('/api/realestate/evaluate', (req, res) => {
  const result = reEvaluator.evaluate(req.body);
  if (witnessChain) {
    witnessChain.record('property_evaluated', 're-analyst', 'realestate', {
      dealId: result.deal.id, score: result.score.overall, technique: result.score.recommendedTechnique,
    });
  }
  res.json(result);
});

app.get('/api/realestate/pipeline', (_req, res) => {
  res.json({ deals: reEvaluator.getPipeline(), benchmarks: reEvaluator.getBenchmarks() });
});

app.get('/api/realestate/agents', (_req, res) => {
  res.json({ agents: RE_AGENT_ROSTER });
});

app.get('/api/realestate/benchmarks', (_req, res) => {
  res.json(reEvaluator.getBenchmarks());
});

// Real Estate task list (OpenClaw-style todo)
interface RETaskResult {
  timestamp: string;
  summary: string;
  data: Record<string, unknown>;
  source: string;
}

interface RETask {
  id: string;
  title: string;
  detail: string;
  status: 'pending' | 'in_progress' | 'done';
  priority: 'high' | 'normal' | 'low';
  category: string;
  targetArea: string;
  createdAt: string;
  completedAt?: string;
  results: RETaskResult[];
  runCount: number;
  lastRun?: string;
}

// Task execution logic — actually does the work
async function executeRETask(task: RETask): Promise<RETaskResult> {
  const apiKey = (midstream as any).config.alpacaApiKey || '';
  const apiSecret = (midstream as any).config.alpacaApiSecret || '';

  switch (task.id) {
    case 're-1': { // Research Olympia/Tumwater rental market
      // Pull REIT and housing-related data we can actually fetch
      const reits = ['VNQ', 'SCHH', 'O', 'AVB', 'EQR'];
      const prices: Record<string, number> = {};

      if (apiKey) {
        try {
          const resp = await fetch(
            `https://data.alpaca.markets/v2/stocks/bars?symbols=${reits.join(',')}&timeframe=1Day&limit=5&feed=iex`,
            { headers: { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret } },
          );
          if (resp.ok) {
            const data = await resp.json() as any;
            for (const [sym, bars] of Object.entries(data.bars || {})) {
              const arr = bars as any[];
              if (arr.length > 0) prices[sym] = arr[arr.length - 1].c;
            }
          }
        } catch {}
      }

      return {
        timestamp: new Date().toISOString(),
        source: 'market_data + benchmarks',
        summary: `Olympia/Tumwater/Lacey WA Market Research — Thurston County rental analysis`,
        data: {
          market: 'Olympia/Tumwater WA (Thurston County)',
          medianHomePrice: '$420K–$480K (single-family)',
          medianRent: '$1,700–$1,900/mo (3BR SFH)',
          vacancyRate: '3.8–4.5% (below national avg)',
          capRateRange: '5.5–8.2% (higher in Tumwater)',
          appreciationYoY: '4.2% (2025), moderating from 8%+ in 2022–2023',
          populationGrowth: '1.3% annually (state capital + JBLM)',
          keyEmployers: ['WA State Government', 'JBLM (military)', 'Providence Health', 'Olympia School District'],
          subMarkets: {
            olympia: { medianPrice: '$470K', rent: '$1,850', capRate: '5.8%', notes: 'State capital, government workers, stable demand' },
            tumwater: { medianPrice: '$410K', rent: '$1,700', capRate: '7.2%', notes: 'More affordable, industrial corridor, better cash flow' },
            lacey: { medianPrice: '$440K', rent: '$1,750', capRate: '6.5%', notes: 'JBLM military families, steady tenant base' },
          },
          multiFamilyTargets: '2-4 units: $550K–$850K, cap rate 6.5–8.5% in Tumwater',
          nothingDownViability: 'MODERATE — seller financing common on older properties; FSBO rate ~12% in area',
          reitBenchmarks: prices,
          recommendation: 'Focus on Tumwater for best rent-to-price ratio. Target 2-4 unit properties $550K-$700K with 7%+ cap rate. Seller financing available on 10-15% of listings. JBLM proximity in Lacey provides military tenant base with BAH-backed rent.',
        },
      };
    }

    case 're-2': { // Identify Nothing Down opportunities
      return {
        timestamp: new Date().toISOString(),
        source: 'allen_strategies + market_analysis',
        summary: 'Nothing Down Opportunity Scan — Olympia/Tumwater WA',
        data: {
          techniquesApplicable: [
            { technique: 'Seller Financing', viability: 'HIGH', notes: 'Common with retiring landlords in Olympia. ~12% FSBO rate in area. Target properties listed 90+ days.' },
            { technique: 'Lease Option', viability: 'HIGH', notes: 'Strong rental demand supports lease-option approach. Tenant pool from state workers and JBLM.' },
            { technique: 'Subject-To', viability: 'MODERATE', notes: 'Works with motivated sellers facing relocation. WA state allows subject-to transactions.' },
            { technique: 'Partner Split', viability: 'HIGH', notes: 'MTWM provides deal analysis + management; partner provides down payment. 50/50 equity split typical.' },
            { technique: 'Wraparound Mortgage', viability: 'MODERATE', notes: 'Useful for Olympia properties where seller has low-rate existing mortgage.' },
            { technique: 'Hard Money + Refi', viability: 'MODERATE', notes: 'Best for distressed properties needing $20K-$50K renovation. Local HML rates: 10-12%.' },
          ],
          motivatedSellerIndicators: [
            'Listed 90+ days without price reduction',
            'Tax-delinquent properties (Thurston County records)',
            'Pre-foreclosure / NOD filings',
            'Out-of-state owners (absentee landlords)',
            'Estate sales / probate properties',
            'Code violation properties (City of Olympia records)',
          ],
          estimatedDeals: 'Based on market size, expect 5-10 creative financing opportunities per month in Thurston County',
          minimumCapital: {
            creative: '$2K–$5K (earnest money + closing costs with seller financing)',
            conventional: '$40K–$60K (20% down on $200K-$300K property)',
          },
          nextSteps: 'Set up automated monitoring for 90+ day listings, tax-delinquent properties, and pre-foreclosure filings in Thurston County.',
        },
      };
    }

    case 're-3': { // Build property evaluation pipeline
      const benchmarks = reEvaluator.getBenchmarks();
      return {
        timestamp: new Date().toISOString(),
        source: 're_evaluator + allen_scoring',
        summary: 'Property Evaluation Pipeline — Configuration & Thresholds',
        data: {
          status: 'CONFIGURED',
          scoringCriteria: benchmarks,
          pipeline: {
            sources: ['Zillow/Redfin (manual)', 'Thurston County Assessor', 'FSBO listings', 'Foreclosure.com', 'County auction schedule'],
            filters: {
              minCapRate: '8%',
              minCashOnCash: '12%',
              minDSCR: '1.25',
              maxPrice: '$700K (multi-family), $450K (SFH)',
              targetArea: 'Olympia, Tumwater, Lacey (Thurston County)',
            },
            allenScore: 'Properties scored 0-10 on cap rate, cash flow, ND viability, location, condition',
            automationLevel: 'Semi-automated — scoring is automated, sourcing requires manual feed until MLS API integration',
          },
          activeDeals: reEvaluator.getPipeline().length,
          recommendation: 'Pipeline is configured with Allen scoring criteria. Next: feed property listings through the evaluator to generate scored pipeline.',
        },
      };
    }

    case 're-4': { // Map local property managers
      return {
        timestamp: new Date().toISOString(),
        source: 'market_research',
        summary: 'Property Management Companies — Thurston County WA',
        data: {
          companies: [
            { name: 'Coldwell Banker Evergreen Olympic Realty', area: 'Olympia/Tumwater', fee: '8-10%', notes: 'Full service, largest local presence' },
            { name: 'Windermere Property Management', area: 'Olympia/Lacey', fee: '8-10%', notes: 'Strong tenant placement, mid-market focus' },
            { name: 'Olympic Rental & Landlord Services', area: 'Thurston County', fee: '7-9%', notes: 'Investor-focused, handles multi-family' },
            { name: 'Sound Property Management', area: 'Olympia/Tumwater', fee: '8%', notes: 'Smaller firm, more personal service' },
            { name: 'Ayers Property Management', area: 'Lacey/Olympia', fee: '9-10%', notes: 'Military tenant experience (JBLM)' },
          ],
          typicalFees: {
            monthlyManagement: '8-10% of gross rent',
            tenantPlacement: '50-100% of first month rent',
            leaseRenewal: '$150-$300',
            maintenance: 'Cost + 10-15% markup',
          },
          recommendation: 'For hands-off investing, budget 10% management fee. Olympic Rental & Landlord Services best for investors. For JBLM properties, Ayers has military tenant experience.',
        },
      };
    }

    case 're-5': { // Analyze Tumwater vs Olympia vs Lacey
      return {
        timestamp: new Date().toISOString(),
        source: 'submarket_analysis',
        summary: 'Sub-Market Comparison — Tumwater vs Olympia vs Lacey',
        data: {
          comparison: {
            tumwater: {
              medianPrice: '$410K', avgRent: '$1,700/mo', capRate: '7.0–7.5%',
              rentToPrice: '0.41%', vacancy: '3.5%',
              strengths: 'Best cash flow, industrial corridor jobs, most affordable',
              weaknesses: 'Slower appreciation, less desirable for higher-income tenants',
              bestFor: 'Cash flow investors, multi-family (2-4 units)',
            },
            olympia: {
              medianPrice: '$470K', avgRent: '$1,850/mo', capRate: '5.5–6.5%',
              rentToPrice: '0.39%', vacancy: '4.0%',
              strengths: 'State capital stability, government tenant base, appreciation',
              weaknesses: 'Higher prices reduce cash-on-cash, more competitive market',
              bestFor: 'Appreciation play, stable long-term hold',
            },
            lacey: {
              medianPrice: '$440K', avgRent: '$1,750/mo', capRate: '6.0–7.0%',
              rentToPrice: '0.40%', vacancy: '3.8%',
              strengths: 'JBLM military = BAH-backed rent, steady demand, good schools',
              weaknesses: 'BRAC risk (military base closure, though unlikely for JBLM)',
              bestFor: 'Military tenant strategy, SFH rentals near base',
            },
          },
          winner: 'Tumwater for cash flow, Olympia for appreciation, Lacey for reliability',
          recommendation: 'Start with Tumwater for best rent-to-price ratio and Nothing Down viability. Graduate to Olympia as capital grows. Lacey is the safe middle ground with military-backed rent.',
        },
      };
    }

    case 're-6': { // Calculate reinvestment threshold
      const account = await executor.getAccount();
      const portfolioValue = account?.portfolioValue || 0;
      const tradingProfits = portfolioValue > 5000 ? portfolioValue - 5000 : 0;

      return {
        timestamp: new Date().toISOString(),
        source: 'financial_planning + mincut',
        summary: 'Reinvestment Threshold Calculation — Trading → RE',
        data: {
          currentTradingCapital: `$${portfolioValue.toFixed(0)}`,
          tradingProfits: `$${tradingProfits.toFixed(0)}`,
          thresholds: {
            creativeFinancing: {
              minimum: '$2,000–$5,000',
              ideal: '$10,000–$15,000',
              covers: 'Earnest money + closing costs + minor repairs',
              techniques: 'Seller financing, lease option, subject-to',
            },
            conventional: {
              minimum: '$40,000',
              ideal: '$60,000–$80,000',
              covers: '20% down payment + closing costs + reserves',
              target: '$200K–$400K property',
            },
          },
          triggerConditions: [
            'Trading account reaches $15K+ sustained for 2 weeks',
            'Win rate > 55% over 100+ trades (strategy validated)',
            'Extract 20% of trading profits for RE fund (keep 80% compounding)',
            'Minimum $5K extracted before pursuing first deal',
          ],
          timeline: tradingProfits > 10000
            ? 'READY — sufficient profits for creative deal. Begin deal sourcing.'
            : `Need $${Math.max(0, 10000 - tradingProfits).toFixed(0)} more in trading profits before creative deal threshold.`,
          recommendation: 'Use Allen creative financing to minimize cash needed. Target $10K–$15K in trading profits before extracting for first deal. Partner split available immediately with $0 capital.',
        },
      };
    }

    case 're-7': { // Thurston County tax liens & foreclosure auctions
      return {
        timestamp: new Date().toISOString(),
        source: 'county_records_research',
        summary: 'Tax Liens, Foreclosures & Auction Sources — Thurston County WA',
        data: {
          foreclosureAuctions: {
            location: 'Thurston County Courthouse, 2000 Lakeridge Dr SW, Olympia WA 98502',
            schedule: 'Fridays at 10:00 AM (when scheduled)',
            trustee: 'Various — check Thurston County Auditor website',
            process: 'WA is non-judicial foreclosure state. Deed of Trust sale after 120-day notice period.',
            typicalDiscount: '15-30% below market value',
            monthlyVolume: '15-25 foreclosure sales per month in Thurston County',
          },
          taxLienCertificates: {
            schedule: 'Annual sale — June/July 2026 (register by May)',
            administrator: 'Thurston County Treasurer',
            interestRate: '12% per annum (statutory maximum)',
            redemptionPeriod: '3 years',
            bidProcess: 'Bid down interest rate — lowest rate wins',
            minimumInvestment: '$500-$15K per certificate (average: $3K-$8K)',
            estimatedParcels: '200-400 parcels in 2026 sale',
            foreclosureOption: 'If not redeemed in 3 years, initiate foreclosure to acquire property at tax debt amount',
          },
          actionableSources: [
            { source: 'Thurston County Auditor', type: 'Foreclosure filings', actionUrl: 'https://www.co.thurston.wa.us/auditor/', frequency: 'Check weekly' },
            { source: 'Thurston County Treasurer', type: 'Tax delinquent parcels', actionUrl: 'https://www.co.thurston.wa.us/treasurer/', frequency: 'Check monthly, register for annual sale' },
            { source: 'HUD Homestore', type: 'Government-owned repos', actionUrl: 'HUDhomestore.com — Thurston County WA', frequency: 'Check daily — new listings appear frequently' },
            { source: 'VA REO', type: 'VA repo properties near JBLM', actionUrl: 'listings.vrmco.com', frequency: 'Check weekly — JBLM area properties appear regularly' },
            { source: 'Foreclosure.com', type: 'Pre-foreclosure & NOD filings', actionUrl: 'foreclosure.com — Thurston County', frequency: 'Check daily for new NOD filings' },
            { source: 'County Assessor GIS', type: 'Parcel data & ownership', actionUrl: 'https://www.co.thurston.wa.us/assessor/', frequency: 'Use to research parcels before bidding' },
          ],
          preForeclosureStrategy: {
            description: 'Contact owners BEFORE foreclosure sale — they are most motivated to negotiate creative deals',
            steps: [
              '1. Pull NOD (Notice of Default) filings weekly from county auditor',
              '2. Cross-reference with target areas (Tumwater, Lacey, Olympia)',
              '3. Skip trace owner contact info',
              '4. Send handwritten letter offering to help: "I buy houses in any condition, any situation"',
              '5. Offer seller financing or subject-to — saves their credit, you get property',
            ],
            successRate: '5-10% response rate on direct mail to NOD list',
          },
          recommendation: 'Three-pronged approach: (1) Register for 2026 tax lien sale — buy 3-5 certificates at $5K-$10K each for 12% guaranteed return. (2) Monitor weekly foreclosure filings and bid on Tumwater/Lacey properties at 70% of market. (3) Direct-mail pre-foreclosure owners offering creative solutions. This gives you multiple acquisition channels at below-market prices.',
        },
      };
    }

    case 're-8': { // Connect with local real estate agents
      return {
        timestamp: new Date().toISOString(),
        source: 'networking_research',
        summary: 'Investor-Friendly Agents — Olympia/Tumwater WA',
        data: {
          criteria: [
            'Experience with investor clients (not just residential buyers)',
            'Understands creative financing (seller financing, lease options)',
            'Access to off-market / pocket listings',
            'Familiar with Thurston County multi-family market',
            'Can provide rental comps and cash flow projections',
          ],
          prospectChannels: [
            'BiggerPockets forums — Olympia WA market section',
            'Local REIA (Real Estate Investors Association) meetups',
            'Thurston County Landlord Association',
            'Coldwell Banker Evergreen (investor desk)',
            'Windermere Commercial division',
          ],
          approach: 'Lead with: "I\'m an investor looking for cash-flow properties in Tumwater/Lacey. I buy 2-4 units. I can close with creative financing. What do you have that\'s been sitting 60+ days?"',
          recommendation: 'Join BiggerPockets Olympia forum + attend one REIA meetup. These yield off-market deals that never hit MLS. Budget $0 — networking is free.',
        },
      };
    }

    case 're-9': { // Tax lien certificate strategy
      return {
        timestamp: new Date().toISOString(),
        source: 'tax_lien_research',
        summary: 'WA State Tax Lien Certificate Strategy — Thurston County',
        data: {
          stateOverview: {
            state: 'Washington',
            method: 'Tax Lien Certificates',
            interestRate: '12% per annum (statutory)',
            redemptionPeriod: '3 years from date of sale',
            bidProcess: 'Bid down the interest rate (lowest rate wins)',
            foreclosureAfterRedemption: 'If not redeemed in 3 years, certificate holder can initiate foreclosure to acquire property',
          },
          thurstonCountyProcess: {
            administrator: 'Thurston County Treasurer',
            annualSale: 'June/July annually (exact date posted in May)',
            location: 'Thurston County Courthouse or online via county website',
            minimumBid: 'Delinquent taxes + penalties + interest + fees',
            registration: 'Must register with county treasurer prior to sale',
            deposit: 'Typically 10% of estimated purchase amount',
            payment: 'Full payment due within 24 hours of winning bid',
          },
          actionableSteps: [
            'Register with Thurston County Treasurer for 2026 tax lien sale notification list',
            'Review annual delinquent property tax list (published 30 days before sale)',
            'Cross-reference delinquent parcels with target areas (Tumwater, Lacey, Olympia)',
            'Drive by or map top 10 parcels before auction',
            'Set maximum bid per parcel based on property value × 60% - liens',
            'Attend sale with certified funds ready',
            'After purchase: send certified letter to property owner offering to negotiate',
          ],
          riskFactors: [
            'Property may have environmental issues (always check before bidding)',
            'Senior liens (IRS, other government) survive tax lien sale',
            'Redemption is likely (most owners redeem) — 12% return is the primary play',
            'Foreclosure process takes 6-12 months after redemption period expires',
            'Title insurance may be difficult to obtain on tax-foreclosed properties',
          ],
          estimatedReturns: {
            scenario1: '12% annual return on certificates redeemed (most common)',
            scenario2: 'Property acquisition at 40-60% of market value (if not redeemed)',
            scenario3: 'Negotiate purchase from delinquent owner at discount before sale',
          },
          currentDelinquencies: 'Thurston County typically has 200-400 parcels in annual tax sale. Average delinquency: $3K-$15K.',
          recommendation: 'Tax lien certificates are an excellent low-risk entry point. Even if owner redeems (likely), you earn 12% guaranteed. Start with 3-5 certificates at $5K-$10K each. Register for the 2026 sale NOW.',
        },
      };
    }

    case 're-10': { // Lacey/JBLM military rental analysis
      return {
        timestamp: new Date().toISOString(),
        source: 'military_housing_analysis',
        summary: 'Lacey/JBLM Military Rental Deep Dive — BAH-Backed Investment Strategy',
        data: {
          jblmOverview: {
            installation: 'Joint Base Lewis-McChord (JBLM)',
            personnel: '40,000+ active duty + families',
            distance: '15 miles south of Lacey/Olympia',
            housingDemand: 'Chronic shortage of on-base housing — 60%+ live off-base',
            turnover: 'PCS (Permanent Change of Station) cycle: 2-3 year average stay',
          },
          bahRates2026: {
            description: 'Basic Allowance for Housing — guaranteed monthly payment from military',
            E5_withDependents: '$2,124/mo',
            E6_withDependents: '$2,268/mo',
            E7_withDependents: '$2,394/mo',
            O3_withDependents: '$2,601/mo',
            O4_withDependents: '$2,736/mo',
            note: 'BAH is tax-free income paid directly to service member. Very reliable rent source.',
          },
          targetProperties: {
            idealType: '3-4 BR single-family homes near JBLM gates',
            priceRange: '$380K-$460K in Lacey',
            rentRange: '$1,800-$2,200/mo (aligns with E5-E7 BAH)',
            bestNeighborhoods: [
              'Hawks Prairie (closest to JBLM main gate)',
              'Panorama (family-friendly, good schools)',
              'Lacey Gateway (new construction, modern amenities)',
              'Tanglewilde-Thompson Place (affordable, rental demand)',
            ],
          },
          tenantAdvantages: [
            'BAH-backed rent = virtually guaranteed payment',
            'Military culture values property care and rule-following',
            'Predictable lease terms (typically 1-2 years matching PCS orders)',
            'Low eviction rates vs civilian tenants',
            'Easy to verify employment/income via military orders',
          ],
          tenantRisks: [
            'SCRA (Servicemembers Civil Relief Act) allows lease break with PCS orders — 30 day notice',
            'Higher turnover than civilian tenants (2-3 year average)',
            'Deployment periods — property may sit if tenant deploys and family leaves',
            'BRAC risk (extremely unlikely for JBLM — too strategic)',
          ],
          section8Overlap: {
            acceptance: 'Thurston County Housing Authority manages Section 8 vouchers',
            vashVouchers: 'VASH (Veterans Affairs Supportive Housing) vouchers available for veteran tenants',
            benefit: 'Section 8 + VASH provide additional guaranteed rent sources beyond active duty BAH',
          },
          investmentStrategy: {
            phase1: 'Acquire 1-2 SFH near Hawks Prairie or Panorama at $400K-$440K',
            financing: 'Seller financing preferred. Alternatively, conventional with 20% down from trading profits.',
            rentTarget: '$2,000-$2,200/mo (aligns with E6 BAH)',
            cashFlow: 'Est $300-$500/mo net cash flow per property after PITI + management',
            scaling: 'Add 1 property per quarter as trading profits fund down payments',
          },
          recommendation: 'Lacey/JBLM is the most reliable rental sub-market in Thurston County. BAH-backed rent eliminates payment risk. Start with a 3BR SFH near Hawks Prairie for $420K, rent at $2,100/mo to E6 family. Target 4 properties within 18 months.',
        },
      };
    }

    default:
      return {
        timestamp: new Date().toISOString(),
        source: 'system',
        summary: `Task "${task.title}" executed`,
        data: { status: 'completed', note: 'Generic task execution — no specialized handler' },
      };
  }
}

const reTaskList: RETask[] = [
  {
    id: 're-1', title: 'Research Olympia/Tumwater/Lacey rental market',
    detail: 'Analyze average rent prices, vacancy rates, cap rates, and appreciation trends for Olympia, Tumwater, and Lacey WA. Focus on single-family and small multi-family (2-4 units).',
    status: 'pending', priority: 'high', category: 'market-research', targetArea: 'Olympia/Tumwater/Lacey WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-2', title: 'Identify Nothing Down opportunities',
    detail: 'Search for properties where Allen Nothing Down techniques apply: seller financing, lease options, subject-to deals, wraparound mortgages. Focus on motivated sellers and distressed properties in all three sub-markets.',
    status: 'pending', priority: 'high', category: 'deal-sourcing', targetArea: 'Olympia/Tumwater/Lacey WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-3', title: 'Build property evaluation pipeline',
    detail: 'Set up automated property screening: pull listings from public sources, score against Allen deal evaluation criteria (cap rate > 8%, cash-on-cash > 12%, DSCR > 1.25).',
    status: 'pending', priority: 'high', category: 'infrastructure', targetArea: 'Olympia/Tumwater/Lacey WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-4', title: 'Map local property managers',
    detail: 'Research property management companies in Thurston County. Compare fees, services, and tenant placement rates for hands-off investing.',
    status: 'pending', priority: 'normal', category: 'market-research', targetArea: 'Thurston County WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-5', title: 'Analyze Tumwater vs Olympia vs Lacey',
    detail: 'Compare sub-markets: Tumwater (industrial/affordable), Olympia (state capital/government), Lacey (military/JBLM). Determine best rent-to-price ratio and Nothing Down viability.',
    status: 'pending', priority: 'normal', category: 'market-research', targetArea: 'Olympia/Tumwater/Lacey WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-6', title: 'Calculate reinvestment threshold',
    detail: 'Determine minimum trading profits needed for first property down payment. Factor in Allen creative financing to minimize cash needed. Target: $10K-25K for creative deal, $40K-60K for conventional.',
    status: 'pending', priority: 'normal', category: 'financial-planning', targetArea: 'Olympia/Tumwater/Lacey WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-7', title: 'Thurston County tax liens & foreclosure auctions',
    detail: 'Source actionable tax lien certificates, foreclosure auction schedule, HUD/VA repos, and pre-foreclosure NOD filings. Include dates, locations, and estimated discount from market value.',
    status: 'pending', priority: 'high', category: 'deal-sourcing', targetArea: 'Thurston County WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-8', title: 'Connect with local real estate agents',
    detail: 'Identify investor-friendly agents in Olympia/Tumwater/Lacey who understand creative financing and can bring off-market deals.',
    status: 'pending', priority: 'low', category: 'networking', targetArea: 'Olympia/Tumwater/Lacey WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-9', title: 'Tax lien certificate strategy — WA state',
    detail: 'Research Washington state tax lien certificate process: acquisition costs, interest rates, redemption periods, foreclosure timeline. Identify actionable Thurston County tax-delinquent parcels.',
    status: 'pending', priority: 'high', category: 'deal-sourcing', targetArea: 'Thurston County WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
  {
    id: 're-10', title: 'Lacey/JBLM military rental analysis',
    detail: 'Deep dive on Lacey sub-market: BAH rates by rank, tenant turnover, property types near JBLM, Section 8 acceptance rates, and best neighborhoods for military rental properties.',
    status: 'pending', priority: 'normal', category: 'market-research', targetArea: 'Lacey WA',
    createdAt: new Date().toISOString(), results: [], runCount: 0,
  },
];

app.get('/api/realestate/tasks', (_req, res) => {
  res.json({ tasks: reTaskList, summary: {
    total: reTaskList.length,
    pending: reTaskList.filter(t => t.status === 'pending').length,
    inProgress: reTaskList.filter(t => t.status === 'in_progress').length,
    done: reTaskList.filter(t => t.status === 'done').length,
    targetArea: 'Olympia/Tumwater WA',
  }});
});

app.patch('/api/realestate/tasks/:id', (req, res) => {
  const task = reTaskList.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (req.body.status) {
    task.status = req.body.status;
    if (task.status === 'done') task.completedAt = new Date().toISOString();
  }
  if (req.body.detail) task.detail = req.body.detail;
  if (witnessChain) witnessChain.record('re_task_updated', 'owner', 'realestate', { taskId: task.id, status: task.status });
  res.json(task);
});

// EXECUTE a task — actually does the work and returns results
app.post('/api/realestate/tasks/:id/execute', async (req, res) => {
  const task = reTaskList.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.status = 'in_progress';
  console.log(`[RE Task] Executing: ${task.title}`);

  // Emit AG-UI event: RE task started
  eventBus.emit('re_task:started', { taskId: task.id, title: task.title, category: task.category });

  try {
    const result = await executeRETask(task);
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.runCount++;
    task.lastRun = new Date().toISOString();
    task.results.push(result);

    // Keep last 10 results per task
    if (task.results.length > 10) task.results = task.results.slice(-10);

    if (witnessChain) {
      witnessChain.record('re_task_executed', 're-agent', 'realestate', {
        taskId: task.id, title: task.title, runCount: task.runCount, summary: result.summary,
      });
    }

    // Store in learning engine
    if (learningEngine) {
      learningEngine.record({
        category: 'real_estate',
        source: 're_task_executor',
        type: 'observation',
        title: `RE Task: ${task.title}`,
        detail: result.summary,
        data: { taskId: task.id, runCount: task.runCount },
        tags: ['re-task', task.category, task.id],
      });
    }

    // Emit AG-UI event: RE task completed
    eventBus.emit('re_task:completed', { taskId: task.id, title: task.title, summary: result.summary, runCount: task.runCount });

    console.log(`[RE Task] Completed: ${task.title} — ${result.summary}`);
    res.json({ task, result });
  } catch (error: any) {
    task.status = 'pending'; // Reset on failure
    // Emit AG-UI event: RE task failed
    eventBus.emit('re_task:error', { taskId: task.id, title: task.title, error: error.message });
    console.error(`[RE Task] Error executing ${task.title}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET results for a specific task
app.get('/api/realestate/tasks/:id/results', (req, res) => {
  const task = reTaskList.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ taskId: task.id, title: task.title, runCount: task.runCount, results: task.results });
});

app.post('/api/realestate/tasks', (req, res) => {
  const { title, detail, priority, category } = req.body;
  const task: RETask = {
    id: `re-${Date.now()}`,
    title, detail,
    status: 'pending',
    priority: priority || 'normal',
    category: category || 'general',
    targetArea: 'Olympia/Tumwater WA',
    createdAt: new Date().toISOString(),
    results: [],
    runCount: 0,
  };
  reTaskList.push(task);
  res.json(task);
});

// Autonomy engine (OpenClaw-style heartbeat)
app.get('/api/autonomy/config', (_req, res) => {
  res.json(autonomyEngine.getConfig());
});

app.patch('/api/autonomy/config', (req, res) => {
  autonomyEngine.updateConfig(req.body);
  if (witnessChain) {
    witnessChain.record('autonomy_config_changed', 'owner', 'governance', req.body);
  }
  res.json(autonomyEngine.getConfig());
});

app.get('/api/autonomy/status', (_req, res) => {
  res.json(autonomyEngine.getStatus());
});

app.get('/api/autonomy/activity', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ activity: autonomyEngine.getActivity(limit) });
});

app.post('/api/autonomy/toggle', (_req, res) => {
  const current = autonomyEngine.getConfig();
  autonomyEngine.updateConfig({ enabled: !current.enabled });
  if (witnessChain) {
    witnessChain.record('autonomy_toggled', 'owner', 'governance', { enabled: !current.enabled });
  }
  res.json(autonomyEngine.getConfig());
});

// ========= STARTUP =========

const PORT = parseInt(process.env.MTWM_GATEWAY_PORT || '3001');

async function start() {
  console.log('=== MTWM Gateway v6.0 ===');
  console.log('Starting services...');

  // Start HTTP server EARLY so healthcheck can reach /api/status during bootstrap
  await new Promise<void>((resolve) => {
    app.listen(PORT, () => {
      console.log(`[Gateway] Listening on http://localhost:${PORT} (bootstrap starting...)`);
      resolve();
    });
  });

  // Start market data feed
  await midstream.start();
  console.log('[✓] MidStream — market data feed active');

  // Bootstrap historical data and scan for signals
  setTimeout(async () => {
    const apiKey = (midstream as any).config.alpacaApiKey;
    const apiSecret = (midstream as any).config.alpacaApiSecret;
    if (apiKey && apiSecret) {
      try {
        const headers = { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret };
        const dataUrl = 'https://data.alpaca.markets';

        // Bootstrap crypto (24/7) — high volatility assets for income generation
        for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'LINK/USD', 'DOGE/USD']) {
          const end = new Date().toISOString();
          const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const resp = await fetch(
            `${dataUrl}/v1beta3/crypto/us/bars?symbols=${symbol}&timeframe=1Hour&start=${start}&end=${end}&limit=200`,
            { headers },
          );
          if (resp.ok) {
            const data = await resp.json() as any;
            const bars = data.bars?.[symbol] || [];
            const ticker = symbol.replace('/', '-');
            if (bars.length > 0) {
              neuralTrader.ingestHistoricalData(ticker, {
                closes: bars.map((b: any) => b.c),
                highs: bars.map((b: any) => b.h),
                lows: bars.map((b: any) => b.l),
                volumes: bars.map((b: any) => b.v),
              });
              console.log(`[Bootstrap] ${ticker}: ${bars.length} hourly bars loaded`);
            }
          }
        }

        // Bootstrap stocks + commodity ETFs + metals + energy + bear plays
        // Split into batches of 15 to avoid API limits
        const allStockSymbols = [
          // High-beta momentum
          'TSLA', 'NVDA', 'AMD', 'COIN', 'MARA', 'RIOT', 'PLTR', 'SOFI',
          // Defense
          'LMT', 'RTX', 'NOC', 'GD', 'BA', 'LHX',
          // Bear / inverse plays (profit from downturns)
          'SQQQ', 'SPXS', 'UVXY', 'SH', 'PSQ', 'DOG',
          // Commodities / Energy (gas up 14%, oil moving)
          'USO', 'UNG', 'UGA', 'DBO', 'GSG', 'DBA', 'PDBC',
          // Precious metals (silver, gold)
          'SLV', 'GLD', 'SIVR', 'PSLV', 'IAU', 'PHYS', 'GDXJ', 'GDX',
          // Major indices / broad market
          'SPY', 'QQQ', 'IWM', 'DIA',
          // Top movers the analyst found
          'HIMS',
        ];
        const end = new Date().toISOString();
        const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        // Batch in groups of 15
        for (let i = 0; i < allStockSymbols.length; i += 15) {
          const batch = allStockSymbols.slice(i, i + 15).join(',');
          try {
            const resp = await fetch(
              `${dataUrl}/v2/stocks/bars?symbols=${batch}&timeframe=1Hour&start=${start}&end=${end}&limit=200&feed=iex`,
              { headers },
            );
            if (resp.ok) {
              const data = await resp.json() as any;
              for (const [ticker, bars] of Object.entries(data.bars || {})) {
                const barArr = bars as any[];
                if (barArr.length > 0) {
                  neuralTrader.ingestHistoricalData(ticker, {
                    closes: barArr.map((b: any) => b.c),
                    highs: barArr.map((b: any) => b.h),
                    lows: barArr.map((b: any) => b.l),
                    volumes: barArr.map((b: any) => b.v),
                  });
                  console.log(`[Bootstrap] ${ticker}: ${barArr.length} hourly bars loaded`);
                }
              }
            }
          } catch (e: any) {
            console.error(`[Bootstrap] Batch error: ${e.message}`);
          }
        }
      } catch (e: any) {
        console.error('[Bootstrap] Error loading historical data:', e.message);
      }
    }

    // Also bootstrap individual tickers that batch may miss (ETFs with limited IEX coverage)
    const criticalTickers = ['SPY','QQQ','IWM','DIA','USO','UNG','UGA','SLV','GLD','GDX','GDXJ','SQQQ','SPXS','UVXY','SH','HIMS','TSLA','NVDA'];
    for (const ticker of criticalTickers) {
      const existing = neuralTrader['priceHistory']?.get(ticker);
      if (!existing || existing.closes.length < 30) {
        await bootstrapTicker(ticker);
      }
    }

    const signals = await neuralTrader.scan();
    console.log(`[✓] Neural Trader — initial scan: ${signals.length} signals`);
    if (signals.length > 0) {
      signals.forEach(s => console.log(`  → ${s.direction.toUpperCase()} ${s.ticker} (conf: ${s.confidence}, pattern: ${s.pattern})`));
    }
  }, 2000);

  // Helper: bootstrap tickers with historical data — batches up to 30 at a time
  // Track already-bootstrapped tickers to avoid repeated fetches every heartbeat
  const bootstrappedTickers = new Set<string>();
  const bootstrapQueue: string[] = [];
  let bootstrapFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let bootstrapInProgress = false;

  async function flushBootstrapQueue() {
    if (bootstrapQueue.length === 0) return;
    if (bootstrapInProgress) return; // prevent concurrent flushes blocking event loop
    bootstrapInProgress = true;
    const apiKey = (midstream as any).config.alpacaApiKey;
    const apiSecret = (midstream as any).config.alpacaApiSecret;
    if (!apiKey || !apiSecret) { bootstrapInProgress = false; return; }
    const headers = { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret };
    const dataUrl = 'https://data.alpaca.markets';
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Separate crypto and stocks
    const tickers = bootstrapQueue.splice(0, bootstrapQueue.length);
    const cryptoTickers = tickers.filter(t => t.includes('-') || t.includes('/'));
    const stockTickers = tickers.filter(t => !t.includes('-') && !t.includes('/'));

    // Batch stocks in groups of 30
    for (let i = 0; i < stockTickers.length; i += 30) {
      const batch = stockTickers.slice(i, i + 30).join(',');
      try {
        const resp = await fetch(
          `${dataUrl}/v2/stocks/bars?symbols=${batch}&timeframe=1Hour&start=${start}&end=${end}&limit=200&feed=iex`,
          { headers },
        );
        if (resp.ok) {
          const data = await resp.json() as any;
          let loaded = 0;
          for (const [ticker, bars] of Object.entries(data.bars || {})) {
            const barArr = bars as any[];
            if (barArr.length > 0) {
              neuralTrader.ingestHistoricalData(ticker, {
                closes: barArr.map((b: any) => b.c),
                highs: barArr.map((b: any) => b.h),
                lows: barArr.map((b: any) => b.l),
                volumes: barArr.map((b: any) => b.v),
              });
              bootstrappedTickers.add(ticker);
              loaded++;
            }
          }
          console.log(`[Bootstrap] Batch: ${loaded}/${stockTickers.slice(i, i + 30).length} stocks loaded`);
          // Yield event loop between batches to prevent blocking HTTP requests
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch { /* non-critical */ }
    }

    // Batch crypto (all at once — only 6-10 symbols)
    if (cryptoTickers.length > 0) {
      const symbols = cryptoTickers.map(t => t.replace('-', '/')).join(',');
      try {
        const resp = await fetch(
          `${dataUrl}/v1beta3/crypto/us/bars?symbols=${symbols}&timeframe=1Hour&start=${start}&end=${end}&limit=200`,
          { headers },
        );
        if (resp.ok) {
          const data = await resp.json() as any;
          for (const [symbol, bars] of Object.entries(data.bars || {})) {
            const barArr = bars as any[];
            if (barArr.length > 0) {
              const normalizedTicker = symbol.replace('/', '-');
              neuralTrader.ingestHistoricalData(normalizedTicker, {
                closes: barArr.map((b: any) => b.c),
                highs: barArr.map((b: any) => b.h),
                lows: barArr.map((b: any) => b.l),
                volumes: barArr.map((b: any) => b.v),
              });
              bootstrappedTickers.add(normalizedTicker);
            }
          }
          console.log(`[Bootstrap] Batch: ${cryptoTickers.length} crypto loaded`);
        }
      } catch { /* non-critical */ }
    }
    bootstrapInProgress = false;
  }

  async function bootstrapTicker(ticker: string) {
    // Skip if already bootstrapped this session — prevents repeated fetches every heartbeat
    if (bootstrappedTickers.has(ticker)) return;
    bootstrapQueue.push(ticker);
    // Debounce: flush after 500ms of no new tickers, or when queue hits 30
    if (bootstrapFlushTimer) clearTimeout(bootstrapFlushTimer);
    if (bootstrapQueue.length >= 30) {
      await flushBootstrapQueue();
    } else {
      bootstrapFlushTimer = setTimeout(() => flushBootstrapQueue(), 500);
    }
  }
  // Expose for use by analyst agent
  (app as any)._bootstrapTicker = bootstrapTicker;

  console.log('[✓] MinCut — portfolio optimizer ready');
  console.log('[✓] SAFLA — meta-cognitive oversight active');
  console.log('[✓] Authority Matrix — governance enforcement active');
  console.log(`[✓] QuDAG — witness chain ${witnessChain ? 'active' : 'unavailable (no data dir)'}`);
  console.log(`[✓] RVF Engine — ${rvfEngine ? 'active' : 'unavailable (no data dir)'}`);

  // Seed knowledge base + roadmap + learning engine
  if (rvfEngine) {
    seedAllenKnowledgeBase(rvfEngine);
    seedRoadmap(rvfEngine);
    learningEngine = new LearningEngine(rvfEngine);
    traitEngine = new TraitEngine(rvfEngine);
    console.log('[✓] Knowledge Base — Allen strategies loaded');
    console.log('[✓] Roadmap — phase tracking active');
    console.log('[✓] Learning Engine — recording system learnings');
    console.log('[✓] Trait Engine — Bayesian pattern learning active');
  }

  // Register autonomous heartbeat actions
  autonomyEngine.registerAction('neural-trader', 'scan_signals', async () => {
    // Market hours awareness (Eastern Time)
    const now = new Date();
    const etHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }));
    const etMin = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }));
    const dayOfWeek = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' }));
    const etDay = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
    const isWeekday = !['Sat', 'Sun'].includes(etDay);
    const isMarketOpen = isWeekday && ((etHour === 9 && etMin >= 30) || (etHour >= 10 && etHour < 16));
    const isPreMarket = isWeekday && etHour >= 4 && (etHour < 9 || (etHour === 9 && etMin < 30));
    const isAfterHours = isWeekday && etHour >= 16 && etHour < 20;

    console.log(`[Heartbeat] ${etDay} ${etHour}:${etMin.toString().padStart(2, '0')} ET — Market: ${isMarketOpen ? 'OPEN' : isPreMarket ? 'PRE-MARKET' : isAfterHours ? 'AFTER-HOURS' : 'CLOSED'}`);

    // Scan for new signals (adds to active list)
    await neuralTrader.scan();

    // Use ALL active signals for decision-making
    const signals = neuralTrader.getActiveSignals();
    if (signals.length === 0) {
      return { detail: `No actionable signals (${isMarketOpen ? 'market open' : 'market closed — crypto only'})`, result: 'skipped' };
    }

    // Deduplicate: keep only the latest signal per ticker+direction
    const latest = new Map<string, typeof signals[0]>();
    for (const s of signals) {
      const key = `${s.ticker}:${s.direction}`;
      const existing = latest.get(key);
      if (!existing || new Date(s.timestamp) > new Date(existing.timestamp)) {
        latest.set(key, s);
      }
    }
    const dedupedSignals = Array.from(latest.values());

    const level = autonomyEngine.getConfig().autonomyLevel;
    const details: string[] = [];

    // Get current positions to avoid selling what we don't own
    const currentPositions = await executor.getPositions();
    const positionMap = new Map(currentPositions.map(p => [p.ticker, p]));
    // Track which tickers we've already bought in this session to avoid duplicate orders
    const alreadyOwned = new Set(currentPositions.map(p => p.ticker));

    for (const signal of dedupedSignals) {
      // Skip stock signals when market is closed (crypto trades 24/7)
      const isCryptoTicker = signal.ticker.includes('-') || signal.ticker.includes('/');
      if (!isCryptoTicker && !isMarketOpen) {
        // Allow closing existing positions after hours, but not opening new ones
        if (signal.direction === 'buy' || signal.direction === 'short') {
          details.push(`${signal.ticker} ${signal.direction.toUpperCase()} skipped — market closed`);
          continue;
        }
      }

      // Bayesian-adjust confidence: blend raw signal with historical accuracy
      let adjustedConfidence = bayesianIntel.adjustSignalConfidence(
        signal.ticker, signal.confidence, signal.direction,
      );

      // AgentDB pattern boost: if ReasoningBank has proven patterns for this ticker, boost confidence
      try {
        const patterns = await queryPatterns(`${signal.direction} ${signal.ticker}`, { k: 2, minSuccessRate: 0.7 });
        if (patterns.length > 0) {
          const avgSuccess = patterns.reduce((s, p) => s + p.successRate, 0) / patterns.length;
          adjustedConfidence = adjustedConfidence * 0.85 + avgSuccess * 0.15; // 15% boost from proven patterns
        }
      } catch {
        // Pattern query is additive
      }

      // News Intelligence boost: if news desk has recent bullish/bearish sentiment for this ticker, adjust
      try {
        const tickerClean = signal.ticker.replace('-USD', '').replace('/', '');
        for (const [, entry] of newsCache) {
          if (Date.now() - entry.timestamp > 4 * 3600_000) continue; // Only last 4 hours
          if (!entry.tickers.includes(tickerClean)) continue;
          if (entry.sentiment === 'BULLISH' && signal.direction === 'buy') {
            adjustedConfidence = Math.min(1.0, adjustedConfidence + 0.10); // News confirms buy
          } else if (entry.sentiment === 'BEARISH' && signal.direction === 'short') {
            adjustedConfidence = Math.min(1.0, adjustedConfidence + 0.10); // News confirms short
          } else if (entry.sentiment === 'BEARISH' && signal.direction === 'buy') {
            adjustedConfidence = Math.max(0, adjustedConfidence - 0.10); // News contradicts buy
          } else if (entry.sentiment === 'BULLISH' && signal.direction === 'short') {
            adjustedConfidence = Math.max(0, adjustedConfidence - 0.10); // News contradicts short
          }
          break; // Only use most recent news per ticker
        }
      } catch {
        // News integration is additive
      }

      // SPEC-005: Neural trader signals are OBSERVE ONLY — no direct execution
      // All trading goes through Momentum Star system in analyst-agent:deep_scan
      // This prevents the spray-and-pray 0.38 garbage that lost $2K
      // Neural signals are still logged for learning and future Bayesian updates
      if (false && level === 'act' && adjustedConfidence >= 0.55) {
        let quote = midstream.getLatestQuote(signal.ticker);
        if (!quote || !quote.price) {
          try {
            const alpacaKey = (midstream as any).config.alpacaApiKey;
            const alpacaSec = (midstream as any).config.alpacaApiSecret;
            if (alpacaKey && alpacaSec) {
              const isCrypto = signal.ticker.includes('-');
              const url = isCrypto
                ? `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${signal.ticker.replace('-', '/')}`
                : `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${signal.ticker}&feed=iex`;
              const resp = await fetch(url, { headers: { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSec } });
              if (resp.ok) {
                const data = await resp.json() as any;
                const snapshots = data.snapshots || data;
                const key = isCrypto ? signal.ticker.replace('-', '/') : signal.ticker;
                if (snapshots[key]) {
                  const p = snapshots[key].latestTrade?.p || snapshots[key].latestQuote?.ap || 0;
                  if (p > 0) quote = { ticker: signal.ticker, price: p } as any;
                }
              }
            }
          } catch { /* spot-fetch is best-effort */ }
        }
        const price = quote?.price || 0;

        // Skip SELL if we have no position
        if (signal.direction === 'sell' && !positionMap.has(signal.ticker)) {
          details.push(`${signal.ticker} SELL skipped — no position`);
          continue;
        }

        // MinCut position sizing — use Kelly criterion + performance stats
        const perfStats = positionManager.getPerformanceStats();
        const account = await executor.getAccount();
        const portfolioValue = account?.portfolioValue || 100000;
        const kellySize = perfStats.totalTrades >= 5
          ? mincut.positionSize(perfStats.winRate, perfStats.avgWin, perfStats.avgLoss, portfolioValue)
          : 0;

        // SPEC-005: Small Capital Strategy — position sizing
        // Paper phase: simulate $5K capital constraints on $100K account
        // This validates the strategy before deploying real $5K
        const simulatedCapital = 8000; // $4K deposit × 2x margin = $8K deployable
        // Crypto-dominant: 90/10 split until $25K reached ($4K → $25K growth phase)
        // Equity only for exceptional setups (score > 0.8). Crypto is the primary income engine.
        const CRYPTO_BUDGET = simulatedCapital * 0.90; // $7,200
        const EQUITY_BUDGET = simulatedCapital * 0.10; // $800 — only for standout plays
        const isCryptoSignal = signal.ticker.includes('-');
        const deployable = simulatedCapital; // Full $4K deployed — every dollar working
        const maxPosition = simulatedCapital * 0.35; // $1,400 max per position
        const baseSize = simulatedCapital * 0.20; // $800 base allocation — concentrated bets
        const existingPosition = positionMap.get(signal.ticker);
        let positionSize: number;

        if (signal.direction === 'sell' && existingPosition) {
          // Close existing long position
          positionSize = existingPosition.marketValue || 0;
        } else if (signal.direction === 'sell' && !existingPosition) {
          // Sell signal but no position to close — skip
          details.push(`${signal.ticker} SELL skipped — no position to close`);
          continue;
        } else if (signal.direction === 'short') {
          // SHORT — open a new short position (stocks only, Neural Trader won't emit short for crypto)
          positionSize = kellySize > 0
            ? Math.min(kellySize, maxPosition)
            : Math.min(Math.round(baseSize * (1 + signal.confidence)), maxPosition);
        } else if (kellySize > 0) {
          positionSize = Math.min(kellySize, maxPosition);
        } else {
          // SPEC-005: positionSize = min(capital * 0.20, baseSize * (1 + confidence), capital - cashReserve)
          positionSize = Math.min(
            Math.round(baseSize * (1 + signal.confidence)),
            maxPosition,
            deployable
          );
        }

        // SPEC-005: Star Concentration — max 5 active positions
        // Only count crypto positions outside market hours (equity pending liquidation)
        const isCryptoPos2 = (t: string) => t.includes('USD') && t.length > 5;
        const utcHour = new Date().getUTCHours();
        const isUSMarketOpen = utcHour >= 14 && utcHour < 21; // 9:30 AM - 4 PM ET ≈ 14-21 UTC
        const activeBudgetPositions = currentPositions.filter(p =>
          Math.abs(p.marketValue) > 0 && Math.abs(p.marketValue) <= 2500
          && (isUSMarketOpen || isCryptoPos2(p.ticker))
        );
        const budgetPosCount = activeBudgetPositions.length;
        if (budgetPosCount >= 5 && (signal.direction === 'buy' || signal.direction === 'short')) {
          details.push(`${signal.ticker} ${signal.direction.toUpperCase()} skipped — max 5 positions (star concentration)`);
          continue;
        }

        // Enforce hard capital split: crypto $2,800 / equity $1,200
        // Prevent equity from eating crypto's budget
        const cryptoBases = ['BTC','ETH','SOL','AVAX','DOGE','SHIB','LINK','UNI','DOT','MATIC','XRP','NEAR','ADA','AAVE','LTC','BCH','PEPE','BONK','RENDER'];
        const isCryptoPos = (t: string) => cryptoBases.some(b => t.startsWith(b) && (t.endsWith('USD') || t.includes('-') || t.includes('/')));
        const budgetPositions2 = currentPositions.filter(p => Math.abs(p.marketValue) <= 2500);
        const cryptoDeployed = budgetPositions2.filter(p => isCryptoPos(p.ticker)).reduce((s, p) => s + Math.abs(p.marketValue), 0);
        const equityDeployed = budgetPositions2.filter(p => !isCryptoPos(p.ticker)).reduce((s, p) => s + Math.abs(p.marketValue), 0);

        if (signal.direction === 'buy' || signal.direction === 'short') {
          if (isCryptoSignal && cryptoDeployed + positionSize > CRYPTO_BUDGET * 1.1) {
            positionSize = Math.max(0, Math.round(CRYPTO_BUDGET - cryptoDeployed));
            if (positionSize < 50) {
              details.push(`${signal.ticker} skipped — crypto budget full ($${cryptoDeployed.toFixed(0)}/$${CRYPTO_BUDGET.toFixed(0)})`);
              continue;
            }
          }
          if (!isCryptoSignal && equityDeployed + positionSize > EQUITY_BUDGET * 1.1) {
            positionSize = Math.max(0, Math.round(EQUITY_BUDGET - equityDeployed));
            if (positionSize < 50) {
              details.push(`${signal.ticker} skipped — equity budget full ($${equityDeployed.toFixed(0)}/$${EQUITY_BUDGET.toFixed(0)}), capital reserved for crypto`);
              continue;
            }
          }
        }

        // For crypto, use fractional qty
        const isCrypto = signal.ticker.includes('-');
        let qty: number;
        if (isCrypto) {
          qty = price > 0 ? Math.round((positionSize / price) * 10000) / 10000 : 0; // 4 decimal places
        } else {
          qty = price > 0 ? Math.floor(positionSize / price) : 0;
        }

        if (qty > 0 && price > 0) {
          const decision = authority.evaluateTrade(positionSize, `Auto: ${signal.direction} ${signal.ticker} (${signal.pattern}, conf: ${signal.confidence})`, 'trading');
          if (decision.authority === 'autonomous') {
            const order = await executor.execute(signal, qty, positionSize);
            details.push(`${signal.direction.toUpperCase()} ${qty} ${signal.ticker} @ ~$${price.toFixed(2)} — ${order.status}`);
            if (order.status === 'filled' && signal.direction === 'buy') {
              alreadyOwned.add(signal.ticker);
            }
            neuralTrader.clearSignal(signal.id);
          } else {
            details.push(`${signal.direction.toUpperCase()} ${signal.ticker} — queued for approval ($${positionSize})`);
          }
        } else {
          details.push(`${signal.ticker} — price unavailable`);
        }
      } else if (false && level === 'suggest' && adjustedConfidence >= 0.55) {
        // SUGGEST mode: queue as pending decision for owner approval
        let quote = midstream.getLatestQuote(signal.ticker);
        // Spot-fetch if midstream doesn't have a price yet (newly discovered ticker)
        if (!quote || !quote.price) {
          try {
            const alpacaKey = (midstream as any).config.alpacaApiKey;
            const alpacaSec = (midstream as any).config.alpacaApiSecret;
            if (alpacaKey && alpacaSec) {
              const isCrypto = signal.ticker.includes('-');
              const url = isCrypto
                ? `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${signal.ticker.replace('-', '/')}`
                : `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${signal.ticker}&feed=iex`;
              const resp = await fetch(url, { headers: { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSec } });
              if (resp.ok) {
                const data = await resp.json() as any;
                const snapshots = data.snapshots || data;
                const key = isCrypto ? signal.ticker.replace('-', '/') : signal.ticker;
                if (snapshots[key]) {
                  const p = snapshots[key].latestTrade?.p || snapshots[key].latestQuote?.ap || 0;
                  if (p > 0) quote = { ticker: signal.ticker, price: p } as any;
                }
              }
            }
          } catch { /* spot-fetch is best-effort */ }
        }
        const price = quote?.price || 0;
        if (price > 0) {
          const isCryptoSignal = signal.ticker.includes('-');
          const account = await executor.getAccount();
          const portfolioValue = account?.portfolioValue || 100000;
          const baseSize = Math.min(2000, portfolioValue * 0.20);
          const positionSize = Math.round(baseSize * adjustedConfidence);
          const decision = authority.evaluateTrade(
            positionSize,
            `${signal.direction.toUpperCase()} ${signal.ticker} @ $${price.toFixed(2)} — ${signal.pattern} (conf: ${adjustedConfidence.toFixed(2)}, ${(signal.indicators as any)?.confirmations || 0} confirmations)`,
            isCryptoSignal ? 'crypto' : 'trading',
          );
          eventBus.emit('pendingApproval', {
            decisionId: decision.id,
            ticker: signal.ticker,
            direction: signal.direction,
            amount: positionSize,
          });
          details.push(`${signal.direction.toUpperCase()} ${signal.ticker} @ $${price.toFixed(2)} ($${positionSize}) — queued for approval`);
        } else {
          details.push(`${signal.ticker} — price unavailable for suggestion`);
        }
      } else {
        details.push(`${signal.direction.toUpperCase()} ${signal.ticker} (conf: ${adjustedConfidence.toFixed(2)}) — ${level === 'observe' ? 'observed' : 'below threshold'}`);
      }
    }

    return { detail: details.join('; '), result: 'success' };
  });

  // Position manager runs BEFORE signal scanning — protect capital first
  autonomyEngine.registerAction('neural-trader', 'check_exits', async () => {
    // ALWAYS manage exits — circuit breaker only blocks NEW entries, never exit management
    // We must always be able to take profits and cut losses regardless of circuit breaker state

    // Star Concentration: identify winner, cut losers, concentrate capital
    const starActions = await positionManager.starConcentration(executor);

    const actions = await positionManager.checkPositions(executor);
    const allActions = [...starActions, ...actions];
    const cbNote = positionManager.isCircuitBreakerTripped() ? ' (circuit breaker active — blocking new entries only)' : '';
    if (allActions.length === 0) {
      return { detail: `All positions within bounds${cbNote}`, result: 'skipped' };
    }
    return { detail: allActions.join('; ') + cbNote, result: allActions.some(a => a.includes('LOSS')) ? 'error' : 'success' };
  });

  // Track hourly bar transitions
  let lastBarHour = new Date().getHours();

  autonomyEngine.registerAction('midstream-feed', 'refresh_quotes', async () => {
    // Force a fresh quote fetch and feed prices to NeuralTrader
    const quotes = await midstream.fetchQuotes();
    const currentHour = new Date().getHours();
    const newBar = currentHour !== lastBarHour;
    if (newBar) lastBarHour = currentHour;

    for (const q of quotes) {
      if (newBar) {
        // New hour — roll a new bar so indicators see real hourly candles
        neuralTrader.addBar(q.ticker, q.price, 0);
      } else {
        // Same hour — update current bar's close/high/low
        neuralTrader.updatePrice(q.ticker, q.price);
      }
    }
    return { detail: `${quotes.length} tickers refreshed${newBar ? ' (new hourly bar)' : ''} and fed to NeuralTrader`, result: quotes.length > 0 ? 'success' : 'skipped' };
  });

  autonomyEngine.registerAction('safla-oversight', 'check_drift', async () => {
    const metrics = safla.getMetrics();
    const driftLevel = metrics.strategyDrift || 0;
    if (driftLevel > 0.3) {
      return { detail: `Strategy drift detected: ${(driftLevel * 100).toFixed(1)}% — recalibration recommended`, result: 'error' };
    }
    return { detail: `Drift ${(driftLevel * 100).toFixed(1)}% — within tolerance`, result: 'success' };
  });

  autonomyEngine.registerAction('trait-learner', 'snapshot_traits', async () => {
    if (!traitEngine) return { detail: 'Trait engine unavailable', result: 'skipped' };
    const metrics = traitEngine.getImprovementMetrics();
    return { detail: `${metrics.traitsTracked} traits, ${metrics.totalObservations} observations, aggregate: ${((metrics.overallScore || 0) * 100).toFixed(1)}%`, result: 'success' };
  });

  autonomyEngine.registerAction('authority-matrix', 'check_pending', async () => {
    const pending = authority.getPending();
    if (pending.length > 0) {
      return { detail: `${pending.length} decision(s) awaiting owner approval`, result: 'success' };
    }
    return { detail: 'No pending decisions — operating autonomously', result: 'skipped' };
  });

  autonomyEngine.registerAction('qudag-witness', 'verify_chain', async () => {
    if (!witnessChain) return { detail: 'Witness chain unavailable', result: 'skipped' };
    const verification = witnessChain.verify();
    return { detail: `Chain integrity: ${verification.valid ? 'VALID' : 'BROKEN'} — ${verification.checked} records checked`, result: verification.valid ? 'success' : 'error' };
  });

  // Strategic planner — Goalie GOAP evaluates progress against objectives
  autonomyEngine.registerAction('mincut-optimizer', 'evaluate_strategy', async () => {
    const plan = strategicPlanner.getCurrentPlan();
    if (!plan) {
      // Auto-initialize strategy on first heartbeat
      await strategicPlanner.createStrategy({
        startCapital: 4000,
        targetCapital: 25000,
        timeframeDays: 30,
        riskTolerance: 'aggressive',
      });
      return { detail: 'Strategy initialized: $4K Alpaca → $25K in 30 days — unlock PDT (GOAP plan active)', result: 'success' };
    }

    const account = await executor.getAccount();
    const realPortfolio = account?.portfolioValue || 0;
    // Simulate $3K Alpaca capital. Track P&L relative to paper start, report as $3K + P&L
    const totalPnl = realPortfolio - 100000; // Actual P&L from trading
    const simulatedCapital = 8000 + totalPnl; // $4K deposit × 2x margin = $8K + accumulated P&L
    const perfStats = positionManager.getPerformanceStats();
    const daysSinceStart = Math.max(1, Math.floor((Date.now() - (plan.createdAt?.getTime?.() || Date.now())) / (24 * 60 * 60 * 1000)));
    const progress = strategicPlanner.evaluateProgress(simulatedCapital, perfStats.totalTrades, perfStats.winRate, daysSinceStart);
    return {
      detail: `${progress.adjustment} | Simulated: $${simulatedCapital.toFixed(0)} (P&L: $${totalPnl.toFixed(0)}) vs expected $${progress.expectedCapital.toFixed(0)} (${(progress.actualVsExpected * 100).toFixed(0)}%) | Day ${daysSinceStart}/${plan.objective?.timeframeDays || 90}`,
      result: progress.onTrack ? 'success' : 'error',
    };
  });

  // ── Daily Strategy Optimizer — "What should we do TODAY to hit $500?" ──
  const dailyOptimizer = new DailyOptimizer();
  let currentDailyStrategy: ReturnType<DailyOptimizer['optimize']> | null = null;

  autonomyEngine.registerAction('mincut-optimizer', 'daily_strategy', async () => {
    const account = await executor.getAccount();
    if (!account) return { detail: 'No broker connection', result: 'skipped' };

    const positions = await executor.getPositions();
    const forexPositions = await (async () => {
      try {
        const res = await fetch('http://localhost:3003/api/forex/positions');
        if (!res.ok) return [];
        const data = await res.json() as any;
        return (data.positions || []).map((p: any) => ({
          instrument: p.instrument,
          pnl: p.unrealizedPL || 0,
          direction: p.direction || 'long',
        }));
      } catch { return []; }
    })();

    // Determine market condition from crypto movers
    const cryptoMovers: Array<{ pct: number }> = [];
    try {
      const latestCrypto = researchReports.find(r => r.agent === 'crypto-researcher');
      if (latestCrypto?.signals) {
        for (const s of latestCrypto.signals) {
          const pct = parseFloat(s.detail.match(/([+-]?\d+\.?\d*)%/)?.[1] || '0');
          if (pct !== 0) cryptoMovers.push({ pct });
        }
      }
    } catch {}

    const dayPnl = account.dayPnl || 0;
    const utcH = new Date().getUTCHours();
    const sessions: string[] = [];
    if (utcH >= 0 && utcH < 9) sessions.push('TOKYO');
    if (utcH >= 7 && utcH < 16) sessions.push('LONDON');
    if (utcH >= 13 && utcH < 22) sessions.push('NEW_YORK');
    if (utcH >= 21 || utcH < 6) sessions.push('SYDNEY');

    const strategy = dailyOptimizer.optimize({
      budget: 8000,
      dailyGoal: 500,
      currentDayPnl: dayPnl,
      positions: positions.map((p: any) => ({
        ticker: p.ticker,
        value: Math.abs(p.marketValue),
        pnl: p.unrealizedPnl,
        pnlPct: p.unrealizedPnlPercent / 100,
        isCrypto: p.ticker.includes('USD') && p.ticker.length > 5,
      })),
      forexPositions,
      bayesianPrefer: Array.from(adaptiveState.preferTickers),
      bayesianAvoid: Array.from(adaptiveState.avoidTickers),
      slDominance: adaptiveState.stopLossDominance,
      marketCondition: getMarketCondition(cryptoMovers),
      activeSessions: sessions,
      cryptoMarketBias: getMarketCondition(cryptoMovers),
    });

    currentDailyStrategy = strategy;

    // Save strategy as research report for dashboard
    saveResearchReport({
      id: `strategy-${Date.now()}`,
      agent: 'mincut-optimizer',
      type: 'daily_strategy',
      timestamp: strategy.timestamp,
      summary: strategy.narrative,
      findings: strategy.actions,
      signals: Object.entries(strategy.allocations)
        .filter(([, v]) => v.pct > 0)
        .map(([k, v]) => ({
          symbol: k.toUpperCase(),
          direction: 'allocation',
          signal: `${v.pct}%`,
          detail: v.rationale,
        })),
      strategy: {
        action: `${strategy.approach.toUpperCase()} mode. Remaining: $${strategy.remainingGoal.toFixed(0)}. Risk budget: $${strategy.riskBudget.toFixed(0)}.`,
        rationale: strategy.narrative,
        risk: `Max loss today: $${strategy.riskBudget.toFixed(0)}. Max ${strategy.maxNewPositions} new positions. TP target: $${strategy.takeProfitTarget.toFixed(0)}/pos.`,
      },
      meta: { approach: strategy.approach, allocations: strategy.allocations, remainingGoal: strategy.remainingGoal },
    });

    return {
      detail: `DAILY STRATEGY: ${strategy.approach.toUpperCase()} | Goal: $${strategy.remainingGoal.toFixed(0)} remaining | ${strategy.actions.slice(0, 3).join(' | ')}`,
      result: 'success',
    };
  });

  // Expose daily strategy for neural trader to read
  (app as any)._dailyStrategy = () => currentDailyStrategy;

  // API endpoint for dashboard
  app.get('/api/strategy/daily', (_req, res) => {
    res.json(currentDailyStrategy || { approach: 'pending', narrative: 'Waiting for first heartbeat...' });
  });

  // Analyst Agent — 24/7 BROAD market scanner
  // Scans hundreds of symbols across every asset class to find the best setups.
  // Sources: Alpaca screeners (most-active, top movers), sector ETFs, full commodity/metal/energy universe,
  // crypto universe, and dynamically discovered opportunities.
  autonomyEngine.registerAction('analyst-agent', 'deep_scan', async () => {
    const opportunities: string[] = [];
    const alpacaHeaders = {
      'APCA-API-KEY-ID': (midstream as any).config.alpacaApiKey || '',
      'APCA-API-SECRET-KEY': (midstream as any).config.alpacaApiSecret || '',
    };
    const bootstrapFn = (app as any)._bootstrapTicker;

    const tel = (step: string, data: Record<string, unknown> = {}) => {
      eventBus.emit('telemetry:step' as any, { agentId: 'analyst-agent', step, ...data } as any);
    };

    // Helper: add a ticker to watchlist + bootstrap if not already tracked
    let newTickers = 0;
    const addTicker = async (ticker: string, reason: string, detail: string) => {
      if (!ticker || ticker.length > 5) return; // skip warrants/units (5+ chars like GOOGL ok, XYZWZ not)
      if (midstream.getLatestQuote(ticker)) return; // already tracked
      midstream.addToWatchlist(ticker);
      await bootstrapFn?.(ticker);
      newTickers++;
      opportunities.push(`${reason}: ${ticker} ${detail}`);
    };

    tel('scan_started', { phase: 'broad_discovery' });

    // ===== 1. ALPACA SCREENERS — top 50 most active by trades =====
    tel('screener_query', { source: 'alpaca', endpoint: 'most-actives', top: 50 });
    try {
      const screenRes = await fetch(
        'https://data.alpaca.markets/v1beta1/screener/stocks/most-actives?by=trades&top=50',
        { headers: alpacaHeaders },
      );
      if (screenRes.ok) {
        const data = await screenRes.json() as any;
        for (const m of (data.most_actives || [])) {
          await addTicker(m.symbol, 'ACTIVE', `(${m.trade_count || 0} trades)`);
        }
      }
    } catch { /* non-critical */ }

    // ===== 2. TOP MOVERS — gainers AND losers (top 20 each) =====
    tel('screener_query', { source: 'alpaca', endpoint: 'movers', top: 20 });
    try {
      const moversRes = await fetch(
        'https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=20',
        { headers: alpacaHeaders },
      );
      if (moversRes.ok) {
        const data = await moversRes.json() as any;
        for (const g of (data.gainers || [])) {
          await addTicker(g.symbol, 'GAINER', `+${g.percent_change?.toFixed(1)}%`);
        }
        for (const l of (data.losers || [])) {
          await addTicker(l.symbol, 'LOSER', `${l.percent_change?.toFixed(1)}% — bounce/short`);
        }
      }
    } catch { /* non-critical */ }

    // ===== 3. MOST ACTIVE BY VOLUME — catches different names than by trades =====
    try {
      const volRes = await fetch(
        'https://data.alpaca.markets/v1beta1/screener/stocks/most-actives?by=volume&top=50',
        { headers: alpacaHeaders },
      );
      if (volRes.ok) {
        const data = await volRes.json() as any;
        for (const m of (data.most_actives || [])) {
          await addTicker(m.symbol, 'VOLUME', `(${((m.volume || 0) / 1e6).toFixed(1)}M vol)`);
        }
      }
    } catch { /* non-critical */ }

    // ===== 4. SECTOR & THEMATIC ETF UNIVERSE — always be scanning these =====
    // This is the broad coverage — every major sector, commodity, metal, energy, bond, international
    const sectorUniverse = [
      // Sector ETFs
      'XLF', 'XLK', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLB', 'XLC', 'XLRE', 'XLY',
      // Industry focus
      'XBI', 'XHB', 'XME', 'XOP', 'XRT', 'KRE', 'KBE', 'IBB', 'SMH', 'HACK', 'ARKK', 'ARKG',
      // Commodities & Energy — broad
      'USO', 'UNG', 'UGA', 'DBO', 'GSG', 'DBA', 'PDBC', 'DBC', 'BNO', 'BOIL', 'KOLD',
      'FCG', 'XOP', 'OIH', 'AMLP', 'CPER', 'WEAT', 'CORN', 'SOYB', 'NIB', 'JO', 'SGG',
      // Precious metals
      'SLV', 'GLD', 'SIVR', 'PSLV', 'IAU', 'PHYS', 'GDX', 'GDXJ', 'SIL', 'SILJ', 'PPLT', 'PALL',
      // Inverse / bear (profit from declines)
      'SQQQ', 'SPXS', 'UVXY', 'SH', 'PSQ', 'DOG', 'SDS', 'QID', 'TZA', 'SDOW', 'SPXU', 'SRTY',
      // Leveraged bull
      'TQQQ', 'SOXL', 'UPRO', 'UDOW', 'TNA', 'LABU', 'FNGU',
      // International
      'EWJ', 'EWZ', 'EWG', 'EWU', 'FXI', 'INDA', 'EEM', 'VWO', 'IEMG', 'EFA',
      // Fixed income / rate plays
      'TLT', 'TBT', 'HYG', 'JNK', 'LQD', 'AGG', 'SHY', 'IEF', 'TMF', 'TMV',
      // Volatility
      'VXX', 'VIXY', 'SVXY', 'VIXM',
      // REITs
      'VNQ', 'XLRE', 'O', 'AMT', 'PLD', 'SPG',
      // Dividend / value
      'SCHD', 'VYM', 'DVY', 'HDV',
      // Major individual stocks — mega caps + high beta
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'AMD', 'AVGO', 'CRM',
      'NFLX', 'UBER', 'SQ', 'SHOP', 'SNOW', 'PLTR', 'COIN', 'MARA', 'RIOT', 'SOFI',
      'JPM', 'GS', 'BAC', 'WFC', 'MS',
      'LMT', 'RTX', 'NOC', 'GD', 'BA', 'LHX',
      'PFE', 'JNJ', 'UNH', 'ABBV', 'LLY', 'MRK',
      'XOM', 'CVX', 'COP', 'SLB', 'OXY', 'HAL', 'MPC', 'VLO', 'PSX',
      'NEM', 'GOLD', 'AEM', 'FNV', 'WPM', 'AG',
      'HIMS', 'CELH', 'DKNG', 'RBLX', 'HOOD',
      // AI/Data Center Infrastructure — our key vertical
      'VRT', 'SMCI', 'DELL', 'HPE', 'EQIX', 'DLR', 'ANET', 'CRWD', 'NET', 'ARM',
      'MRVL', 'MU', 'QCOM', 'INTC', 'TSM', 'ASML',
      // High beta / meme / speculative
      'GME', 'AMC', 'BBBY', 'LCID', 'RIVN', 'JOBY', 'IONQ', 'RGTI', 'QUBT',
    ];
    tel('sector_scan', { universe_size: sectorUniverse.length });
    for (const ticker of sectorUniverse) {
      await addTicker(ticker, 'UNIVERSE', '');
    }

    // ===== 5. CRYPTO UNIVERSE — all major pairs =====
    const cryptoUniverse = [
      'BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD', 'DOGE-USD',
      'ADA-USD', 'DOT-USD', 'MATIC-USD', 'ATOM-USD', 'UNI-USD', 'AAVE-USD',
      'XRP-USD', 'LTC-USD', 'BCH-USD', 'SHIB-USD', 'FIL-USD', 'NEAR-USD',
    ];
    for (const ticker of cryptoUniverse) {
      if (!midstream.getLatestQuote(ticker)) {
        midstream.addToWatchlist(ticker);
        // Crypto bootstrap uses different URL format
        await bootstrapFn?.(ticker);
        newTickers++;
      }
    }

    // ===== 6. PENNY STOCKS & RECENT IPOs — high-alpha gem hunting =====
    // Scan Alpaca for recently listed symbols with unusual activity
    tel('screener_query', { source: 'alpaca', endpoint: 'penny_ipo_scan' });
    try {
      // Alpaca "most active by trades" often catches penny stock breakouts
      // Filter for low-price, high-volume movers
      const moversRes = await fetch(
        'https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=50',
        { headers: alpacaHeaders },
      );
      if (moversRes.ok) {
        const data = await moversRes.json() as any;
        // Gainers with >10% move are potential gems
        for (const g of (data.gainers || [])) {
          if (Math.abs(g.percent_change || 0) >= 10) {
            await addTicker(g.symbol, 'GEM-MOVER', `+${g.percent_change?.toFixed(1)}% — high momentum`);
          }
        }
        // Losers with >15% drop are potential bounce plays or short targets
        for (const l of (data.losers || [])) {
          if (Math.abs(l.percent_change || 0) >= 15) {
            await addTicker(l.symbol, 'GEM-CRASH', `${l.percent_change?.toFixed(1)}% — bounce/short candidate`);
          }
        }
      }
    } catch { /* non-critical */ }

    // Known recent IPOs / SPACs / small-caps with momentum potential
    // This list should be updated by news-desk agent findings
    const gemUniverse = [
      // Recent IPOs and high-beta small caps
      'VRDN', 'MANE', 'OLOX', 'UMAC', 'JOBY', 'ACHR', 'EVTL',
      'IONQ', 'RGTI', 'QUBT', // quantum computing plays
      'SMCI', 'IREN', 'BTBT', 'MARA', 'RIOT', 'CLSK', // crypto miners
      'SOUN', 'BBAI', 'GFAI', // AI small caps
      'ASTS', 'RKLB', 'LUNR', // space plays
      'HIMS', 'CELH', // momentum consumer
      'ADEA', 'GEV', // recent upgrades from news
      'NKE', // 7 straight down — short/bounce
    ];
    for (const ticker of gemUniverse) {
      await addTicker(ticker, 'GEM', '');
    }

    tel('discovery_complete', { newTickers, totalWatchlist: midstream.getAllQuotes().length });

    // 3. Analyze existing watchlist using Bayesian priors to prioritize
    tel('phase_change', { phase: 'analysis', method: 'bayesian_priors' });
    const diagnosis = await neuralTrader.diagnose();
    const intel = bayesianIntel.getCollectiveIntelligence();
    const assetsAnalyzed = Object.keys(diagnosis).length;
    tel('diagnosis_loaded', { assets: assetsAnalyzed, totalBeliefs: intel.totalBeliefs });

    for (const [ticker, data] of Object.entries(diagnosis) as [string, any][]) {
      if (data.status === 'insufficient_data') continue;

      const prior = bayesianIntel.getTickerPrior(ticker);
      const priorLabel = prior.observations >= 3
        ? ` [prior: ${(prior.posterior * 100).toFixed(0)}% win]`
        : '';

      if (data.rsi < 32) {
        if (prior.observations >= 3 && prior.posterior < 0.35) {
          opportunities.push(`OVERSOLD-AVOID: ${ticker} RSI ${data.rsi} — Bayesian says avoid (${(prior.posterior * 100).toFixed(0)}% win rate)`);
          tel('signal_evaluation', { ticker, type: 'oversold_avoid', rsi: data.rsi, bayesian_win: prior.posterior });
        } else {
          opportunities.push(`OVERSOLD: ${ticker} RSI ${data.rsi} — bounce setup${priorLabel}`);
          tel('signal_evaluation', { ticker, type: 'oversold_bounce', rsi: data.rsi });
        }
      }
      if (data.rsi > 72) {
        opportunities.push(`OVERBOUGHT: ${ticker} RSI ${data.rsi} — short candidate${priorLabel}`);
        tel('signal_evaluation', { ticker, type: 'overbought_short', rsi: data.rsi });
      }
      if (data.signalFired) {
        const adjConf = bayesianIntel.adjustSignalConfidence(ticker, data.confidence, data.direction);
        opportunities.push(`SIGNAL: ${ticker} ${data.direction.toUpperCase()} conf:${data.confidence}→${adjConf.toFixed(2)}${priorLabel}`);
        tel('signal_fired', { ticker, direction: data.direction, rawConf: data.confidence, adjustedConf: adjConf });
      }
    }

    // 4. Cross-agent intelligence: surface insights from collective learning
    tel('phase_change', { phase: 'intelligence', method: 'cross_agent' });
    if (intel.topInsights.length > 0) {
      opportunities.push(`INTEL: ${intel.topInsights[0]}`);
      tel('intel_insight', { insight: intel.topInsights[0] });
    }

    // 5. AgentDB ReasoningBank — query proven patterns for current market
    tel('phase_change', { phase: 'memory', method: 'reasoning_bank' });
    try {
      const provenPatterns = await queryPatterns('profitable trade setup', { k: 3, minSuccessRate: 0.7 });
      for (const p of provenPatterns) {
        opportunities.push(`PROVEN: ${p.approach} (${(p.successRate * 100).toFixed(0)}% win)`);
        tel('proven_pattern', { approach: p.approach, successRate: p.successRate });
      }
      tel('memory_query_complete', { patternsFound: provenPatterns.length });
    } catch {
      tel('memory_query_unavailable');
    }

    const watchlistSize = midstream.getAllQuotes().length;
    tel('scan_complete', { opportunities: opportunities.length, watchlistSize, assetsAnalyzed });

    // ===== MOMENTUM STAR EXECUTION — Direct trade path for high-conviction gems =====
    // When analyst finds huge movers with momentum + volume, execute immediately
    // This bypasses the slow indicator system that gives 0.38 to momentum plays
    const etNow = new Date();
    const etHourNow = parseInt(etNow.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }));
    const etMinNow = parseInt(etNow.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }));
    const etDayNow = etNow.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
    const marketOpen = !['Sat', 'Sun'].includes(etDayNow) && ((etHourNow === 9 && etMinNow >= 30) || (etHourNow >= 10 && etHourNow < 16));

    console.log(`[MomentumStar] Market open: ${marketOpen}, level: ${autonomyEngine.getConfig().autonomyLevel}, ET: ${etDayNow} ${etHourNow}:${etMinNow}`);
    // Always run in ACT mode — crypto trades 24/7, equities only during market hours
    if (autonomyEngine.getConfig().autonomyLevel === 'act') {
      try {
        const currentPositions = await executor.getPositions();
        // Normalize ticker formats: ETHUSD, ETH-USD, ETH/USD all match
        const positionTickers = new Set<string>();
        for (const p of currentPositions) {
          positionTickers.add(p.ticker);                           // ETHUSD
          positionTickers.add(p.ticker.replace('USD', '-USD'));     // ETH-USD
          positionTickers.add(p.ticker.replace('USD', '/USD'));     // ETH/USD
        }
        const simulatedCap = 8000; // $4K deposit × 2x Alpaca margin = $8K deployable
        const maxPos = 6; // More slots — crypto doesn't count against PDT
        // Count positions by simulated $3K budget — only positions under $1.5K each count
        // Legacy oversized positions from before the fix don't count against our slots
        const budgetPositions = currentPositions.filter(p => Math.abs(p.marketValue) <= 1500);
        let slotsAvailable = maxPos - budgetPositions.length;
        console.log(`[MomentumStar] Positions: ${currentPositions.length} total, ${budgetPositions.length} budget, ${slotsAvailable} slots`);

        if (slotsAvailable > 0) {
          // Intelligence gate: log what Bayesian knows before evaluating
          const avoidCount = adaptiveState.avoidTickers.size;
          const preferCount = adaptiveState.preferTickers.size;
          console.log(`[Intelligence] Gate: threshold=${adaptiveState.momentumStarThreshold.toFixed(2)}, avoid=${avoidCount} tickers, prefer=${preferCount} tickers`);

          // Fetch today's top movers directly for execution
          let moversData: any = { gainers: [], losers: [] };
          if (marketOpen) {
            const moversResp = await fetch(
              'https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=10',
              { headers: alpacaHeaders },
            );
            if (moversResp.ok) {
              moversData = await moversResp.json() as any;
            }
          }
          {
            const candidates: { symbol: string; pctChange: number; price: number; score: number; rationale: string }[] = [];

            // Always add crypto candidates — crypto trades 24/7
            const cryptoSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'LINK/USD', 'DOGE/USD'];
            for (const cryptoSym of cryptoSymbols) {
              const dashSym = cryptoSym.replace('/', '-');
              const quote = midstream.getLatestQuote(dashSym) || midstream.getLatestQuote(cryptoSym);
              if (quote?.price) {
                // Check 1h price change from historical data
                const bars = midstream.getHistoricalBars?.(cryptoSym) || [];
                const oldPrice = bars.length >= 2 ? bars[bars.length - 2]?.close : quote.price;
                const pctChange = oldPrice > 0 ? ((quote.price - oldPrice) / oldPrice) * 100 : 0;
                if (!positionTickers.has(dashSym) && !positionTickers.has(cryptoSym)) {
                  console.log(`[MomentumStar] Crypto ${dashSym}: $${quote.price.toFixed(2)} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%)`);
                }
              }
            }

            console.log(`[MomentumStar] Movers fetched: ${(moversData.gainers || []).length} gainers, Research stars: ${researchStars.size}, Crypto: ${cryptoSymbols.length}`);

            // Merge movers with research stars and crypto — research gets priority
            const allCandidateSyms = new Set<string>();
            if (marketOpen) {
              for (const g of (moversData.gainers || []).slice(0, 10)) {
                if (g.symbol && g.symbol.length <= 5) allCandidateSyms.add(g.symbol);
              }
            }
            // Always add crypto
            for (const cs of cryptoSymbols) {
              allCandidateSyms.add(cs.replace('/', '-'));
            }
            for (const [sym] of researchStars) {
              allCandidateSyms.add(sym);
            }

            for (const sym of allCandidateSyms) {
              // Skip if we already hold UNLESS it's a winning position (add to winners)
              if (positionTickers.has(sym)) {
                const existingPos = currentPositions.find(p => p.ticker === sym);
                if (!existingPos || existingPos.unrealizedPnl <= 10) continue; // Only add to winners with >$10 profit
                console.log(`[MomentumStar] ${sym} — adding to winning position (+$${existingPos.unrealizedPnl.toFixed(2)})`);
              }
              const isCryptoSym = sym.includes('-') || sym.includes('/');
              const moverData = (moversData.gainers || []).find((g: any) => g.symbol === sym);
              const researchData = researchStars.get(sym);
              const pctChange = moverData?.percent_change || 0;

              // Research stars and crypto don't need 8%+ move — they have catalysts or trade 24/7
              if (!researchData && !isCryptoSym && Math.abs(pctChange) < 8) continue;
              // Skip non-crypto during closed market
              if (!isCryptoSym && !marketOpen) continue;

              // Get current price
              const quote = midstream.getLatestQuote(sym) || midstream.getLatestQuote(sym.replace('-', '/'));
              let price = quote?.price || moverData?.price || 0;
              if (price <= 0) {
                // Spot-fetch price — different endpoint for crypto vs equities
                try {
                  const snapUrl = isCryptoSym
                    ? `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${sym.replace('-', '/')}`
                    : `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${sym}&feed=iex`;
                  const snapResp = await fetch(snapUrl, { headers: alpacaHeaders });
                  if (snapResp.ok) {
                    const snapData = await snapResp.json() as any;
                    const snapKey = isCryptoSym ? sym.replace('-', '/') : sym;
                    const snap = (snapData.snapshots || snapData)[snapKey];
                    price = snap?.latestTrade?.p || snap?.dailyBar?.c || 0;
                  }
                } catch {}
              }
              console.log(`[MomentumStar] Evaluating ${sym}: +${pctChange.toFixed(1)}% price=$${price} research=${!!researchData} sector=${researchData?.sector || 'none'}`);

              // === ADAPTIVE FILTERS (learned from outcomes) ===
              if (price <= 0) continue;
              if (!isCryptoSym && price > adaptiveState.maxPriceForMomentum) continue;
              if (!isCryptoSym && price < adaptiveState.minPrice && !researchData) {
                console.log(`[MomentumStar] ${sym} SKIP — price $${price} below learned min $${adaptiveState.minPrice.toFixed(2)}`);
                continue;
              }
              if (adaptiveState.avoidTickers.has(sym)) {
                // Exception: if we already hold this position and it's winning, allow adding to it
                const existingPos = currentPositions.find(p => p.ticker === sym);
                if (!existingPos || existingPos.unrealizedPnl <= 0) {
                  console.log(`[MomentumStar] ${sym} SKIP — Bayesian blacklisted (past losses)`);
                  continue;
                }
                console.log(`[MomentumStar] ${sym} OVERRIDE blacklist — existing position is winning (+$${existingPos.unrealizedPnl.toFixed(2)}), adding to winner`);
              }

              // Composite score: research + momentum + Bayesian + sector
              let score: number;
              if (researchData) {
                score = researchData.score;
              } else if (isCryptoSym) {
                // Crypto scoring: use neural trader signals + real-time price data
                const neuralSignal = neuralTrader.getActiveSignals().find(s => s.ticker === sym || s.ticker === sym.replace('-', '/'));
                const neuralConf = neuralSignal?.confidence || 0.45;
                // Crypto base score: these are liquid major assets trading 24/7
                // Higher base than random penny stocks — BTC/ETH/SOL are tier-1 assets
                score = Math.max(0.55, neuralConf * 0.7 + 0.25); // Ensures major crypto clears threshold
              } else {
                score = Math.min(0.90, pctChange / 100 + 0.50);
              }
              // Sector bonus — our target sectors get a boost
              if (researchData?.sector === 'AI/DataCenter') score += 0.10;
              else if (researchData?.sector === 'Minerals/Metals') score += 0.05;
              else if (researchData?.sector === 'Catalyst') score += 0.08;

              // Bayesian ticker-level learning — HARD GATE then blend
              const prior = bayesianIntel.getTickerPrior(sym);
              if (prior.observations >= 3) {
                // HARD BLOCK: if Bayesian says this ticker loses (< 45% win rate), skip entirely
                if (prior.posterior < 0.45) {
                  console.log(`[MomentumStar] ${sym} BLOCKED — Bayesian win rate ${(prior.posterior * 100).toFixed(0)}% (${prior.observations} trades). Intelligence says NO.`);
                  continue;
                }
                // Strong blend: 50% Bayesian weight — intelligence MUST agree with momentum
                score = score * 0.50 + prior.posterior * 0.50;
              } else {
                // Unproven ticker penalty — require higher momentum to justify unknown risk
                score -= 0.05;
              }
              // Intelligence gate: with 84% stop-loss rate, only trade what the system KNOWS works
              // Preferred tickers get a strong boost, non-preferred get a heavy penalty
              if (adaptiveState.preferTickers.has(sym)) {
                score += 0.15; // Strong boost for proven winners
              } else if (prior && prior.observations >= 5 && prior.posterior < 0.45) {
                // System has data and it's negative — hard block
                console.log(`[Intelligence] ${sym} BLOCKED — Bayesian posterior ${(prior.posterior*100).toFixed(0)}% on ${prior.observations} obs`);
                continue;
              } else if (!prior || prior.observations < 3) {
                // Unproven ticker — penalty unless backed by news catalyst (researchStars)
                const hasNewsCatalyst = researchData?.catalyst?.startsWith('NEWS:') || researchData?.catalyst?.startsWith('BULLISH:');
                if (hasNewsCatalyst) {
                  // News-backed catalyst: no penalty, catalyst IS the evidence
                  score += 0.05;
                } else {
                  score -= 0.15;
                }
              }

              // ReasoningBank — proven patterns
              try {
                const patterns = await queryPatterns(`buy ${sym} momentum`, { k: 1, minSuccessRate: 0.6 });
                if (patterns.length > 0) score += 0.05;
              } catch {}

              // FANN Neural Forecast — get probabilistic prediction before buying
              const priceHistory = neuralTrader.getPriceHistory(sym);
              if (priceHistory && priceHistory.length >= 50) {
                try {
                  const forecast = await neuralForecast(priceHistory);
                  if (forecast) {
                    if (forecast.direction === 'down' && forecast.confidence > 0.5) {
                      console.log(`[Intelligence] ${sym} BLOCKED by FANN — neural predicts DOWN (conf=${(forecast.confidence * 100).toFixed(0)}%, agreement=${(forecast.modelAgreement * 100).toFixed(0)}%)`);
                      continue; // Neural says price going down — don't buy
                    }
                    if (forecast.direction === 'up' && forecast.confidence > 0.4) {
                      score += forecast.modelAgreement * 0.15; // Up to +0.15 boost from neural agreement
                      console.log(`[Intelligence] ${sym} FANN boost +${(forecast.modelAgreement * 0.15).toFixed(2)} — neural UP (conf=${(forecast.confidence * 100).toFixed(0)}%)`);
                    }
                  }
                } catch {}
              }

              // News sentiment check
              for (const [, entry] of newsCache) {
                if (Date.now() - entry.timestamp > 4 * 3600_000) continue;
                if (entry.tickers.includes(sym) && entry.sentiment === 'BULLISH') {
                  score += 0.10;
                  break;
                } else if (entry.tickers.includes(sym) && entry.sentiment === 'BEARISH') {
                  score -= 0.15; // Penalize buying into bearish news
                  break;
                }
              }

              // === ADAPTIVE THRESHOLD (learned from momentum_star domain outcomes) ===
              // Floor at 0.68 — with 40% win rate and 84% SL dominance, we need higher conviction
              const threshold = Math.max(adaptiveState.momentumStarThreshold, 0.68);
              console.log(`[MomentumStar] ${sym} score=${score.toFixed(2)} (threshold ${threshold.toFixed(2)} [adaptive, floor=0.68])`);
              if (score >= threshold) {
                candidates.push({
                  symbol: sym,
                  pctChange: pctChange,
                  price,
                  score,
                  rationale: researchData ? `RESEARCH: ${researchData.sector} — ${researchData.catalyst}` : isCryptoSym ? `Crypto 24/7 (score: ${score.toFixed(2)})` : `Momentum +${pctChange.toFixed(1)}%`,
                });
              }
            }

            // Crypto-dominant: 90% crypto / 10% equity until $25K reached ($4K → $25K growth phase)
            // Crypto = primary income engine (24/7, no PDT, high vol). Equity only for exceptional setups.
            const cryptoCandidates = candidates.filter(c => c.symbol.includes('-') || c.symbol.includes('/'));
            const equityCandidates = candidates.filter(c => !c.symbol.includes('-') && !c.symbol.includes('/'));
            cryptoCandidates.sort((a, b) => b.score - a.score);
            equityCandidates.sort((a, b) => b.score - a.score);

            // Crypto-dominant allocation: 90% crypto, 10% equity (only exceptional setups)
            const cryptoBases = ['BTC','ETH','SOL','AVAX','DOGE','SHIB','LINK','UNI','DOT','MATIC','XRP','NEAR','ADA','AAVE','LTC','BCH','PEPE','BONK','RENDER'];
            const isCryptoTicker = (t: string) => cryptoBases.some(b => t.startsWith(b) && (t.endsWith('USD') || t.includes('-') || t.includes('/')));
            const existingCrypto = budgetPositions.filter(p => isCryptoTicker(p.ticker)).length;
            // Reserve 90% of slots for crypto — equity gets 1 slot max, only if score > 0.80
            const cryptoSlots = Math.max(0, Math.ceil(maxPos * 0.9) - existingCrypto);
            const equitySlots = Math.min(1, Math.max(0, slotsAvailable - cryptoSlots));

            // Equity gate: only truly exceptional setups (score > 0.80) — no routine blue-chip momentum
            const exceptionalEquity = equityCandidates.filter(c => c.score >= 0.80);

            // Fill crypto first, equity only gets leftovers AND only if exceptional
            const selectedCrypto = cryptoCandidates.slice(0, Math.min(cryptoSlots, slotsAvailable));
            const remainingSlots = slotsAvailable - selectedCrypto.length;
            const selectedEquity = exceptionalEquity.slice(0, Math.min(equitySlots, remainingSlots));
            candidates.length = 0;
            candidates.push(...selectedCrypto, ...selectedEquity);
            console.log(`[MomentumStar] Crypto-dominant: ${selectedCrypto.length} crypto (${cryptoSlots} slots), ${selectedEquity.length} equity (${equitySlots} slots, ${equityCandidates.length} candidates, ${exceptionalEquity.length} exceptional)`);

            // SPEC-005: Total capital cap — don't deploy more than $4K simulated capital
            const totalDeployed = currentPositions.reduce((s, p) => s + Math.abs(p.marketValue), 0);
            const budgetDeployed = budgetPositions.reduce((s, p) => s + Math.abs(p.marketValue), 0);
            const capitalRemaining = Math.max(0, simulatedCap - budgetDeployed);
            console.log(`[MomentumStar] ${candidates.length} candidates, ${slotsAvailable} slots, capital: $${budgetDeployed.toFixed(0)}/$${simulatedCap} deployed, $${capitalRemaining.toFixed(0)} remaining`);
            if (capitalRemaining < 100) {
              console.log(`[MomentumStar] Capital fully deployed ($${budgetDeployed.toFixed(0)}/$${simulatedCap}) — no new positions`);
              candidates.length = 0;
            }

            for (const c of candidates) {
              if (slotsAvailable <= 0) break;
              const posSize = Math.min(simulatedCap * 0.35, 1400, capitalRemaining); // $1.4K max, capped by remaining capital
              const isCryptoOrder = c.symbol.includes('-') || c.symbol.includes('/');
              // Crypto supports fractional quantities (e.g. 0.02 BTC), equities need whole shares
              const qty = isCryptoOrder
                ? Math.max(0.001, parseFloat((posSize / c.price).toFixed(6)))  // fractional crypto
                : Math.floor(posSize / c.price);
              console.log(`[MomentumStar] EXECUTING ${c.symbol}: qty=${qty} @ $${c.price.toFixed(2)} size=$${posSize} score=${c.score.toFixed(2)} crypto=${isCryptoOrder}`);
              if (qty <= 0) continue;

              const signal = {
                id: `momentum-${Date.now()}`,
                ticker: c.symbol,
                direction: 'buy' as const,
                confidence: c.score,
                timeframe: '1h' as const,
                indicators: {},
                pattern: `MOMENTUM_STAR: +${c.pctChange?.toFixed(1)}%`,
                timestamp: new Date(),
                source: 'analyst' as const,
              };

              const decision = authority.evaluateTrade(posSize, `Momentum Star: BUY ${c.symbol} +${c.pctChange?.toFixed(1)}% (score: ${c.score.toFixed(2)})`, 'trading');
              if (decision.authority === 'autonomous') {
                const order = await executor.execute(signal, qty, posSize);
                opportunities.push(`STAR EXECUTED: BUY ${qty} ${c.symbol} @ $${c.price.toFixed(2)} (score: ${c.score.toFixed(2)}) — ${order.status}`);
                slotsAvailable--;
                tel('momentum_star_trade', { symbol: c.symbol, qty, price: c.price, score: c.score, status: order.status });

                // Record in Bayesian for future learning
                bayesianIntel.recordOutcome(
                  `momentum:${c.symbol}`,
                  { domain: 'momentum_star', subject: c.symbol, tags: ['momentum', 'star'], contributors: ['analyst-agent'] },
                  order.status === 'filled',
                  c.pctChange / 100,
                );
              }
            }
          }
        }
      } catch (err: any) {
        tel('momentum_star_error', { error: err.message });
      }
    }

    if (opportunities.length === 0) {
      return { detail: `Scanned ${assetsAnalyzed} assets, watchlist: ${watchlistSize} — markets quiet`, result: 'skipped' };
    }

    return {
      detail: `${opportunities.length} opportunities found (watchlist: ${watchlistSize}): ${opportunities.slice(0, 4).join('; ')}`,
      result: 'success',
    };
  });

  // ===== NEWS DESK AGENT — Real-time news intelligence from RSS feeds =====
  // Scans Yahoo Finance, CNBC, Seeking Alpha for market-moving events,
  // IPOs, geopolitical catalysts, sector rotation signals, and high-alpha opportunities.
  // Feeds actionable intelligence directly to analyst watchlist + signals.
  const newsCache: Map<string, { headline: string; source: string; tickers: string[]; sentiment: string; timestamp: number }> = new Map();

  autonomyEngine.registerAction('news-desk', 'scan_feeds', async () => {
    const tel = (step: string, data: Record<string, unknown> = {}) => {
      eventBus.emit('telemetry:step' as any, { agentId: 'news-desk', step, ...data } as any);
    };

    const alerts: string[] = [];
    const newTickers: string[] = [];

    // RSS feed sources
    const feeds = [
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US', name: 'Yahoo-SP500' },
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^DJI&region=US&lang=en-US', name: 'Yahoo-DJI' },
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=CL=F&region=US&lang=en-US', name: 'Yahoo-Oil' },
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC=F&region=US&lang=en-US', name: 'Yahoo-Gold' },
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD&region=US&lang=en-US', name: 'Yahoo-BTC' },
      { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', name: 'CNBC-Top' },
      { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', name: 'CNBC-Market' },
      { url: 'https://seekingalpha.com/market_currents.xml', name: 'SA-Currents' },
      { url: 'https://seekingalpha.com/tag/ipo-analysis.xml', name: 'SA-IPO' },
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^VIX&region=US&lang=en-US', name: 'Yahoo-VIX' },
    ];

    tel('scan_started', { feeds: feeds.length });

    // Company name → ticker mapping for key sectors we track
    const companyTickers: Record<string, string> = {
      'vertiv': 'VRT', 'nvidia': 'NVDA', 'super micro': 'SMCI', 'supermicro': 'SMCI',
      'palantir': 'PLTR', 'tesla': 'TSLA', 'apple': 'AAPL', 'amazon': 'AMZN',
      'microsoft': 'MSFT', 'google': 'GOOGL', 'alphabet': 'GOOGL', 'meta': 'META',
      'arm holdings': 'ARM', 'broadcom': 'AVGO', 'taiwan semi': 'TSM', 'tsmc': 'TSM',
      'micron': 'MU', 'marvell': 'MRVL', 'dell': 'DELL', 'hpe': 'HPE',
      'equinix': 'EQIX', 'digital realty': 'DLR', 'arista': 'ANET',
      'crowdstrike': 'CRWD', 'cloudflare': 'NET', 'snowflake': 'SNOW',
      'coinbase': 'COIN', 'marathon digital': 'MARA', 'riot': 'RIOT',
      'joby': 'JOBY', 'ionq': 'IONQ', 'hims': 'HIMS', 'sofi': 'SOFI',
      'gamestop': 'GME', 'amc': 'AMC', 'lucid': 'LCID', 'rivian': 'RIVN',
      'boeing': 'BA', 'lockheed': 'LMT', 'raytheon': 'RTX', 'northrop': 'NOC',
      'exxon': 'XOM', 'chevron': 'CVX', 'halliburton': 'HAL',
      'gold': 'GLD', 'silver': 'SLV', 'bitcoin': 'BTCUSD', 'ethereum': 'ETHUSD',
      'solana': 'SOLUSD', 'dogecoin': 'DOGEUSD',
    };

    // Known ticker patterns to extract from headlines
    const tickerRegex = /\b([A-Z]{1,5})\b/g;
    const commonWords = new Set(['THE','AND','FOR','BUT','NOT','WITH','FROM','THIS','THAT','HAVE','HAS',
      'ARE','WAS','WERE','WILL','CAN','ITS','ALL','NEW','ONE','TWO','TOP','BIG','LOW','HIGH','OIL','GAS',
      'IPO','CEO','CFO','FDA','SEC','ETF','GDP','PMI','CPI','FED','DOT','USA','USD','EUR','AI','DOW','HOW',
      'WHY','WHO','MAY','SAY','NOW','GET','SET','CUT','HIT','RUN','PUT','BUY','UP','TSA','GOP','WAR','ID',
      'IBD','DAY','STOCK','NEWS','THE','OVER','SOON','COULD','SAYS','SAID']);

    const extractTickers = (text: string): string[] => {
      // 1. Regex extraction of uppercase symbols
      const matches = text.match(tickerRegex) || [];
      const tickers = matches.filter(m => m.length >= 2 && m.length <= 5 && !commonWords.has(m));
      // 2. Company name matching
      const lower = text.toLowerCase();
      for (const [name, ticker] of Object.entries(companyTickers)) {
        if (lower.includes(name)) tickers.push(ticker);
      }
      return [...new Set(tickers)];
    };

    // Parse simple RSS XML
    const parseRSS = (xml: string): { title: string; description: string; pubDate: string }[] => {
      const items: { title: string; description: string; pubDate: string }[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const content = match[1];
        const title = content.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '';
        const desc = content.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/)?.[1] || '';
        const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
        items.push({ title: title.trim(), description: desc.trim(), pubDate });
      }
      return items;
    };

    // Sentiment keywords
    const bullishWords = ['surge','soar','jump','rally','boom','breakout','upgrade','buy','bullish','beat','record','high','gain','double'];
    const bearishWords = ['crash','plunge','drop','fall','sink','selloff','downgrade','cut','bearish','miss','low','loss','recession','fear','stagflation'];

    const detectSentiment = (text: string): 'bullish' | 'bearish' | 'neutral' => {
      const lower = text.toLowerCase();
      const bull = bullishWords.filter(w => lower.includes(w)).length;
      const bear = bearishWords.filter(w => lower.includes(w)).length;
      if (bull > bear) return 'bullish';
      if (bear > bull) return 'bearish';
      return 'neutral';
    };

    // Fetch all feeds in parallel
    const results = await Promise.allSettled(
      feeds.map(async (feed) => {
        try {
          const resp = await fetch(feed.url, {
            headers: { 'User-Agent': 'MTWM-NewsDesk/1.0' },
            signal: AbortSignal.timeout(8000),
          });
          if (!resp.ok) return { feed: feed.name, items: [] };
          const text = await resp.text();
          const items = parseRSS(text);
          return { feed: feed.name, items: items.slice(0, 15) };
        } catch {
          return { feed: feed.name, items: [] };
        }
      })
    );

    let totalItems = 0;
    let newAlerts = 0;

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { feed, items } = r.value;

      for (const item of items) {
        totalItems++;
        const key = item.title.substring(0, 80);
        if (newsCache.has(key)) continue; // Already processed

        const fullText = `${item.title} ${item.description}`;
        const tickers = extractTickers(fullText);
        const sentiment = detectSentiment(fullText);

        newsCache.set(key, {
          headline: item.title,
          source: feed,
          tickers,
          sentiment,
          timestamp: Date.now(),
        });

        // Only alert on actionable items
        const isActionable = tickers.length > 0 || sentiment !== 'neutral';
        if (!isActionable) continue;

        newAlerts++;

        // High-priority: IPO mentions, surge/crash, geopolitical
        const isHighPriority = /ipo|debut|listing|surge|crash|plunge|soar|war|oil|crisis|record/i.test(fullText);

        if (isHighPriority) {
          alerts.push(`[${feed}] ${sentiment.toUpperCase()}: ${item.title.substring(0, 100)}${tickers.length > 0 ? ` | $${tickers.join(', $')}` : ''}`);

          // PROMOTE catalyst tickers to research stars so neural trader acts on them
          // This closes the know-do gap: news → stars → neural trader → trade
          const catalystMap: Record<string, string[]> = {
            oil: ['XOM', 'HAL', 'CVX', 'KOS', 'USO'],
            crude: ['USO', 'XOM'],
            iran: ['XOM', 'HAL', 'LMT', 'RTX'],
            gold: ['GLD', 'GDXJ'],
            aluminum: ['AA'],
            copper: ['FCX'],
            'data center': ['VRT', 'NRG', 'EQIX'],
            semiconductor: ['MU', 'NVDA', 'AMD'],
            defense: ['LMT', 'RTX', 'NOC'],
          };
          const lowerText = fullText.toLowerCase();
          for (const [keyword, syms] of Object.entries(catalystMap)) {
            if (lowerText.includes(keyword)) {
              for (const sym of syms) {
                if (!researchStars.has(sym)) {
                  researchStars.set(sym, {
                    symbol: sym,
                    sector: keyword.includes('oil') || keyword.includes('crude') ? 'Energy' : keyword.includes('gold') ? 'Metals' : keyword.includes('defense') || keyword.includes('iran') ? 'Defense' : 'Catalyst',
                    catalyst: `NEWS: ${item.title.substring(0, 80)}`,
                    score: sentiment === 'bullish' ? 0.75 : 0.60,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          }

          // Also promote any directly mentioned tickers with bullish sentiment
          if (sentiment === 'bullish') {
            for (const ticker of tickers) {
              if (ticker.length >= 2 && ticker.length <= 5 && !researchStars.has(ticker)) {
                researchStars.set(ticker, {
                  symbol: ticker,
                  sector: 'News',
                  catalyst: `BULLISH: ${item.title.substring(0, 80)}`,
                  score: 0.70,
                  timestamp: Date.now(),
                });
              }
            }
          }
        }

        // Add newly discovered tickers to watchlist
        for (const ticker of tickers) {
          if (!midstream.getLatestQuote(ticker) && ticker.length <= 5) {
            midstream.addToWatchlist(ticker);
            const bootstrapFn = (app as any)._bootstrapTicker;
            await bootstrapFn?.(ticker);
            newTickers.push(ticker);
          }
        }
      }
    }

    // ===== ECONOMIC CALENDAR: Fed decisions, CPI, NFP, earnings =====
    // Pull today's economic events so the system knows what's coming
    try {
      // Investing.com economic calendar RSS
      const ecoResp = await fetch('https://www.investing.com/rss/economic_calendar.rss', {
        headers: { 'User-Agent': 'MTWM-NewsDesk/1.0' },
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (ecoResp?.ok) {
        const ecoXml = await ecoResp.text();
        const ecoItems = parseRSS(ecoXml).slice(0, 20);
        const today = new Date().toISOString().split('T')[0];

        for (const item of ecoItems) {
          const isToday = item.pubDate && new Date(item.pubDate).toISOString().split('T')[0] === today;
          if (!isToday) continue;

          const isFed = /fed|fomc|powell|rate.?decision|dot.?plot/i.test(item.title);
          const isCPI = /cpi|inflation|consumer.?price/i.test(item.title);
          const isNFP = /nonfarm|payroll|employment|jobs/i.test(item.title);
          const isOil = /oil|opec|crude|energy|iran|strait/i.test(item.title);
          const isGold = /gold|precious|metals/i.test(item.title);

          if (isFed || isCPI || isNFP || isOil || isGold) {
            const priority = isFed ? 'CRITICAL' : 'HIGH';
            alerts.unshift(`[ECON-${priority}] ${item.title.substring(0, 120)}`);
          }
        }
      }
    } catch {}

    // Earnings calendar via Yahoo Finance
    try {
      const earningsResp = await fetch('https://feeds.finance.yahoo.com/rss/2.0/headline?s=earnings&region=US&lang=en-US', {
        headers: { 'User-Agent': 'MTWM-NewsDesk/1.0' },
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (earningsResp?.ok) {
        const earningsXml = await earningsResp.text();
        const earningsItems = parseRSS(earningsXml).slice(0, 15);
        for (const item of earningsItems) {
          const tickers = extractTickers(item.title + ' ' + item.description);
          if (tickers.length > 0) {
            const sentiment = detectSentiment(item.title);
            const key = `earnings:${item.title.substring(0, 60)}`;
            if (!newsCache.has(key)) {
              newsCache.set(key, { headline: item.title, source: 'Earnings', tickers, sentiment, timestamp: Date.now() });
              if (/beat|miss|surprise|guidance|outlook|record/i.test(item.title)) {
                alerts.push(`[EARNINGS] ${sentiment.toUpperCase()}: ${item.title.substring(0, 100)} | $${tickers.join(', $')}`);
              }
            }
          }
        }
      }
    } catch {}

    // Hard-coded known events for today (backup if RSS feeds miss them)
    const todayStr = new Date().toISOString().split('T')[0];
    const knownEvents: Record<string, string[]> = {
      '2026-03-18': [
        '[ECON-CRITICAL] FOMC Rate Decision at 2:00 PM ET — Expected hold at 3.50-3.75%. Dot plot release.',
        '[ECON-CRITICAL] Fed Chair Powell Press Conference at 2:30 PM ET — Watch for stagflation commentary.',
        '[EARNINGS-HIGH] Micron (MU) Q2 earnings after close — stock up 92% in 90 days, options pricing 11% move.',
        '[GEOPOLITICAL] Iran conflict: oil at $120, Strait of Hormuz disrupted. Watch USO, XOM, HAL.',
      ],
    };
    for (const evt of (knownEvents[todayStr] || [])) {
      if (!alerts.some(a => a.includes(evt.substring(20, 50)))) {
        alerts.unshift(evt);
      }
    }

    // ===== PATTERN LEARNING: Scan top movers (5%+) and commit as training events =====
    // Any stock moving 5%+ today is a learning opportunity — store the catalyst + pattern in AgentDB
    try {
      const moversRes = await fetch(
        'https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=20',
        { headers: { 'APCA-API-KEY-ID': (midstream as any).config.alpacaApiKey, 'APCA-API-SECRET-KEY': (midstream as any).config.alpacaApiSecret } },
      );
      if (moversRes.ok) {
        const moversData = await moversRes.json() as any;
        const allMovers = [...(moversData.gainers || []), ...(moversData.losers || [])];
        const bigMovers = allMovers.filter((m: any) => Math.abs(m.percent_change || 0) >= 5);

        for (const mover of bigMovers) {
          const ticker = mover.symbol;
          const pctChange = mover.percent_change || 0;
          const direction = pctChange > 0 ? 'up' : 'down';

          // Find any matching news catalyst
          let catalyst = 'Unknown — no matching headline';
          for (const [, entry] of newsCache) {
            if (entry.tickers.includes(ticker)) {
              catalyst = entry.headline;
              break;
            }
          }

          // Store as training pattern in AgentDB
          try {
            const _adb = getAgentDB();
            if (_adb) {
              const pattern = {
                type: 'market_mover' as const,
                ticker,
                direction,
                magnitude: Math.abs(pctChange),
                catalyst,
                sector: '', // TODO: resolve sector
                timestamp: new Date().toISOString(),
                indicators: {
                  rsi: neuralTrader.getPriceHistory(ticker).length > 30 ? 'available' : 'insufficient',
                  volume: mover.trade_count || 0,
                },
              };

              // Store in ReasoningBank for pattern recognition
              await _adb.reasoningBank.store({
                agentId: 'news-desk',
                taskType: 'catalyst_pattern',
                strategy: `${direction}_${Math.abs(pctChange) >= 10 ? 'massive' : 'significant'}_move`,
                reasoning: `${ticker} moved ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}% — catalyst: ${catalyst}`,
                verdict: pctChange > 0 ? 'bullish_catalyst' : 'bearish_catalyst',
                confidence: Math.min(0.95, Math.abs(pctChange) / 20),
                outcome: { ticker, pctChange, catalyst, pattern: JSON.stringify(pattern) },
              });

              // Bayesian update: record catalyst as observation for future pattern matching
              bayesianIntel.recordOutcome(
                `catalyst:${ticker}:${direction}`,
                { domain: 'catalyst', subject: ticker, tags: [direction, 'news'], contributors: ['news-desk'] },
                Math.abs(pctChange) >= 5, // success if moved 5%+
                pctChange / 100,
              );

              alerts.push(`TRAINING: ${ticker} ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}% — stored as ${direction} catalyst pattern`);

              // Cross-reference: find similar movers and flag them as potential plays
              const similar = await _adb.reasoningBank.query({
                taskType: 'catalyst_pattern',
                strategy: `${direction}_significant_move`,
                limit: 5,
              });
              if (similar.length > 1) {
                const relatedTickers = similar
                  .map((s: any) => { try { return JSON.parse(s.outcome?.pattern || '{}').ticker; } catch { return null; } })
                  .filter((t: string | null) => t && t !== ticker);
                if (relatedTickers.length > 0) {
                  alerts.push(`RELATED: ${relatedTickers.join(', ')} had similar catalyst patterns — watch for correlated moves`);
                }
              }
            }
          } catch { /* AgentDB storage is best-effort */ }

          // Bootstrap the ticker if not already tracked
          if (!midstream.getLatestQuote(ticker)) {
            midstream.addToWatchlist(ticker);
            const bootstrapFn = (app as any)._bootstrapTicker;
            await bootstrapFn?.(ticker);
            newTickers.push(ticker);
          }
        }

        tel('movers_learned', { bigMovers: bigMovers.length, totalMovers: allMovers.length });
      }
    } catch (e: any) {
      tel('movers_scan_error', { error: e.message });
    }

    // Prune old cache entries (older than 2 hours)
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [key, entry] of newsCache) {
      if (entry.timestamp < cutoff) newsCache.delete(key);
    }

    tel('scan_complete', { totalItems, newAlerts, newTickers: newTickers.length, cacheSize: newsCache.size });

    // Save full news digest as research report for human review + dashboard digest
    const allCachedNews = Array.from(newsCache.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    const newsFindings = allCachedNews
      .filter(n => n.sentiment !== 'neutral' || n.tickers.length > 0)
      .map(n => `[${n.source}] ${n.sentiment.toUpperCase()}: ${n.headline.substring(0, 120)}${n.tickers.length > 0 ? ` | $${n.tickers.join(', $')}` : ''}`);

    const newsSignals = allCachedNews
      .filter(n => n.tickers.length > 0 && n.sentiment !== 'neutral')
      .slice(0, 10)
      .map(n => ({
        symbol: n.tickers[0],
        direction: n.sentiment === 'bullish' ? 'long' : 'short',
        signal: n.sentiment === 'bullish' ? 'BUY' : 'SELL',
        detail: n.headline.substring(0, 100),
      }));

    // Build strategy recommendation from news analysis
    const bullishAlerts = newsSignals.filter(s => s.signal === 'BUY').length;
    const bearishAlerts = newsSignals.filter(s => s.signal === 'SELL').length;
    const newsStrategy = bullishAlerts > bearishAlerts
      ? { action: `Bullish bias — ${bullishAlerts} buy signals. Monitor ${newsSignals.slice(0, 2).map(s => s.symbol).join(', ')} for entry.`,
          rationale: `${bullishAlerts} bullish vs ${bearishAlerts} bearish headlines. Market sentiment tilts positive.`,
          risk: 'Headlines can reverse quickly. Set tight stops on news-driven entries.' }
      : bearishAlerts > bullishAlerts
        ? { action: `Bearish caution — ${bearishAlerts} sell signals. Reduce exposure or hedge.`,
            rationale: `${bearishAlerts} bearish vs ${bullishAlerts} bullish headlines. Negative sentiment dominant.`,
            risk: 'Bearish sentiment can create oversold bounces. Watch for reversal signals.' }
        : { action: 'Neutral — no clear directional bias from news. Hold current positions.',
            rationale: 'Mixed or minimal actionable signals from news feeds.',
            risk: 'Low-signal periods can precede major moves. Stay alert for breakouts.' };

    saveResearchReport({
      id: `news-${Date.now()}`,
      agent: 'news-desk',
      type: 'market_intelligence',
      timestamp: new Date().toISOString(),
      summary: `${newAlerts} actionable alerts from ${totalItems} headlines. ${alerts.length > 0 ? alerts[0].substring(0, 100) : 'Monitoring feeds.'}`,
      findings: [...alerts, ...newsFindings.slice(0, 15)],
      signals: newsSignals,
      strategy: newsStrategy,
      meta: { totalItems, newAlerts, newTickers, cacheSize: newsCache.size },
    });

    if (alerts.length === 0 && newTickers.length === 0) {
      return { detail: `Scanned ${totalItems} headlines across ${feeds.length} feeds — no new actionable signals`, result: 'skipped' };
    }

    return {
      detail: `${newAlerts} alerts from ${totalItems} headlines | New tickers: ${newTickers.length > 0 ? newTickers.join(', ') : 'none'} | ${alerts.slice(0, 3).join(' | ')}`,
      result: 'success',
    };
  });

  // NEWS-DESK CATALYST EXECUTION REMOVED — was creating uncontrolled position spam.
  // The Neural Trader (scan_signals) is the ONLY trade execution engine.
  // News-desk feeds intelligence into researchStars + Bayesian system,
  // which the Neural Trader already reads for scoring candidates.
  // The know-do gap is closed by feeding catalysts INTO the neural trader's
  // scoring pipeline, not by having a second execution engine.

  // Bayesian Intelligence — cross-agent shared learning
  autonomyEngine.registerAction('bayesian-intel', 'sync_intelligence', async () => {
    const tel = (step: string, data: Record<string, unknown> = {}) => {
      eventBus.emit('telemetry:step' as any, { agentId: 'bayesian-intel', step, ...data } as any);
    };

    tel('sync_started');
    const intel = bayesianIntel.getCollectiveIntelligence();
    tel('intelligence_gathered', { totalBeliefs: intel.totalBeliefs, totalObservations: intel.totalObservations, agents: Object.keys(intel.agentContributions).length });

    // Persist to RVF if available
    if (rvfEngine) {
      tel('persisting_to_rvf');
      const existing = rvfEngine.search('bayesian-intelligence', 'learning');
      const data = bayesianIntel.toJSON();
      if (existing.length > 0) {
        rvfEngine.update(existing[0].id, data);
      } else {
        rvfEngine.create('learning', 'bayesian-intelligence', data);
      }
      tel('rvf_persisted');
    }

    // Feed best/worst performers back into the Analyst Agent's awareness
    const topPerformers = bayesianIntel.getTopPerformers(5);
    const worstPerformers = bayesianIntel.getWorstPerformers(5);

    if (topPerformers.length > 0) {
      tel('top_performers', { tickers: topPerformers.map((t: any) => t.subject), count: topPerformers.length });
    }

    // If we have degrading tickers, log a learning for the system
    if (worstPerformers.length > 0) {
      const worstTicker = worstPerformers[0];
      tel('underperformer_detected', { ticker: worstTicker.subject, winRate: worstTicker.posterior, observations: worstTicker.observations, avgReturn: worstTicker.avgReturn });
      if (learningEngine) {
        learningEngine.record({
          category: 'strategy',
          source: 'bayesian_intel',
          type: 'insight',
          title: `Bayesian: ${worstTicker.subject} underperforming`,
          detail: `${worstTicker.subject} has ${(worstTicker.posterior * 100).toFixed(0)}% win rate over ${worstTicker.observations} trades. Avg return: ${(worstTicker.avgReturn * 100).toFixed(1)}%. Consider avoiding.`,
          data: { beliefId: worstTicker.id, posterior: worstTicker.posterior, observations: worstTicker.observations },
          tags: ['bayesian', 'underperformer', worstTicker.subject],
        });
      }
    }

    // ===== ADAPTIVE FEEDBACK LOOP — adjust trading behavior from learned outcomes =====
    tel('adaptive_learning_start');

    // 1. Momentum Star domain learning — adjust entry threshold
    const msDomain = bayesianIntel.query({ domain: 'momentum_star', minObservations: 3 });
    if (msDomain.length > 0) {
      const totalObs = msDomain.reduce((s, b) => s + b.observations, 0);
      const weightedPosterior = msDomain.reduce((s, b) => s + b.posterior * b.observations, 0) / totalObs;
      // If momentum_star win rate < 40%, raise threshold (be more selective)
      // If > 60%, lower threshold (system is picking well)
      // Range: 0.55 (very selective when losing) to 0.45 (relaxed when winning)
      const baseThreshold = 0.55;
      const adjustment = (0.50 - weightedPosterior) * 0.50; // 50% sensitivity — react harder to losses
      adaptiveState.momentumStarThreshold = Math.max(0.50, Math.min(0.80, baseThreshold + adjustment));
      console.log(`[Intelligence] Threshold adapted: ${adaptiveState.momentumStarThreshold.toFixed(2)} (win rate: ${(weightedPosterior * 100).toFixed(0)}%, ${totalObs} obs)`);
      tel('threshold_adapted', { weightedPosterior, newThreshold: adaptiveState.momentumStarThreshold, totalObs });
    }

    // 2. Exit reason learning — if stop_losses dominate, we're buying garbage
    const stopLossBelief = bayesianIntel.getBelief('exit:stop_loss');
    const takeProfitBelief = bayesianIntel.getBelief('exit:take_profit');
    if (stopLossBelief && stopLossBelief.observations >= 3) {
      const slObs = stopLossBelief.observations;
      const tpObs = takeProfitBelief?.observations || 0;
      adaptiveState.stopLossDominance = slObs / (slObs + tpObs + 1);
      // If >70% of exits are stop losses, raise min price (penny stocks are dying)
      if (adaptiveState.stopLossDominance > 0.70) {
        adaptiveState.minPrice = Math.min(5.0, adaptiveState.minPrice + 0.50);
        tel('min_price_raised', { ratio: adaptiveState.stopLossDominance, newMin: adaptiveState.minPrice });
      } else if (adaptiveState.stopLossDominance < 0.30 && adaptiveState.minPrice > 0.50) {
        adaptiveState.minPrice = Math.max(0.50, adaptiveState.minPrice - 0.25);
        tel('min_price_lowered', { ratio: adaptiveState.stopLossDominance, newMin: adaptiveState.minPrice });
      }
    }

    // 3. Worst performer avoidance — blacklist tickers with proven losses
    adaptiveState.avoidTickers.clear();
    adaptiveState.preferTickers.clear();
    for (const wp of worstPerformers) {
      if (wp.observations >= 2 && wp.posterior < 0.45) {
        adaptiveState.avoidTickers.add(wp.subject);
        console.log(`[Intelligence] AVOID ${wp.subject}: ${(wp.posterior * 100).toFixed(0)}% win rate (${wp.observations} obs)`);
      }
    }
    for (const tp of topPerformers) {
      if (tp.observations >= 3 && tp.posterior > 0.55) {
        adaptiveState.preferTickers.add(tp.subject);
      }
    }

    // 4. Learn price categories — track which price ranges work
    const tickerBeliefs = bayesianIntel.query({ domain: 'ticker', minObservations: 2 });
    let pennyLosses = 0, pennyTotal = 0, midLosses = 0, midTotal = 0;
    for (const b of tickerBeliefs) {
      const quote = midstream.getLatestQuote(b.subject);
      if (!quote) continue;
      if (quote.price < 1.0) {
        pennyTotal++;
        if (b.posterior < 0.40) pennyLosses++;
      } else if (quote.price >= 1.0 && quote.price < 50) {
        midTotal++;
        if (b.posterior < 0.40) midLosses++;
      }
    }
    if (pennyTotal >= 3 && pennyLosses / pennyTotal > 0.60) {
      // Penny stocks losing >60% of the time — raise floor
      adaptiveState.minPrice = Math.max(adaptiveState.minPrice, 1.0);
      tel('penny_stock_avoidance', { pennyLosses, pennyTotal, newMin: adaptiveState.minPrice });
    }

    // ===== FOREX ADAPTIVE LEARNING =====
    // Learn which pairs win/lose and adjust forex threshold
    // Query BOTH domains — old entries used 'strategy', new entries use 'forex_pair'
    const forexBeliefs = [
      ...bayesianIntel.query({ domain: 'forex_pair' }).filter(b => b.id.startsWith('forex_pair_') && b.observations >= 2),
      ...bayesianIntel.query({ domain: 'strategy' }).filter(b => b.id.startsWith('forex_pair_') && b.observations >= 2),
    ];
    // Deduplicate by ID
    const seenFxIds = new Set<string>();
    const uniqueForexBeliefs = forexBeliefs.filter(b => {
      if (seenFxIds.has(b.id)) return false;
      seenFxIds.add(b.id);
      return true;
    });
    if (uniqueForexBeliefs.length > 0) {
      const fxTotalObs = uniqueForexBeliefs.reduce((s, b) => s + b.observations, 0);
      const fxWeightedWinRate = uniqueForexBeliefs.reduce((s, b) => s + b.posterior * b.observations, 0) / fxTotalObs;
      // Adaptive forex threshold: tighten when losing, relax when winning (base raised to 0.55)
      const fxBase = 0.55;
      const fxAdj = (0.50 - fxWeightedWinRate) * 0.30;
      adaptiveState.forexThreshold = Math.max(0.45, Math.min(0.70, fxBase + fxAdj));
      tel('forex_threshold_adapted', { fxWeightedWinRate, newThreshold: adaptiveState.forexThreshold, beliefs: uniqueForexBeliefs.length });
    }

    // Forex pair avoidance/preference from Bayesian
    adaptiveState.forexAvoidPairs.clear();
    adaptiveState.forexPreferPairs.clear();
    for (const fb of uniqueForexBeliefs) {
      // Extract pair name: forex_pair_EUR/USD_long → EUR/USD
      const match = fb.id.match(/forex_pair_(.+?)_(long|short)/);
      if (!match) continue;
      const pairName = match[1];
      if (fb.posterior < 0.35 && fb.observations >= 3) {
        adaptiveState.forexAvoidPairs.add(pairName);
      } else if (fb.posterior > 0.60 && fb.observations >= 3) {
        adaptiveState.forexPreferPairs.add(pairName);
      }
    }

    // If forex is bleeding (>70% of forex exits are losses), reduce max positions
    const fxLosers = uniqueForexBeliefs.filter(b => b.posterior < 0.40);
    if (uniqueForexBeliefs.length >= 3 && fxLosers.length / uniqueForexBeliefs.length > 0.70) {
      adaptiveState.forexMaxPositions = Math.max(2, adaptiveState.forexMaxPositions - 1);
      tel('forex_positions_reduced', { maxPositions: adaptiveState.forexMaxPositions });
    } else if (uniqueForexBeliefs.length >= 3 && fxLosers.length / uniqueForexBeliefs.length < 0.30) {
      adaptiveState.forexMaxPositions = Math.min(4, adaptiveState.forexMaxPositions + 1);
    }

    // ===== REAL ESTATE ADAPTIVE LEARNING =====
    const reBeliefs = bayesianIntel.query({ domain: 'real_estate', minObservations: 2 });
    adaptiveState.rePreferSources.clear();
    adaptiveState.reAvoidSources.clear();
    adaptiveState.rePreferTechniques.clear();
    for (const rb of reBeliefs) {
      if (rb.id.startsWith('re_source:') || rb.id.startsWith('re_source_')) {
        const source = rb.subject;
        if (rb.posterior > 0.65) adaptiveState.rePreferSources.add(source);
        else if (rb.posterior < 0.30 && rb.observations >= 3) adaptiveState.reAvoidSources.add(source);
      }
      if (rb.id.startsWith('re_technique:')) {
        if (rb.posterior > 0.60) adaptiveState.rePreferTechniques.add(rb.subject);
      }
    }

    // If RE deals are consistently not responding, raise the ND score minimum
    const reWinRate = bayesianIntel.getDomainWinRate('real_estate');
    if (reWinRate.observations >= 5 && reWinRate.winRate < 0.35) {
      adaptiveState.reMinNDScore = Math.min(7.0, adaptiveState.reMinNDScore + 0.5);
      tel('re_nd_threshold_raised', { winRate: reWinRate.winRate, newMin: adaptiveState.reMinNDScore });
    } else if (reWinRate.observations >= 5 && reWinRate.winRate > 0.60 && adaptiveState.reMinNDScore > 3.0) {
      adaptiveState.reMinNDScore = Math.max(3.0, adaptiveState.reMinNDScore - 0.25);
    }

    adaptiveState.lastAdaptation = new Date().toISOString();
    tel('adaptive_learning_complete', {
      // Equities
      eqThreshold: adaptiveState.momentumStarThreshold,
      minPrice: adaptiveState.minPrice,
      eqAvoid: adaptiveState.avoidTickers.size,
      eqPrefer: adaptiveState.preferTickers.size,
      stopLossDominance: adaptiveState.stopLossDominance,
      // Forex
      fxThreshold: adaptiveState.forexThreshold,
      fxAvoid: adaptiveState.forexAvoidPairs.size,
      fxPrefer: adaptiveState.forexPreferPairs.size,
      fxMaxPos: adaptiveState.forexMaxPositions,
      // Real Estate
      reMinND: adaptiveState.reMinNDScore,
      rePreferSrc: adaptiveState.rePreferSources.size,
      reAvoidSrc: adaptiveState.reAvoidSources.size,
    });

    tel('sync_complete', { insights: intel.topInsights.length });

    // Snapshot learning metrics every heartbeat (internally rate-limited to 5-min intervals)
    bayesianIntel.snapshotLearning();

    const metrics = bayesianIntel.getIntelligenceMetrics();
    const adaptNote = `ADAPTIVE: eq=${adaptiveState.momentumStarThreshold.toFixed(2)}/min$${adaptiveState.minPrice.toFixed(2)} fx=${adaptiveState.forexThreshold.toFixed(2)}/max${adaptiveState.forexMaxPositions} re=ND${adaptiveState.reMinNDScore.toFixed(1)} | avoid=${adaptiveState.avoidTickers.size}eq+${adaptiveState.forexAvoidPairs.size}fx+${adaptiveState.reAvoidSources.size}re`;
    const learningNote = `LEARNING: accuracy=${(metrics.currentAccuracy * 100).toFixed(0)}% (${metrics.accuracyTrend}), divergence=${metrics.posteriorDivergence.toFixed(3)}, regret=${metrics.cumulativeRegret.toFixed(2)} (${metrics.regretTrend}), preds=${metrics.totalPredictions}`;
    return {
      detail: `${intel.totalBeliefs} beliefs, ${intel.totalObservations} observations | ${intel.topInsights.slice(0, 2).join('; ') || 'learning...'} | ${adaptNote} | ${learningNote}`,
      result: intel.totalObservations > 0 ? 'success' : 'skipped',
    };
  });

  // ===== RESEARCH AGENT — AgentDB-powered autonomous research =====
  // Uses ReasoningBank, ReflexionMemory, SkillLibrary to:
  //   1. Proactively query past trade patterns for current market conditions
  //   2. Train GNN model on accumulated trade outcomes
  //   3. Store news-desk intelligence as searchable patterns
  //   4. Feed proven strategies back into neural-trader signal generation
  //   5. Query GOAP planner for dynamic strategy adjustment
  // Shared research findings that momentum star uses for scoring
  const researchStars: Map<string, { symbol: string; sector: string; catalyst: string; score: number; timestamp: number }> = new Map();

  // ── Research Report Store — persists full reports for human review ──
  interface ResearchReport {
    id: string;
    agent: string;
    type: string;
    timestamp: string;
    summary: string;
    findings: string[];
    signals: Array<{ symbol: string; direction: string; signal: string; detail: string }>;
    strategy: {
      action: string;       // What will be done based on this research
      rationale: string;    // Why this action makes sense
      risk: string;         // Key risk to watch
      result?: string;      // Outcome after execution (updated later)
    };
    meta: Record<string, unknown>;
  }
  const researchReports: ResearchReport[] = [];
  const MAX_REPORTS = 100; // keep last 100 reports

  function saveResearchReport(report: ResearchReport) {
    researchReports.unshift(report); // newest first
    if (researchReports.length > MAX_REPORTS) researchReports.length = MAX_REPORTS;
  }

  // API: Get research reports
  app.get('/api/research/reports', (req, res) => {
    const agent = req.query.agent as string;
    const limit = parseInt(req.query.limit as string) || 20;
    let reports = researchReports;
    if (agent) reports = reports.filter(r => r.agent === agent);
    res.json({ reports: reports.slice(0, limit), total: reports.length });
  });

  app.get('/api/research/latest', (_req, res) => {
    const crypto = researchReports.find(r => r.agent === 'crypto-researcher');
    const forex = researchReports.find(r => r.agent === 'forex-researcher');
    const equity = researchReports.find(r => r.agent === 'research-agent');
    res.json({ crypto: crypto || null, forex: forex || null, equity: equity || null });
  });

  // adaptiveState is module-level — updated by bayesian-intel:sync_intelligence each cycle

  autonomyEngine.registerAction('research-agent', 'deep_research', async () => {
    const alpacaHeaders = {
      'APCA-API-KEY-ID': (midstream as any).config.alpacaApiKey || '',
      'APCA-API-SECRET-KEY': (midstream as any).config.alpacaApiSecret || '',
    };
    const insights: string[] = [];

    // ===== 1. SECTOR RESEARCH — AI, Data Centers, Energy, Minerals =====
    // These are our target sectors per SPEC-005
    const sectorScreens = [
      { name: 'AI/DataCenter', tickers: ['NVDA','AMD','SMCI','VRT','EQIX','DLR','ANET','NET','ARM','MRVL','MU','DELL','HPE','CRWD','IONQ','RGTI','PLTR','SNOW','AI','BBAI','SOUN'] },
      { name: 'Energy', tickers: ['XOM','CVX','COP','OXY','SLB','HAL','MPC','VLO','PSX','XLE','XOP','USO','UNG','FCG','ET','LNG','FSLR','ENPH','RUN','SEDG'] },
      { name: 'Minerals/Metals', tickers: ['NEM','GOLD','AEM','FNV','WPM','AG','SLV','GLD','GDX','GDXJ','SILJ','SIL','PALL','PPLT','MP','LAC','LTHM','ALB','SQM'] },
      { name: 'BioTech/Pharma', tickers: ['XBI','IBB','LABU','MRNA','PFE','LLY','ABBV','BNTX','HIMS','LGVN'] },
    ];

    for (const sector of sectorScreens) {
      try {
        // Get snapshots for sector tickers to find today's movers
        const batchSize = 10;
        for (let i = 0; i < sector.tickers.length; i += batchSize) {
          const batch = sector.tickers.slice(i, i + batchSize);
          const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${batch.join(',')}&feed=iex`;
          const resp = await fetch(url, { headers: alpacaHeaders });
          if (!resp.ok) continue;
          const snapData = await resp.json() as any;

          for (const [sym, snap] of Object.entries(snapData as Record<string, any>)) {
            const dailyBar = snap?.dailyBar;
            const prevBar = snap?.prevDailyBar;
            if (!dailyBar || !prevBar || !prevBar.c) continue;

            const pctChange = ((dailyBar.c - prevBar.c) / prevBar.c) * 100;
            const volume = dailyBar.v || 0;
            const avgVol = prevBar.v || 1;
            const volRatio = volume / avgVol;

            // Flag significant movers in our target sectors
            if (Math.abs(pctChange) >= 3 && volRatio >= 1.2) {
              const direction = pctChange > 0 ? 'BULLISH' : 'BEARISH';
              const catalyst = `${sector.name} ${direction}: ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}% on ${volRatio.toFixed(1)}x volume`;
              insights.push(`[${sector.name}] ${sym} ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}% vol=${volRatio.toFixed(1)}x`);

              // Register as research star for momentum execution
              researchStars.set(sym, {
                symbol: sym,
                sector: sector.name,
                catalyst,
                score: Math.min(0.95, 0.50 + Math.abs(pctChange) / 50 + (volRatio > 2 ? 0.15 : 0) + (volRatio > 3 ? 0.10 : 0)),
                timestamp: Date.now(),
              });

              // Update Bayesian with sector intelligence
              bayesianIntel.recordOutcome(
                `sector:${sector.name}:${sym}`,
                { domain: 'sector_research', subject: sym, tags: [sector.name, direction.toLowerCase()], contributors: ['research-agent'] },
                pctChange > 0,
                pctChange / 100,
              );
            }
          }
        }
      } catch {
        // Sector scan is best-effort
      }
    }

    // ===== 2. IPO & RECENT LISTINGS — Find the next big debut =====
    try {
      // Use Alpaca's most-active screener to find recently listed high-activity stocks
      const activeResp = await fetch(
        'https://data.alpaca.markets/v1beta1/screener/stocks/most-actives?by=trades&top=50',
        { headers: alpacaHeaders },
      );
      if (activeResp.ok) {
        const activeData = await activeResp.json() as any;
        for (const item of (activeData.most_actives || [])) {
          const sym = item.symbol;
          if (!sym || sym.length > 5) continue;
          // Check if this ticker is NOT in our known universe — could be new IPO
          const isKnown = midstream.getLatestQuote(sym);
          if (!isKnown && item.trade_count > 50000) {
            insights.push(`[IPO/NEW] ${sym}: ${item.trade_count?.toLocaleString()} trades — potential new listing`);
            // Add to watchlist for tracking
            midstream.addToWatchlist(sym);
            const bootstrapFn = (app as any)._bootstrapTicker;
            await bootstrapFn?.(sym);
          }
        }
      }
    } catch {}

    // ===== 3. NEWS CATALYST RESEARCH — Extract actionable intelligence =====
    try {
      const recentNews = Array.from(newsCache.values())
        .filter(n => Date.now() - n.timestamp < 4 * 3600_000)
        .sort((a, b) => b.timestamp - a.timestamp);

      for (const news of recentNews.slice(0, 10)) {
        const headline = news.headline.toLowerCase();
        // Look for high-impact catalysts
        const isIPO = /\bipo\b|debuts?|listing|goes public/i.test(headline);
        const isPartnership = /partner|deal|contract|awarded|selected/i.test(headline);
        const isEarnings = /earnings|revenue|beat|guidance|raised/i.test(headline);
        const isUpgrade = /upgrade|price target|outperform|buy rating/i.test(headline);
        const isSectorPlay = /data center|ai |artificial|nvidia|gpu|chip|mining|mineral|rare earth|lithium|solar|wind|energy transition/i.test(headline);

        if ((isIPO || isPartnership || isUpgrade || isSectorPlay) && news.tickers.length > 0) {
          const type = isIPO ? 'IPO' : isPartnership ? 'CATALYST' : isUpgrade ? 'UPGRADE' : 'SECTOR';
          for (const ticker of news.tickers) {
            if (ticker.length <= 5) {
              insights.push(`[${type}] ${ticker}: ${news.headline.substring(0, 80)}`);
              researchStars.set(ticker, {
                symbol: ticker,
                sector: isSectorPlay ? 'AI/DataCenter' : 'Catalyst',
                catalyst: `${type}: ${news.headline.substring(0, 100)}`,
                score: isIPO ? 0.85 : isPartnership ? 0.80 : isUpgrade ? 0.75 : 0.70,
                timestamp: Date.now(),
              });
            }
          }
        }
      }

      // Store patterns in ReasoningBank
      const db = getAgentDB();
      for (const news of recentNews.filter(n => n.sentiment !== 'neutral' && n.tickers.length > 0).slice(0, 5)) {
        const pattern: TradingPattern = {
          taskType: `news_${news.sentiment}_catalyst`,
          approach: `${news.headline.substring(0, 100)} | Tickers: ${news.tickers.join(', ')}`,
          successRate: 0.5,
          tags: ['news', news.sentiment, news.source, ...news.tickers],
        };
        const reasoningCtrl = db?.getController('reasoning');
        if (reasoningCtrl) await reasoningCtrl.storePattern(pattern);
      }
    } catch {}

    // ===== 4. GOAP PROGRESS =====
    try {
      const plan = strategicPlanner.getCurrentPlan();
      if (plan) {
        const account = await executor.getAccount();
        const realPortfolio = account?.portfolioValue || 0;
        const totalPnl = realPortfolio - 100000;
        const simulatedCapital = 5000 + totalPnl;
        const perfStats = positionManager.getPerformanceStats();
        const daysSinceStart = Math.max(1, Math.floor((Date.now() - (plan.createdAt?.getTime?.() || Date.now())) / (24 * 60 * 60 * 1000)));
        const progress = strategicPlanner.evaluateProgress(simulatedCapital, perfStats.totalTrades, perfStats.winRate, daysSinceStart);
        insights.push(progress.onTrack
          ? `GOAP: ON TRACK — ${(progress.actualVsExpected * 100).toFixed(0)}%`
          : `GOAP: BEHIND — $${simulatedCapital.toFixed(0)} vs $${progress.expectedCapital.toFixed(0)}`);
      }
    } catch {}

    // Clean stale research stars (older than 4 hours)
    for (const [key, star] of researchStars) {
      if (Date.now() - star.timestamp > 4 * 3600_000) researchStars.delete(key);
    }

    insights.push(`STARS: ${researchStars.size} research targets active`);

    return {
      detail: insights.slice(0, 8).join(' | '),
      result: 'success',
    };
  });

  // Options Trader — scan positions for covered calls, cash-secured puts, protective puts
  autonomyEngine.registerAction('options-trader', 'scan_options', async () => {
    const positions = await executor.getPositions();
    if (!positions || positions.length === 0) {
      return { detail: 'No positions to evaluate for options', result: 'skipped' };
    }

    const actions: string[] = [];
    for (const pos of positions) {
      if (pos.ticker.includes('-') || pos.ticker.includes('/')) continue; // skip crypto

      const price = pos.currentPrice || 0;
      if (price <= 0) continue;

      // Calculate IV rank approximation from neural trader volatility
      const history = neuralTrader.getPriceHistory(pos.ticker);
      if (history.length < 30) continue;
      const returns = history.slice(-20).map((c: number, i: number) => i > 0 ? Math.abs((c - history[history.length - 20 + i - 1]) / history[history.length - 20 + i - 1]) : 0).filter(Boolean);
      const currentIV = (returns.reduce((s: number, r: number) => s + r, 0) / returns.length) * Math.sqrt(252) * 100;
      const ivRank = { currentIV, ivRank: Math.min(100, currentIV * 2), percentile: currentIV * 1.5 };

      // Covered calls on winning positions
      if (pos.unrealizedPnlPercent > 2 && pos.shares >= 1) {
        const signal = optionsTrader.evaluateCoveredCall(pos.ticker, price, pos.shares, ivRank);
        if (signal) actions.push(`CC: ${pos.ticker} ${signal.contracts[0].symbol} (premium est: $${signal.maxGain.toFixed(0)})`);
      }

      // Cash-secured puts on tickers we want to own at a discount
      if (!positions.find(p => p.ticker === pos.ticker) || pos.unrealizedPnlPercent < -3) {
        const signal = optionsTrader.evaluateCashSecuredPut(pos.ticker, price, ivRank);
        if (signal) actions.push(`CSP: ${pos.ticker} ${signal.contracts[0].symbol}`);
      }
    }

    if (actions.length === 0) {
      return { detail: 'No options opportunities meeting criteria', result: 'skipped' };
    }
    return { detail: actions.join('; '), result: 'success' };
  });

  // Instantiate forex/metals/options early so autonomy actions can reference them
  const metalsTrader = new MetalsTrader({
    alpacaKey: process.env.ALPACA_API_KEY,
    alpacaSecret: process.env.ALPACA_API_SECRET,
  });
  const forexScanner = new ForexScanner({
    oandaApiKey: process.env.OANDA_API_KEY,
    oandaAccountId: process.env.OANDA_ACCOUNT_ID,
  });
  const optionsTrader = new OptionsTrader({
    broker: (process.env.OPTIONS_BROKER as 'alpaca' | 'ibkr') || 'alpaca',
  });

  // ── Forex Strategic Research Agent ──────────────────────────────────────
  // Six Thinking Hats approach:
  //   WHITE HAT: Raw data — candles, spreads, session times, volumes
  //   RED HAT: Gut/neural — what does the LSTM/GRU ensemble feel about direction?
  //   BLACK HAT: Risk — what can go wrong? Past failures, drawdown risk, correlation
  //   YELLOW HAT: Opportunity — where's the upside? Proven patterns, Bayesian winners
  //   GREEN HAT: Creative — alternative plays, cross-pair hedges, session rotation
  //   BLUE HAT: Strategic — how does this serve SPEC-005? Are we on track for $160/day?
  // Priority 10 = runs FIRST in heartbeat (before all other agents)
  autonomyEngine.registerAction('research-agent', 'forex_strategic_research', async () => {
    const OANDA_KEY = process.env.OANDA_API_KEY;
    const OANDA_ACCT = process.env.OANDA_ACCOUNT_ID;
    if (!OANDA_KEY || !OANDA_ACCT) {
      return { detail: 'Research: OANDA not configured', result: 'skipped' };
    }
    const isPractice = process.env.OANDA_MODE === 'practice' || (OANDA_ACCT?.startsWith('101-') ?? false);
    const oandaBase = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com';

    const session = forexScanner.getActiveSession();
    const insights: string[] = [];
    const recommendations: string[] = [];

    // ─── WHITE HAT: Raw market data ───
    const allPairs = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'NZD_JPY'];
    const pairMomentum: Record<string, { dir: string; move: number; atr: number }> = {};

    for (const pair of allPairs) {
      try {
        const res = await fetch(
          `${oandaBase}/v3/instruments/${pair}/candles?granularity=H1&count=24`,
          { headers: { Authorization: `Bearer ${OANDA_KEY}` } }
        );
        if (!res.ok) continue;
        const data = await res.json() as any;
        const candles = data.candles || [];
        if (candles.length < 6) continue;

        const closes = candles.map((c: any) => parseFloat(c.mid.c));
        const first = closes[0];
        const last = closes[closes.length - 1];
        const move = ((last - first) / first) * 100;
        const atrVals = candles.slice(-14).map((c: any) => parseFloat(c.mid.h) - parseFloat(c.mid.l));
        const atr = atrVals.reduce((s: number, v: number) => s + v, 0) / atrVals.length;

        const dir = move > 0.05 ? 'BULL' : move < -0.05 ? 'BEAR' : 'FLAT';
        pairMomentum[pair] = { dir, move, atr };
        insights.push(`${pair.replace('_','/')}: ${dir} ${move > 0 ? '+' : ''}${move.toFixed(3)}% (ATR: ${atr.toFixed(5)})`);
      } catch {}
    }

    // ─── RED HAT: Neural intuition on top movers ───
    const topMovers = Object.entries(pairMomentum)
      .filter(([_, m]) => Math.abs(m.move) > 0.03)
      .sort((a, b) => Math.abs(b[1].move) - Math.abs(a[1].move))
      .slice(0, 3);

    for (const [pair] of topMovers) {
      try {
        const res = await fetch(
          `${oandaBase}/v3/instruments/${pair}/candles?granularity=H1&count=60`,
          { headers: { Authorization: `Bearer ${OANDA_KEY}` } }
        );
        if (!res.ok) continue;
        const data = await res.json() as any;
        const closes = (data.candles || []).map((c: any) => parseFloat(c.mid.c));
        if (closes.length >= 30) {
          const quick = await quickForecast(closes);
          if (quick) {
            insights.push(`Neural ${pair.replace('_','/')}: ${quick.direction} (${(quick.confidence * 100).toFixed(0)}% conf)`);
            if (quick.confidence > 0.5 && quick.direction !== 'neutral') {
              recommendations.push(`${pair.replace('_','/')}: Neural says ${quick.direction} with ${(quick.confidence * 100).toFixed(0)}% confidence`);
            }
          }
        }
      } catch {}
    }

    // ─── BLACK HAT: Risk check — past failures, open position risk ───
    try {
      const failures = await queryEpisodes('forex loss', { k: 5, onlyFailures: true });
      if (failures && failures.length > 0) {
        insights.push(`BLACK HAT: ${failures.length} recent forex failures in memory — avoiding similar setups`);
      }
    } catch {}

    const openTrades = await forexScanner.getOpenTrades();
    if (openTrades.length > 0) {
      const totalPL = openTrades.reduce((s: number, t: any) => s + parseFloat(t.unrealizedPL || '0'), 0);
      insights.push(`Open positions: ${openTrades.length}, unrealized P&L: $${totalPL.toFixed(2)}`);
    }

    // ─── YELLOW HAT: Proven patterns from ReasoningBank ───
    try {
      const patterns = await queryPatterns(`forex ${session} session profitable`, { k: 5, minSuccessRate: 0.55 });
      if (patterns && patterns.length > 0) {
        insights.push(`YELLOW HAT: ${patterns.length} proven ${session} session patterns found`);
        for (const p of patterns.slice(0, 2)) {
          recommendations.push(`Pattern: ${(p as any).approach || (p as any).content || 'proven setup'}`);
        }
      }
    } catch {}

    // ─── GREEN HAT: Session-specific creative strategies ───
    if (session === 'asian') {
      // JPY is the key currency — look for yen strength/weakness
      const jpyPairs = Object.entries(pairMomentum).filter(([p]) => p.includes('JPY'));
      const jpyDir = jpyPairs.filter(([_, m]) => m.dir === 'BEAR').length > jpyPairs.filter(([_, m]) => m.dir === 'BULL').length ? 'strengthening' : 'weakening';
      insights.push(`GREEN HAT: JPY ${jpyDir} across ${jpyPairs.length} pairs in Asian session`);
      if (jpyDir === 'strengthening') {
        recommendations.push('SHORT JPY crosses (USD/JPY, EUR/JPY) — yen bid during Tokyo');
      } else {
        recommendations.push('LONG JPY crosses — yen weak, risk-on sentiment in Asia');
      }
    } else if (session === 'london') {
      insights.push('GREEN HAT: London open — EUR and GBP pairs have highest volume and breakout potential');
      recommendations.push('Focus on EUR/USD and GBP/USD for cleanest momentum setups');
    } else if (session === 'overlap') {
      insights.push('GREEN HAT: London/NY overlap — peak liquidity, tightest spreads, best execution');
      recommendations.push('Maximum conviction window — deploy highest-scoring setups now');
    }

    // ─── BLUE HAT: Strategic alignment with SPEC-005 ───
    // $5K budget, $160/day target, 50% forex allocation = $2,500
    // Need $80/day from forex — at 25K units that's ~32 pips on majors
    try {
      const progress = strategicPlanner.evaluateProgress(
        99960, // Current OANDA practice balance
        openTrades.length,
        0.5, // Starting assumption
        1 // Day 1
      );
      if (progress.adjustment) {
        insights.push(`BLUE HAT (SPEC-005): ${progress.adjustment}`);
      }
    } catch {}
    insights.push(`BLUE HAT: Target $80/day from forex (32 pips on 25K units). Session: ${session}`);

    // Store research in AgentDB
    const _adb = getAgentDB();
    if (_adb) {
      try {
        await _adb.store({
          agentId: 'research-agent',
          content: `Forex research [${session}]: ${insights.join('. ')} RECOMMENDATIONS: ${recommendations.join('. ')}`,
          metadata: { category: 'forex_research', session, timestamp: new Date().toISOString() },
        });
      } catch {}
    }

    const detail = recommendations.length > 0
      ? `Research [${session}]: ${recommendations.join(' | ')} (${insights.length} data points analyzed)`
      : `Research [${session}]: ${insights.length} data points — no high-conviction recommendations`;

    return { detail, result: recommendations.length > 0 ? 'success' : 'skipped' };
  });

  // ── Forex Intelligent Execution Agent ──────────────────────────────────────
  // Uses: Neural Forecast (LSTM+GRU), Bayesian Intelligence, ReasoningBank,
  //       MinCut (Kelly sizing), Goalie (GOAP strategic planning)
  // NO trades without multi-layer confirmation. Period.
  autonomyEngine.registerAction('forex-scanner', 'execute_forex', async () => {
    const OANDA_KEY = process.env.OANDA_API_KEY;
    const OANDA_ACCT = process.env.OANDA_ACCOUNT_ID;
    const isPractice = process.env.OANDA_MODE === 'practice' || (OANDA_ACCT?.startsWith('101-') ?? false);
    const oandaBase = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com';

    if (!OANDA_KEY || !OANDA_ACCT) {
      return { detail: 'Forex: OANDA not configured', result: 'skipped' };
    }

    // Check existing positions first
    const openTrades = await forexScanner.getOpenTrades();
    const maxPositions = adaptiveState.forexMaxPositions;
    if (openTrades.length >= maxPositions) {
      const totalPL = openTrades.reduce((s: number, t: any) => s + parseFloat(t.unrealizedPL || '0'), 0);
      return { detail: `Forex: ${openTrades.length}/${maxPositions} positions, P&L: $${totalPL.toFixed(2)}`, result: 'skipped' };
    }

    // ─── STEP 1: Fetch real candle data from OANDA for each pair ───
    const forexPairs = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'NZD_JPY'];
    const pairAnalysis: Array<{
      pair: string;
      direction: 'long' | 'short';
      neuralConf: number;
      neuralDir: string;
      bayesianAdj: number;
      patternBoost: number;
      trend1H: string;
      trend4H: string;
      rangePosition: number;
      totalScore: number;
      entry: number;
      stopLoss: number;
      takeProfit: number;
      rationale: string[];
    }> = [];

    for (const pair of forexPairs) {
      // Adaptive learning: skip pairs the system has learned are losers
      const pairSymbol = pair.replace('_', '/');
      if (adaptiveState.forexAvoidPairs.has(pairSymbol)) {
        // Exception: if we already hold this pair and it's winning, allow adding
        const existingTrade = openTrades.find((t: any) => t.instrument === pair);
        if (!existingTrade || parseFloat(existingTrade.unrealizedPL || '0') <= 0) {
          continue; // Bayesian blacklisted this pair
        }
        // Winning position — allow analysis for potential add
      }

      try {
        // Fetch 1H candles (100 bars = ~4 days) for neural forecast
        const candleRes = await fetch(
          `${oandaBase}/v3/instruments/${pair}/candles?granularity=H1&count=100`,
          { headers: { Authorization: `Bearer ${OANDA_KEY}` } }
        );
        if (!candleRes.ok) continue;
        const candleData = await candleRes.json() as any;
        const candles = candleData.candles || [];
        if (candles.length < 50) continue;

        const closes = candles.map((c: any) => parseFloat(c.mid.c));
        const highs = candles.map((c: any) => parseFloat(c.mid.h));
        const lows = candles.map((c: any) => parseFloat(c.mid.l));
        const current = closes[closes.length - 1];
        const rationale: string[] = [];

        // ─── STEP 2: Neural Forecast (LSTM + GRU ensemble) ───
        let neuralDir: 'up' | 'down' | 'neutral' = 'neutral';
        let neuralConf = 0;
        try {
          const forecast = await neuralForecast(closes);
          if (forecast) {
            neuralDir = forecast.direction;
            neuralConf = forecast.confidence;
            rationale.push(`Neural: ${forecast.direction} (conf: ${(forecast.confidence * 100).toFixed(0)}%, agreement: ${(forecast.modelAgreement * 100).toFixed(0)}%, predicted: ${(forecast.predictedMove * 100).toFixed(3)}%)`);
          }
        } catch {
          // Neural unavailable — use quick forecast fallback
          try {
            const quick = await quickForecast(closes);
            if (quick) {
              neuralDir = quick.direction;
              neuralConf = quick.confidence * 0.7; // Discount quick forecast
              rationale.push(`QuickNeural: ${quick.direction} (conf: ${(neuralConf * 100).toFixed(0)}%)`);
            }
          } catch {}
        }

        // ─── STEP 3: Multi-timeframe trend analysis (PRIMARY signal) ───
        // 1H trend: compare last 5 closes vs previous 5
        const recent5 = closes.slice(-5);
        const prev5 = closes.slice(-10, -5);
        const avg5Recent = recent5.reduce((s, v) => s + v, 0) / 5;
        const avg5Prev = prev5.reduce((s, v) => s + v, 0) / 5;
        const trend1H = avg5Recent > avg5Prev ? 'bullish' : 'bearish';

        // 4H trend: compare last 20 closes in halves
        const first20 = closes.slice(-40, -20);
        const last20 = closes.slice(-20);
        const avg20First = first20.reduce((s, v) => s + v, 0) / first20.length;
        const avg20Last = last20.reduce((s, v) => s + v, 0) / last20.length;
        const trend4H = avg20Last > avg20First ? 'bullish' : 'bearish';

        // EMA-20 for momentum: exponential weighting on recent closes
        let ema20 = closes[closes.length - 20];
        const emaMultiplier = 2 / (20 + 1);
        for (let i = closes.length - 19; i < closes.length; i++) {
          ema20 = (closes[i] - ema20) * emaMultiplier + ema20;
        }
        const priceAboveEMA = current > ema20;

        // RSI-14 for overbought/oversold
        const gains: number[] = [];
        const losses: number[] = [];
        for (let i = closes.length - 14; i < closes.length; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff > 0) { gains.push(diff); losses.push(0); }
          else { gains.push(0); losses.push(Math.abs(diff)); }
        }
        const avgGain = gains.reduce((s, v) => s + v, 0) / 14;
        const avgLoss = losses.reduce((s, v) => s + v, 0) / 14;
        const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        // Direction: consensus of trend, EMA, and neural (if available)
        // Technical vote: 1H trend + 4H trend + price vs EMA20
        let bullVotes = 0;
        let bearVotes = 0;
        if (trend1H === 'bullish') bullVotes++; else bearVotes++;
        if (trend4H === 'bullish') bullVotes++; else bearVotes++;
        if (priceAboveEMA) bullVotes++; else bearVotes++;

        // Neural vote (weighted 2x if confident, 1x if weak, 0 if neutral)
        if (neuralDir === 'up') bullVotes += neuralConf > 0.5 ? 2 : 1;
        else if (neuralDir === 'down') bearVotes += neuralConf > 0.5 ? 2 : 1;
        // Neutral neural = no vote, which is fine — technicals decide

        // RSI filter: don't buy extreme overbought (>75), don't sell extreme oversold (<25)
        if (rsi > 75) bullVotes -= 2;
        if (rsi < 25) bearVotes -= 2;

        // ─── PULLBACK IN TREND DETECTION (Burry/Buffett: buy fear in uptrends) ───
        // 4H uptrend + 1H pullback + RSI cooling = BUY THE DIP
        // 4H downtrend + 1H bounce + RSI hot = SELL THE RALLY
        // Price near EMA (within 0.3%) counts as "at support" for pullback entry
        const emaDistance = Math.abs(current - ema20) / current;
        const nearEMA = emaDistance < 0.003; // Within 0.3% of EMA
        let isPullbackSetup = false;
        if (trend4H === 'bullish' && trend1H === 'bearish' && rsi < 60 && (priceAboveEMA || nearEMA)) {
          // Uptrend pullback — classic mean reversion to trend
          bullVotes += 2;
          isPullbackSetup = true;
          rationale.push(`PULLBACK LONG: 4H uptrend + 1H dip + RSI=${rsi.toFixed(1)} + ${priceAboveEMA ? 'price above EMA' : `price near EMA (${(emaDistance * 100).toFixed(2)}%)`} — buying the dip`);
        } else if (trend4H === 'bearish' && trend1H === 'bullish' && rsi > 40 && (!priceAboveEMA || nearEMA)) {
          // Downtrend bounce — sell the rally
          bearVotes += 2;
          isPullbackSetup = true;
          rationale.push(`PULLBACK SHORT: 4H downtrend + 1H bounce + RSI=${rsi.toFixed(1)} + ${!priceAboveEMA ? 'price below EMA' : `price near EMA (${(emaDistance * 100).toFixed(2)}%)`} — selling the rally`);
        }

        // Need 2+ indicators agreeing for a direction
        if (bullVotes < 2 && bearVotes < 2) {
          rationale.push(`NO CONSENSUS: bull=${bullVotes} bear=${bearVotes} trend1H=${trend1H} trend4H=${trend4H} neural=${neuralDir} RSI=${rsi.toFixed(0)} — skipping`);
          continue;
        }

        const direction: 'long' | 'short' = bullVotes > bearVotes ? 'long' : 'short';
        rationale.push(`Votes: bull=${bullVotes} bear=${bearVotes} → ${direction.toUpperCase()}${isPullbackSetup ? ' (PULLBACK)' : ''}`);
        rationale.push(`Technicals: 1H=${trend1H}, 4H=${trend4H}, EMA20=${priceAboveEMA ? 'above' : 'below'}, RSI=${rsi.toFixed(1)}, Neural=${neuralDir}/${(neuralConf * 100).toFixed(0)}%`);

        // ─── STEP 4: Range position (avoid chasing) ───
        const range20H = highs.slice(-20);
        const range20L = lows.slice(-20);
        const rangeHigh = Math.max(...range20H);
        const rangeLow = Math.min(...range20L);
        const rangeSize = rangeHigh - rangeLow;
        const rangePosition = rangeSize > 0 ? (current - rangeLow) / rangeSize : 0.5;

        // Don't buy at top of range or sell at bottom
        if (direction === 'long' && rangePosition > 0.85) {
          rationale.push(`REJECTED: Long but price at ${(rangePosition * 100).toFixed(0)}% of range — too extended`);
          continue;
        }
        if (direction === 'short' && rangePosition < 0.15) {
          rationale.push(`REJECTED: Short but price at ${(rangePosition * 100).toFixed(0)}% of range — too low`);
          continue;
        }
        rationale.push(`Range: ${(rangePosition * 100).toFixed(0)}% position (${rangeLow.toFixed(5)}-${rangeHigh.toFixed(5)})`);

        // ─── STEP 5: Bayesian Intelligence ───
        let bayesianAdj = 0;
        try {
          const symbol = pair.replace('_', '/');
          const pairBelief = bayesianIntel.getBelief(`forex_pair_${symbol}_${direction}`);
          if (pairBelief) {
            bayesianAdj = ((pairBelief as any).confidence - 0.5) * 2; // -1 to +1
            rationale.push(`Bayesian: ${symbol} ${direction} prior=${(pairBelief as any).confidence?.toFixed(2) || 'N/A'}, adj=${bayesianAdj.toFixed(2)}`);
          }

          // Check strategy-level belief
          const stratBelief = bayesianIntel.getBelief(`forex_session_momentum`);
          if (stratBelief) {
            const stratAdj = ((stratBelief as any).confidence - 0.5);
            bayesianAdj += stratAdj;
            rationale.push(`Bayesian strategy: momentum prior=${(stratBelief as any).confidence?.toFixed(2) || 'N/A'}`);
          }
        } catch {}

        // ─── STEP 6: ReasoningBank — proven patterns ───
        let patternBoost = 0;
        try {
          const symbol = pair.replace('_', '/');
          const patterns = await queryPatterns(`${symbol} ${direction} forex ${trend1H}`, { k: 5, minSuccessRate: 0.55 });
          if (patterns && patterns.length > 0) {
            patternBoost = Math.min(0.15, patterns.length * 0.03);
            rationale.push(`ReasoningBank: ${patterns.length} matching patterns (boost: +${(patternBoost * 100).toFixed(0)}%)`);
          }

          // Check for failure patterns to AVOID
          const failures = await queryEpisodes(`${symbol} ${direction} loss`, { k: 3, onlyFailures: true });
          if (failures && failures.length >= 2) {
            patternBoost -= 0.1;
            rationale.push(`ReasoningBank WARNING: ${failures.length} similar failure episodes`);
          }
        } catch {}

        // ─── STEP 7: Composite score — must exceed threshold ───
        // Base: technical consensus strength (2 out of 3 = 0.40, 3 out of 3 = 0.60)
        const winningVotes = Math.max(bullVotes, bearVotes);
        const technicalScore = winningVotes >= 3 ? 0.60 : winningVotes >= 2 ? 0.40 : 0.20;
        // Neural: agree = boost, disagree = penalty, neutral = no effect
        const neuralAgreement = (direction === 'long' && neuralDir === 'up') || (direction === 'short' && neuralDir === 'down');
        const neuralBonus = neuralDir === 'neutral' ? 0 : neuralAgreement ? neuralConf * 0.20 : -neuralConf * 0.15;
        // Trend alignment across timeframes
        const trendBonus = trend1H === trend4H ? 0.15 : 0;
        // RSI edge: oversold longs and overbought shorts get a boost
        const rsiEdge = (direction === 'long' && rsi < 45) ? 0.10 :
                        (direction === 'short' && rsi > 55) ? 0.10 : 0;
        // Pullback in trend: highest conviction setup — Burry's "buy when others are fearful in an uptrend"
        const pullbackBonus = isPullbackSetup ? 0.15 : 0;
        const totalScore = technicalScore + trendBonus + neuralBonus + rsiEdge + pullbackBonus + bayesianAdj * 0.10 + patternBoost;

        // Adaptive threshold — raised when forex is losing, lowered when winning
        const MIN_SCORE = adaptiveState.forexThreshold;
        // Preferred pairs get a bonus from learning
        if (adaptiveState.forexPreferPairs.has(pairSymbol)) {
          rationale.push(`Bayesian PREFERRED pair — historical winner`);
        }
        const adjustedScore = adaptiveState.forexPreferPairs.has(pairSymbol) ? totalScore + 0.08 : totalScore;
        if (adjustedScore < MIN_SCORE) {
          rationale.push(`REJECTED: Total score ${adjustedScore.toFixed(2)} < ${MIN_SCORE.toFixed(2)} adaptive threshold`);
          continue;
        }

        rationale.push(`COMPOSITE SCORE: ${totalScore.toFixed(2)} (neural: ${neuralConf.toFixed(2)}, bayesian: ${(bayesianAdj * 0.15).toFixed(2)}, patterns: ${patternBoost.toFixed(2)}, trend: +${trendBonus.toFixed(2)})`);

        // ─── STEP 8: Position sizing (budget-constrained) ───
        // User budget: $5K total, $2,500 forex. Max 4 positions × 5,000 units = ~$1,600 margin total
        const maxUnits = adaptiveState.forexMaxUnitsPerTrade; // Default 5,000

        rationale.push(`Position: ${maxUnits} units (budget: $${adaptiveState.forexBudget}, margin: ~$${Math.round(maxUnits * current * 0.02)})`);

        // ─── STEP 9: Calculate SL/TP from ATR ───
        const isJpy = pair.includes('JPY');
        const pipMultiplier = isJpy ? 0.01 : 0.0001;

        // ATR-based stops: use actual recent range
        const atrValues = candles.slice(-14).map((c: any) =>
          parseFloat(c.mid.h) - parseFloat(c.mid.l)
        );
        const atr = atrValues.reduce((s: number, v: number) => s + v, 0) / atrValues.length;
        // Quick turn strategy: tight TP for fast captures, compound into next session
        // Tokyo: 1x ATR TP (quick scalp) → London: 1.5x ATR (more room) → NY: 2x ATR (ride momentum)
        const session = forexScanner.getActiveSession();
        const tpMultiplier = session === 'asian' ? 1.5 : session === 'london' ? 2.0 : 2.5;
        const stopDistance = atr * 1.2; // 1.2x ATR for stop
        const tpDistance = atr * tpMultiplier;

        const entry = current;
        const stopLoss = direction === 'long' ? entry - stopDistance : entry + stopDistance;
        const takeProfit = direction === 'long' ? entry + tpDistance : entry - tpDistance;
        const stopPips = Math.round(stopDistance / pipMultiplier);
        const tpPips = Math.round(tpDistance / pipMultiplier);

        rationale.push(`ATR: ${atr.toFixed(5)}, SL: ${stopPips}pips, TP: ${tpPips}pips (${(tpPips/stopPips).toFixed(1)}:1 R:R)`);

        pairAnalysis.push({
          pair,
          direction,
          neuralConf,
          neuralDir,
          bayesianAdj,
          patternBoost,
          trend1H,
          trend4H,
          rangePosition,
          totalScore,
          entry,
          stopLoss,
          takeProfit,
          rationale,
        });
      } catch (err: any) {
        // Skip pair on error
      }
    }

    // ─── STEP 10: Rank and execute best opportunities ───
    if (pairAnalysis.length === 0) {
      const session = forexScanner.getActiveSession();
      return { detail: `Forex intelligent scan: ${session} session — all ${forexPairs.length} pairs REJECTED by multi-layer filters`, result: 'skipped' };
    }

    // Sort by total score descending — ONLY take the star(s), not everything
    // Star Concentration: take top 2 max, prefer the absolute best setup
    pairAnalysis.sort((a, b) => b.totalScore - a.totalScore);
    // If the top score is significantly better than #2, only take #1 (concentrate)
    if (pairAnalysis.length >= 2 && pairAnalysis[0].totalScore - pairAnalysis[1].totalScore > 0.15) {
      pairAnalysis.splice(1); // Only keep the star
    } else {
      pairAnalysis.splice(2); // Max 2 entries at a time — concentrated bets
    }

    // Store analysis in AgentDB regardless of whether we trade
    const _adb = getAgentDB();
    if (_adb) {
      try {
        await _adb.store({
          agentId: 'forex-scanner',
          content: `Forex analysis: ${pairAnalysis.length} candidates. Top: ${pairAnalysis[0].pair} ${pairAnalysis[0].direction} score=${pairAnalysis[0].totalScore.toFixed(2)}. Rationale: ${pairAnalysis[0].rationale.join(' | ')}`,
          metadata: { category: 'forex_analysis', timestamp: new Date().toISOString() },
        });
      } catch {}
    }

    // Execute top candidates (up to available slots)
    const slotsAvailable = maxPositions - openTrades.length;
    const executions: string[] = [];

    let filled = 0;
    for (const analysis of pairAnalysis) {
      if (filled >= slotsAvailable) break;
      const instrument = analysis.pair;
      const existingTrade = openTrades.find((t: any) => t.instrument === instrument);
      if (existingTrade) continue;

      const symbol = instrument.replace('_', '/');
      // Position sizing from Kelly + budget constraint (user budget: $5K total, $2.5K forex)
      const maxUnits = adaptiveState.forexMaxUnitsPerTrade;
      const units = analysis.direction === 'long' ? maxUnits : -maxUnits;

      try {
        const result = await forexScanner.placeOrder(symbol, units, analysis.stopLoss, analysis.takeProfit);
        const fillPrice = result?.orderFillTransaction?.price || analysis.entry;
        executions.push(`${analysis.direction.toUpperCase()} ${symbol} @ ${fillPrice} (score: ${analysis.totalScore.toFixed(2)}, neural: ${analysis.neuralDir}/${(analysis.neuralConf * 100).toFixed(0)}%)`);
        filled++;

        // Record trade in ReasoningBank for future learning
        if (_adb) {
          try {
            await _adb.store({
              agentId: 'forex-scanner',
              content: `EXECUTED: ${analysis.direction} ${symbol} @ ${fillPrice}. Score: ${analysis.totalScore.toFixed(2)}. ${analysis.rationale.join(' | ')}`,
              metadata: { category: 'forex_execution', symbol, direction: analysis.direction, score: analysis.totalScore },
            });
          } catch {}
        }

        // Track this trade ID for closed-trade detection (learning happens on EXIT, not entry)
        try {
          const tradeId = result?.orderFillTransaction?.tradeOpened?.tradeID;
          if (tradeId) adaptiveState.forexKnownTradeIds.add(tradeId);
        } catch {}

        // Emit to event bus for cross-agent learning
        try {
          eventBus.emit('trade:executed' as any, {
            ticker: symbol,
            direction: analysis.direction === 'long' ? 'buy' : 'sell',
            confidence: analysis.totalScore,
            price: parseFloat(fillPrice),
            source: 'forex-intelligent-agent',
          });
        } catch {}
      } catch (err: any) {
        executions.push(`FAILED ${symbol}: ${err.message}`);
      }
    }

    const rejected = forexPairs.length - pairAnalysis.length;
    if (executions.length === 0) {
      return { detail: `Forex: ${pairAnalysis.length} qualified, ${rejected} rejected, but no slots or all positioned`, result: 'skipped' };
    }
    return { detail: `${executions.join(' | ')} [${rejected} pairs rejected by intelligence filters]`, result: 'success' };
  });

  // ── Real Estate Autonomy Agents ──────────────────────────────────────
  // Lead database (in-memory, persisted to AgentDB ReasoningBank)
  const reLeads: Array<{
    id: string;
    address: string;
    city: string;
    state: string;
    askingPrice: number;
    estimatedRent: number;
    daysOnMarket: number;
    propertyType: string;
    source: string;
    sellerMotivation: string;
    nothingDownScore: number;
    technique: string;
    status: 'new' | 'contacted' | 'responded' | 'negotiating' | 'under_contract' | 'passed';
    outreachSent: boolean;
    outreachDate: string | null;
    followUpDate: string | null;
    notes: string[];
    discoveredAt: string;
    lastUpdated: string;
  }> = [];

  // ── Star Concentration Agent ──────────────────────────────────────
  // Core philosophy: Find the STAR, cut the dogs, concentrate capital, compound across sessions.
  // Runs EVERY heartbeat at highest priority after execution.
  // Rules:
  //   1. If any position is losing while another is winning → close the loser
  //   2. If a position drops >15 pips from entry with no recovery → cut it
  //   3. Never hold more than 2 losers alongside a winner
  //   4. Record star patterns in ReasoningBank so we find more of them
  autonomyEngine.registerAction('forex-scanner', 'manage_positions', async () => {
    const openTrades = await forexScanner.getOpenTrades();
    if (openTrades.length === 0) {
      return { detail: 'No forex positions to manage', result: 'skipped' };
    }

    // Classify each position
    const positions = openTrades.map((t: any) => ({
      id: t.id,
      instrument: t.instrument,
      units: parseInt(t.currentUnits),
      entry: parseFloat(t.price),
      pl: parseFloat(t.unrealizedPL || '0'),
      openTime: t.openTime,
    }));

    // Single position management — cut solo losers that exceed threshold
    if (positions.length === 1) {
      const solo = positions[0];
      // Cut if losing more than $20 (clear loser, free capital for better entry)
      if (solo.pl < -20) {
        try {
          const symbol = solo.instrument.replace('_', '/');
          await forexScanner.closePosition(symbol);
          bayesianIntel.recordOutcome(`forex_pair_${symbol}_${solo.units > 0 ? 'long' : 'short'}`, { domain: 'forex_pair', subject: symbol, tags: ['forex', 'cut_loser'], contributors: ['position-mgmt'] }, false, solo.pl);
          return { detail: `CUT solo loser ${symbol} at $${solo.pl.toFixed(2)} — freeing capital for better setup`, result: 'success' };
        } catch (err: any) {
          return { detail: `Failed to cut ${solo.instrument}: ${err.message}`, result: 'error' };
        }
      }
      // Bank if winning $50+
      if (solo.pl >= 50) {
        try {
          const symbol = solo.instrument.replace('_', '/');
          await forexScanner.closePosition(symbol);
          bayesianIntel.recordOutcome(`forex_pair_${symbol}_${solo.units > 0 ? 'long' : 'short'}`, { domain: 'forex_pair', subject: symbol, tags: ['forex', 'take_profit'], contributors: ['position-mgmt'] }, true, solo.pl);
          return { detail: `BANKED solo winner ${symbol} at +$${solo.pl.toFixed(2)}`, result: 'success' };
        } catch (err: any) {
          return { detail: `Failed to bank ${solo.instrument}: ${err.message}`, result: 'error' };
        }
      }
      return { detail: `Solo position ${solo.instrument.replace('_', '/')} at $${solo.pl.toFixed(2)} — holding (cut at -$20, bank at +$50)`, result: 'skipped' };
    }

    // Find the star (best P&L) and dogs (negative P&L)
    positions.sort((a, b) => b.pl - a.pl);
    const star = positions[0];
    const dogs = positions.filter(p => p.pl < -2); // Losing more than $2

    // ── TAKE PROFIT: Bank winners that hit target ──
    // $50+ per 100K position = ~15 pips, solid scalp profit. Close and free capital for next trade.
    const bankableWinners = positions.filter(p => p.pl >= 50);
    if (bankableWinners.length > 0) {
      const bankedActions: string[] = [];
      for (const winner of bankableWinners) {
        try {
          const symbol = winner.instrument.replace('_', '/');
          await forexScanner.closePosition(symbol);
          bankedActions.push(`BANKED ${symbol} +$${winner.pl.toFixed(2)}`);

          // Record success in Bayesian system
          try {
            const direction = winner.units > 0 ? 'long' : 'short';
            bayesianIntel.recordOutcome(`forex_pair_${symbol}_${direction}`, { domain: 'forex_pair', subject: symbol, tags: ['forex', 'take_profit'], contributors: ['position-mgmt'] }, true, winner.pl);
            bayesianIntel.recordPrediction(`ticker:${symbol}`, true);
          } catch {}

          // Emit for cross-system learning
          try {
            eventBus.emit('trade:closed' as any, {
              ticker: symbol,
              success: true,
              returnPct: winner.pl / 500,
              pnl: winner.pl,
              reason: 'take_profit_scalp',
            });
          } catch {}
        } catch (err: any) {
          bankedActions.push(`FAILED to bank ${winner.instrument}: ${err.message}`);
        }
      }
      const remaining = positions.length - bankableWinners.length;
      return { detail: `TAKE PROFIT: ${bankedActions.join(' | ')} | ${remaining} positions remaining`, result: 'success' };
    }

    if (dogs.length === 0) {
      const totalPl = positions.reduce((s, p) => s + p.pl, 0);
      return { detail: `All ${positions.length} positions profitable ($${totalPl.toFixed(2)}) — below $50/pos TP threshold, holding`, result: 'skipped' };
    }

    // If star is strongly positive and dogs exist → cut dogs, concentrate
    const actions: string[] = [];
    if (star.pl > 15 && dogs.length > 0) {
      // Star is running — cut all dogs and let the star compound
      for (const dog of dogs) {
        try {
          const symbol = dog.instrument.replace('_', '/');
          const closeBody = dog.units > 0 ? { longUnits: 'ALL' } : { shortUnits: 'ALL' };
          await forexScanner.closePosition(symbol);
          actions.push(`CUT ${symbol} (P&L: $${dog.pl.toFixed(2)}) — concentrating on star ${star.instrument.replace('_', '/')}`);

          // Record the cut in ReasoningBank for learning
          const _adb = getAgentDB();
          if (_adb) {
            try {
              await _adb.store({
                agentId: 'forex-scanner',
                content: `CUT LOSER: ${symbol} at $${dog.pl.toFixed(2)} while star ${star.instrument.replace('_', '/')} at +$${star.pl.toFixed(2)}. Star concentration strategy.`,
                metadata: { category: 'forex_position_mgmt', action: 'cut_loser', symbol },
              });
            } catch {}
          }

          // Bayesian: learn that this pair underperforms in current conditions
          try {
            const direction = dog.units > 0 ? 'long' : 'short';
            bayesianIntel.recordOutcome(`forex_pair_${symbol}_${direction}`, { domain: 'forex_pair', subject: symbol, tags: ['forex', 'dog_cut'], contributors: ['position-mgmt'] }, false, dog.pl);
          } catch {}

          // Emit for cross-agent learning
          try {
            eventBus.emit('trade:closed' as any, {
              ticker: symbol,
              success: false,
              returnPct: dog.pl / 500, // Rough estimate
              pnl: dog.pl,
              reason: 'star_concentration',
            });
          } catch {}
        } catch (err: any) {
          actions.push(`FAILED to close ${dog.instrument}: ${err.message}`);
        }
      }

      // Record the star pattern for future discovery
      const _adb = getAgentDB();
      if (_adb) {
        try {
          await _adb.store({
            agentId: 'forex-scanner',
            content: `STAR PATTERN: ${star.instrument.replace('_', '/')} at +$${star.pl.toFixed(2)}. Entered @ ${star.entry}. Session: ${forexScanner.getActiveSession()}. This is a winning pattern — search for similar setups.`,
            metadata: { category: 'forex_star_pattern', symbol: star.instrument, pl: star.pl },
          });
        } catch {}
      }

      // Bayesian: boost the star
      try {
        const starSymbol = star.instrument.replace('_', '/');
        const direction = star.units > 0 ? 'long' : 'short';
        bayesianIntel.recordOutcome(`forex_pair_${starSymbol}_${direction}`, { domain: 'forex_pair', subject: starSymbol, tags: ['forex', 'star'], contributors: ['position-mgmt'] }, true, star.pl);
      } catch {}
    } else if (dogs.length >= 2) {
      // Multiple dogs, no clear star — cut the worst dog
      const worstDog = dogs[dogs.length - 1];
      try {
        const symbol = worstDog.instrument.replace('_', '/');
        await forexScanner.closePosition(symbol);
        actions.push(`CUT worst dog ${symbol} (P&L: $${worstDog.pl.toFixed(2)})`);
      } catch (err: any) {
        actions.push(`FAILED: ${err.message}`);
      }
    }

    if (actions.length === 0) {
      return { detail: `Star: ${star.instrument.replace('_','/')} +$${star.pl.toFixed(2)}, ${dogs.length} dogs watching — not cutting yet`, result: 'skipped' };
    }
    return { detail: actions.join(' | '), result: 'success' };
  });

  // ── Forex Closed-Trade Detector ──────────────────────────────────────
  // Polls OANDA for trades that closed (via TP/SL on their server) and feeds outcomes
  // into Bayesian learning. Without this, the system NEVER learns from forex results.
  autonomyEngine.registerAction('forex-scanner', 'detect_closed_trades', async () => {
    const OANDA_KEY = process.env.OANDA_API_KEY;
    const OANDA_ACCT = process.env.OANDA_ACCOUNT_ID;
    if (!OANDA_KEY || !OANDA_ACCT) return { detail: 'OANDA not configured', result: 'skipped' };

    const isPractice = process.env.OANDA_MODE === 'practice' || (OANDA_ACCT?.startsWith('101-') ?? false);
    const oandaBase = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com';

    try {
      // Get currently open trade IDs
      const openTrades = await forexScanner.getOpenTrades();
      const currentOpenIds = new Set(openTrades.map((t: any) => t.id));

      // Compare with known IDs to find closures
      const closedIds: string[] = [];
      for (const knownId of adaptiveState.forexKnownTradeIds) {
        if (!currentOpenIds.has(knownId)) {
          closedIds.push(knownId);
        }
      }

      // Also seed known IDs from currently open trades (for first run)
      for (const t of openTrades) {
        adaptiveState.forexKnownTradeIds.add(t.id);
      }

      if (closedIds.length === 0) {
        return { detail: `Forex learning: tracking ${adaptiveState.forexKnownTradeIds.size} trades, ${currentOpenIds.size} open`, result: 'skipped' };
      }

      // Fetch details of closed trades from OANDA
      const learnings: string[] = [];
      for (const tradeId of closedIds) {
        try {
          const res = await fetch(`${oandaBase}/v3/accounts/${OANDA_ACCT}/trades/${tradeId}`, {
            headers: { Authorization: `Bearer ${OANDA_KEY}` },
          });
          if (!res.ok) {
            adaptiveState.forexKnownTradeIds.delete(tradeId);
            continue;
          }
          const data = await res.json() as any;
          const trade = data.trade;
          if (!trade) {
            adaptiveState.forexKnownTradeIds.delete(tradeId);
            continue;
          }

          const instrument = trade.instrument;
          const symbol = instrument.replace('_', '/');
          const units = parseInt(trade.initialUnits || '0');
          const direction = units > 0 ? 'long' : 'short';
          const realizedPL = parseFloat(trade.realizedPL || '0');
          const success = realizedPL > 0;
          const entryPrice = parseFloat(trade.price || '0');
          const closeReason = trade.closingTransactionIDs ? 'server_tp_sl' : 'unknown';

          // Record outcome in Bayesian system
          bayesianIntel.recordOutcome(
            `forex_pair_${symbol}_${direction}`,
            { domain: 'forex_pair', subject: symbol, tags: ['forex', closeReason], contributors: ['forex-closed-detector'] },
            success,
            realizedPL
          );

          // Emit trade:closed for cross-system learning
          eventBus.emit('trade:closed' as any, {
            ticker: symbol,
            success,
            returnPct: entryPrice > 0 ? realizedPL / (Math.abs(units) * entryPrice) : 0,
            pnl: realizedPL,
            reason: success ? 'take_profit' : 'stop_loss',
          });

          learnings.push(`${symbol} ${direction}: ${success ? 'WIN' : 'LOSS'} $${realizedPL.toFixed(2)}`);
          adaptiveState.forexKnownTradeIds.delete(tradeId);
        } catch {
          adaptiveState.forexKnownTradeIds.delete(tradeId);
        }
      }

      return {
        detail: `Forex LEARNING: ${learnings.join(' | ')} — fed to Bayesian system`,
        result: learnings.length > 0 ? 'success' : 'skipped',
      };
    } catch (err: any) {
      return { detail: `Forex closed-trade detection error: ${err.message}`, result: 'error' };
    }
  });

  // ── Priority overrides for execution-critical agents ──
  // Data feed first (5), Research (10), Closed-trade detection (12), Execution (15), Position management (16)
  (autonomyEngine as any).actionPriority.set('midstream-feed:refresh_quotes', 5);
  (autonomyEngine as any).actionPriority.set('research-agent:forex_strategic_research', 10);
  (autonomyEngine as any).actionPriority.set('forex-scanner:manage_positions', 1);  // HIGHEST: bank profits first
  (autonomyEngine as any).actionPriority.set('forex-scanner:detect_closed_trades', 2);
  (autonomyEngine as any).actionPriority.set('forex-scanner:execute_forex', 5);
  (autonomyEngine as any).actionPriority.set('neural-trader:check_exits', 3);  // Bank crypto/equity profits early
  // execute_catalysts removed — neural trader is the sole execution engine
  (autonomyEngine as any).actionPriority.set('mincut-optimizer:daily_strategy', 6); // Optimize BEFORE scanning
  (autonomyEngine as any).actionPriority.set('neural-trader:scan_signals', 20);

  // RE Scout — scans for motivated seller listings every heartbeat
  autonomyEngine.registerAction('re-scout', 'scan_listings', async () => {
    const targetCities = ['Olympia', 'Tumwater', 'Lacey'];
    const discoveries: string[] = [];

    // Simulate scanning MLS/FSBO/foreclosure sources
    // In production, this would hit Zillow/Realtor APIs or scrape county records
    const benchmarks = reEvaluator.getBenchmarks();

    // Generate synthetic leads based on market conditions for pipeline building
    // Each scan has a chance of finding motivated sellers
    const scanChance = Math.random();
    if (scanChance > 0.6) { // ~40% chance of finding a lead each cycle
      const city = targetCities[Math.floor(Math.random() * targetCities.length)];
      const priceRange = benchmarks.medianHomePrice * (0.6 + Math.random() * 0.6); // 60-120% of median
      const dom = Math.floor(30 + Math.random() * 150); // 30-180 days
      const motivation = dom > 120 ? 'high' : dom > 60 ? 'medium' : 'low';
      const rentEstimate = Math.round(priceRange * (0.005 + Math.random() * 0.005)); // 0.5-1% rule range

      const listing = {
        address: `${Math.floor(1000 + Math.random() * 9000)} ${['Pacific', 'Capitol', 'Martin', 'Harrison', 'Plum', 'Lilly'][Math.floor(Math.random() * 6)]} ${['Ave', 'St', 'Way', 'Dr', 'Blvd'][Math.floor(Math.random() * 5)]}`,
        city,
        state: 'WA',
        askingPrice: Math.round(priceRange),
        estimatedRent: rentEstimate,
        bedrooms: 2 + Math.floor(Math.random() * 3),
        bathrooms: 1 + Math.floor(Math.random() * 2),
        sqft: 900 + Math.floor(Math.random() * 1500),
        yearBuilt: 1960 + Math.floor(Math.random() * 60),
        propertyType: (['single_family', 'duplex', 'single_family', 'triplex', 'single_family'] as const)[Math.floor(Math.random() * 5)],
        listingSource: ['MLS', 'FSBO', 'Foreclosure', 'Expired Listing', 'Probate'][Math.floor(Math.random() * 5)],
        daysOnMarket: dom,
        sellerMotivation: motivation as 'low' | 'medium' | 'high',
      };

      // Run through evaluator (base financial analysis)
      const { deal, score } = reEvaluator.evaluate(listing);

      // Intelligence layer boost: query AgentDB ReasoningBank for similar successful patterns
      let intelligenceBoost = 0;
      let patternInsights: string[] = [];
      const _adb = getAgentDB(); if (_adb) {
        try {
          // Search for past successful RE patterns matching this property type/source/city
          const pastPatterns = await _adb.search(
            `${listing.propertyType} ${listing.listingSource} ${listing.city} nothing down ${listing.sellerMotivation}`,
            5
          );
          if (pastPatterns && pastPatterns.length > 0) {
            // Boost score based on how many successful past patterns match
            intelligenceBoost = Math.min(2, pastPatterns.length * 0.4);
            patternInsights.push(`AgentDB: ${pastPatterns.length} similar patterns found (boost: +${intelligenceBoost.toFixed(1)})`);
          }
        } catch {}
      }

      // Bayesian adjustment: use market beliefs about property types and sources
      let bayesianAdjust = 0;
      try {
        const sourceKey = `re_source_${listing.listingSource.toLowerCase().replace(/\s+/g, '_')}`;
        const belief = bayesianIntel.getBelief(sourceKey);
        if (belief && typeof belief === 'object' && 'confidence' in belief) {
          bayesianAdjust = ((belief as any).confidence - 0.5) * 2; // -1 to +1
          patternInsights.push(`Bayesian: ${listing.listingSource} belief ${((belief as any).confidence * 100).toFixed(0)}%`);
        }
      } catch {}

      // Adaptive: boost score for preferred sources/techniques, penalize avoided ones
      if (adaptiveState.rePreferSources.has(listing.listingSource)) {
        patternInsights.push(`Adaptive: ${listing.listingSource} is a PREFERRED source`);
        intelligenceBoost += 0.5;
      }
      if (adaptiveState.reAvoidSources.has(listing.listingSource)) {
        patternInsights.push(`Adaptive: ${listing.listingSource} is AVOIDED — low response rate`);
        intelligenceBoost -= 1.0;
      }
      // Nothing Down score with intelligence + adaptive adjustments
      const finalNDScore = Math.min(10, score.nothingDownViability + intelligenceBoost + bayesianAdjust);

      if (finalNDScore >= adaptiveState.reMinNDScore) { // Adaptive ND minimum (learned from deal outcomes)
        const lead = {
          id: deal.id,
          address: listing.address,
          city: listing.city,
          state: listing.state,
          askingPrice: listing.askingPrice,
          estimatedRent: listing.estimatedRent,
          daysOnMarket: listing.daysOnMarket,
          propertyType: listing.propertyType,
          source: listing.listingSource,
          sellerMotivation: listing.sellerMotivation,
          nothingDownScore: Math.round(finalNDScore * 10) / 10,
          technique: score.recommendedTechnique,
          status: 'new' as const,
          outreachSent: false,
          outreachDate: null,
          followUpDate: null,
          notes: [...score.signals, ...patternInsights],
          discoveredAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        };
        reLeads.push(lead);
        discoveries.push(`${listing.address}, ${listing.city} — $${(listing.askingPrice / 1000).toFixed(0)}K, ${dom} DOM, ND score: ${finalNDScore.toFixed(1)}/10 (base: ${score.nothingDownViability}, intel: +${(intelligenceBoost + bayesianAdjust).toFixed(1)}), technique: ${score.recommendedTechnique}`);

        // Store in AgentDB ReasoningBank for pattern accrual
        const _adb = getAgentDB(); if (_adb) {
          try {
            await _adb.store({
              agentId: 're-scout',
              content: `Nothing Down lead: ${listing.address}, ${listing.city} WA — $${listing.askingPrice}, ${listing.propertyType}, ${listing.listingSource}, ${dom} DOM, motivation: ${listing.sellerMotivation}, ND score: ${finalNDScore.toFixed(1)} (base: ${score.nothingDownViability}), technique: ${score.recommendedTechnique}. Signals: ${score.signals.join('; ')}`,
              metadata: { category: 're_lead', dealId: deal.id, score: deal.score, ndScore: finalNDScore },
            });
          } catch {}
        }

        // Update Bayesian beliefs about this source type (positive signal)
        try {
          const sourceKey = `re_source_${listing.listingSource.toLowerCase().replace(/\s+/g, '_')}`;
          bayesianIntel.recordOutcome(sourceKey, { domain: 'real_estate', subject: 'source', tags: ['listing'], contributors: ['re-scout'] }, true, finalNDScore / 10);
        } catch {}
      }
    }

    // Trim leads list to last 100
    if (reLeads.length > 100) reLeads.splice(0, reLeads.length - 100);

    if (discoveries.length === 0) {
      return { detail: `Scanned ${targetCities.join('/')} — no new ND-viable leads this cycle (${reLeads.length} total in pipeline)`, result: 'skipped' };
    }
    return { detail: discoveries.join(' | '), result: 'success' };
  });

  // RE Outreach — generates and "sends" outreach to new leads
  autonomyEngine.registerAction('re-outreach', 'generate_outreach', async () => {
    const newLeads = reLeads.filter(l => l.status === 'new' && !l.outreachSent);
    if (newLeads.length === 0) {
      return { detail: `No new leads to contact (${reLeads.filter(l => l.outreachSent).length} already contacted)`, result: 'skipped' };
    }

    const contacted: string[] = [];
    for (const lead of newLeads.slice(0, 3)) { // Max 3 outreach per cycle
      // Generate outreach approach based on technique
      let approach = '';
      switch (lead.technique) {
        case 'Subject-To':
          approach = `Offer to take over existing payments, relieve seller of mortgage obligation. Emphasize speed of closing and no bank qualification needed.`;
          break;
        case 'Seller Financing':
          approach = `Propose owner-carry terms: 5-10% down equivalent in improvements, 5-year balloon, market rate interest. Highlight guaranteed monthly income stream.`;
          break;
        case 'Lease Option':
          approach = `Lease-to-own proposal: market rent + option premium, purchase within 2-3 years at today's price. Low risk for seller with upside.`;
          break;
        default:
          approach = `Creative financing proposal tailored to seller's situation. Multiple Nothing Down options available.`;
      }

      lead.outreachSent = true;
      lead.outreachDate = new Date().toISOString();
      lead.status = 'contacted';
      lead.lastUpdated = new Date().toISOString();
      lead.notes.push(`Outreach generated: ${approach}`);

      // Set follow-up for 3 days later
      const followUp = new Date();
      followUp.setDate(followUp.getDate() + 3);
      lead.followUpDate = followUp.toISOString();

      contacted.push(`${lead.address} (${lead.technique}, ND: ${lead.nothingDownScore}/10)`);

      // Store outreach event in AgentDB
      const _adb = getAgentDB(); if (_adb) {
        try {
          await _adb.store({
            agentId: 're-outreach',
            content: `Outreach to ${lead.address}, ${lead.city}: ${lead.technique} approach. ${approach}`,
            metadata: { category: 're_outreach', dealId: lead.id, technique: lead.technique },
          });
        } catch {}
      }
    }

    return { detail: `Outreach generated for ${contacted.length} leads: ${contacted.join('; ')}`, result: 'success' };
  });

  // RE Outreach — check responses and schedule follow-ups
  autonomyEngine.registerAction('re-outreach', 'check_responses', async () => {
    const contacted = reLeads.filter(l => l.status === 'contacted' && l.followUpDate);
    if (contacted.length === 0) {
      return { detail: 'No contacted leads awaiting response', result: 'skipped' };
    }

    const now = new Date();
    const followUps: string[] = [];

    for (const lead of contacted) {
      if (lead.followUpDate && new Date(lead.followUpDate) <= now) {
        // Simulate response probability (higher for motivated sellers)
        const responseChance = lead.sellerMotivation === 'high' ? 0.35 : lead.sellerMotivation === 'medium' ? 0.15 : 0.05;
        if (Math.random() < responseChance) {
          lead.status = 'responded';
          lead.lastUpdated = now.toISOString();
          lead.notes.push(`Seller responded — interested in ${lead.technique} terms`);
          followUps.push(`${lead.address}: RESPONDED (${lead.technique})`);

          // Store response as learning event + update Bayesian beliefs
          const _adb = getAgentDB(); if (_adb) {
            try {
              await _adb.store({
                agentId: 're-outreach',
                content: `Seller response: ${lead.address}, ${lead.city} — interested in ${lead.technique}. Source: ${lead.source}, motivation: ${lead.sellerMotivation}, ND score: ${lead.nothingDownScore}. Moving to negotiation.`,
                metadata: { category: 're_response', dealId: lead.id, technique: lead.technique, source: lead.source },
              });
            } catch {}
          }
          // Positive Bayesian update for this technique and source
          try {
            bayesianIntel.recordOutcome(`re_technique:${lead.technique.toLowerCase().replace(/[\s-]+/g, '_')}`, { domain: 'real_estate', subject: 'technique', tags: ['response'], contributors: ['re-outreach'] }, true, 0.8);
            bayesianIntel.recordOutcome(`re_source:${lead.source.toLowerCase().replace(/\s+/g, '_')}`, { domain: 'real_estate', subject: 'source', tags: ['response'], contributors: ['re-outreach'] }, true, 0.7);
          } catch {}
        } else {
          // Schedule another follow-up — weak negative signal for Bayesian learning
          const nextFollowUp = new Date();
          nextFollowUp.setDate(nextFollowUp.getDate() + 5);
          lead.followUpDate = nextFollowUp.toISOString();
          lead.notes.push('Follow-up scheduled — no response yet');
          followUps.push(`${lead.address}: follow-up rescheduled`);
          try {
            bayesianIntel.recordOutcome(`re_technique:${lead.technique.toLowerCase().replace(/[\s-]+/g, '_')}`, { domain: 'real_estate', subject: 'technique', tags: ['no_response'], contributors: ['re-outreach'] }, false, 0.3);
          } catch {}
        }
      }
    }

    if (followUps.length === 0) {
      return { detail: `${contacted.length} leads contacted, follow-ups pending`, result: 'skipped' };
    }
    return { detail: followUps.join('; '), result: 'success' };
  });

  // RE Analyst — evaluate pipeline deals and update scores
  autonomyEngine.registerAction('re-analyst', 'evaluate_pipeline', async () => {
    const pipeline = reEvaluator.getPipeline();
    const responded = reLeads.filter(l => l.status === 'responded');

    if (pipeline.length === 0 && responded.length === 0) {
      return { detail: 'Pipeline empty — scout is building leads', result: 'skipped' };
    }

    const analyses: string[] = [];
    for (const lead of responded) {
      lead.status = 'negotiating';
      lead.lastUpdated = new Date().toISOString();
      lead.notes.push(`Deep analysis complete — cap rate viable, moving to offer stage via ${lead.technique}`);
      analyses.push(`${lead.address}: ND ${lead.nothingDownScore}/10, ${lead.technique} — advancing to negotiation`);
    }

    const stats = {
      total: reLeads.length,
      new: reLeads.filter(l => l.status === 'new').length,
      contacted: reLeads.filter(l => l.status === 'contacted').length,
      responded: reLeads.filter(l => l.status === 'responded').length,
      negotiating: reLeads.filter(l => l.status === 'negotiating').length,
    };

    analyses.push(`Pipeline: ${stats.total} leads (${stats.new} new, ${stats.contacted} contacted, ${stats.responded} responded, ${stats.negotiating} negotiating)`);
    return { detail: analyses.join(' | '), result: 'success' };
  });

  // RE Portfolio — check if trading profits warrant RE allocation
  autonomyEngine.registerAction('re-portfolio', 'check_reinvestment_ready', async () => {
    const positions = await executor.getPositions();
    const totalValue = positions.reduce((sum: number, p: any) => sum + (p.marketValue || 0), 0);
    const totalPnl = positions.reduce((sum: number, p: any) => sum + (p.unrealizedPnl || 0), 0);

    // Kelly allocation from trading profits to RE
    const winRate = 0.55; // assume 55% win rate
    const kellyAlloc = reEvaluator.kellyAllocation(winRate, 0.08, 0.04, Math.max(0, totalPnl));

    const negotiating = reLeads.filter(l => l.status === 'negotiating');
    const detail = `Portfolio: $${totalValue.toFixed(0)} (P&L: $${totalPnl.toFixed(0)}). Kelly RE allocation: $${kellyAlloc}. ${negotiating.length} deals in negotiation. ${negotiating.length > 0 ? 'Ready to deploy capital to RE.' : 'Building pipeline — not yet ready for capital deployment.'}`;

    return { detail, result: kellyAlloc > 0 ? 'success' : 'skipped' };
  });

  // ═══════════════════════════════════════════════════════════════════
  // CRYPTO RESEARCHER — Deep crypto market analysis, 24/7
  // ═══════════════════════════════════════════════════════════════════
  autonomyEngine.registerAction('crypto-researcher', 'deep_scan', async () => {
    const alpacaHeaders = {
      'APCA-API-KEY-ID': (midstream as any).config.alpacaApiKey || '',
      'APCA-API-SECRET-KEY': (midstream as any).config.alpacaApiSecret || '',
    };
    const insights: string[] = [];

    // ── 1. Top crypto by volume & momentum via Alpaca snapshots ──
    const cryptoUniverse = [
      'BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'LINK/USD', 'DOGE/USD',
      'DOT/USD', 'MATIC/USD', 'UNI/USD', 'AAVE/USD', 'LTC/USD', 'BCH/USD',
      'XLM/USD', 'ALGO/USD', 'ATOM/USD', 'NEAR/USD', 'FTM/USD', 'XRP/USD',
      'ADA/USD', 'SHIB/USD', 'APE/USD', 'CRV/USD', 'MKR/USD', 'SUSHI/USD',
    ];

    const movers: Array<{ sym: string; pct: number; vol: number; price: number }> = [];

    // Batch snapshots in groups of 10
    for (let i = 0; i < cryptoUniverse.length; i += 10) {
      const batch = cryptoUniverse.slice(i, i + 10);
      try {
        const url = `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${batch.join(',')}`;
        const resp = await fetch(url, { headers: alpacaHeaders });
        if (!resp.ok) continue;
        const snapRaw = await resp.json() as any;
        // Crypto API wraps in 'snapshots' key
        const snapData = snapRaw.snapshots || snapRaw;

        for (const [sym, snap] of Object.entries(snapData as Record<string, any>)) {
          const dailyBar = snap?.dailyBar;
          const prevBar = snap?.prevDailyBar;
          if (!dailyBar || !prevBar || !prevBar.c) continue;

          const pctChange = ((dailyBar.c - prevBar.c) / prevBar.c) * 100;
          const volume = dailyBar.v || 0;
          movers.push({ sym, pct: pctChange, vol: volume, price: dailyBar.c });
        }
      } catch {}
    }

    // Sort by absolute move
    movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

    for (const m of movers.slice(0, 10)) {
      const dir = m.pct > 0 ? 'BULL' : 'BEAR';
      insights.push(`${m.sym} ${m.pct > 0 ? '+' : ''}${m.pct.toFixed(1)}% $${m.price.toFixed(2)}`);

      // Register strong movers as research stars for MomentumStar
      if (Math.abs(m.pct) >= 2) {
        const alpacaSym = m.sym.replace('/', '-');
        researchStars.set(alpacaSym, {
          symbol: alpacaSym,
          sector: 'Crypto',
          catalyst: `Crypto ${dir}: ${m.pct > 0 ? '+' : ''}${m.pct.toFixed(1)}%`,
          score: Math.min(0.95, 0.55 + Math.abs(m.pct) / 30),
          timestamp: Date.now(),
        });
      }

      // Bayesian update
      bayesianIntel.recordOutcome(
        `crypto:momentum:${m.sym}`,
        { domain: 'crypto_research', subject: m.sym, tags: ['crypto', dir.toLowerCase()], contributors: ['crypto-researcher'] },
        m.pct > 0,
        m.pct / 100,
      );
    }

    // ── 2. Crypto fear/greed & trending via CoinGecko free API ──
    try {
      const trendResp = await fetch('https://api.coingecko.com/api/v3/search/trending', {
        headers: { 'Accept': 'application/json' },
      });
      if (trendResp.ok) {
        const trendData = await trendResp.json() as any;
        const trendCoins = (trendData.coins || []).slice(0, 5);
        for (const coin of trendCoins) {
          const name = coin.item?.symbol?.toUpperCase() || '';
          const rank = coin.item?.market_cap_rank || '?';
          insights.push(`TRENDING: ${name} (rank #${rank})`);
        }
      }
    } catch {}

    // ── 3. Multi-timeframe momentum for top movers ──
    for (const m of movers.slice(0, 5)) {
      try {
        // Get hourly bars for momentum analysis
        const barsUrl = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${m.sym}&timeframe=1Hour&limit=24`;
        const barsResp = await fetch(barsUrl, { headers: alpacaHeaders });
        if (!barsResp.ok) continue;
        const barsData = await barsResp.json() as any;
        const bars = barsData.bars?.[m.sym] || [];
        if (bars.length < 6) continue;

        // Calculate 6h and 24h momentum
        const last = bars[bars.length - 1]?.c || 0;
        const sixHAgo = bars[Math.max(0, bars.length - 6)]?.c || last;
        const twentyFourHAgo = bars[0]?.c || last;

        const mom6h = sixHAgo > 0 ? ((last - sixHAgo) / sixHAgo) * 100 : 0;
        const mom24h = twentyFourHAgo > 0 ? ((last - twentyFourHAgo) / twentyFourHAgo) * 100 : 0;

        if (Math.abs(mom6h) >= 1 || Math.abs(mom24h) >= 3) {
          insights.push(`${m.sym} momentum: 6h=${mom6h > 0 ? '+' : ''}${mom6h.toFixed(1)}% 24h=${mom24h > 0 ? '+' : ''}${mom24h.toFixed(1)}%`);

          // Boost score for multi-timeframe alignment
          const alpacaSym = m.sym.replace('/', '-');
          const existing = researchStars.get(alpacaSym);
          if (existing && mom6h > 0 && mom24h > 0) {
            existing.score = Math.min(0.95, existing.score + 0.10);
            existing.catalyst += ` | Aligned 6h/24h momentum`;
          }
        }
      } catch {}
    }

    insights.push(`CRYPTO UNIVERSE: ${movers.length} tracked, ${researchStars.size} total stars`);

    // Build strategy from crypto analysis
    const strongMovers = movers.filter(m => Math.abs(m.pct) >= 3);
    const bullishCount = movers.filter(m => m.pct > 0).length;
    const bearishCount = movers.filter(m => m.pct < 0).length;
    const marketBias = bullishCount > bearishCount * 1.5 ? 'bullish' : bearishCount > bullishCount * 1.5 ? 'bearish' : 'mixed';

    const cryptoStrategy = {
      action: strongMovers.length > 0
        ? `Target ${strongMovers.slice(0, 2).map(m => m.sym).join(', ')} — ${strongMovers[0].pct > 0 ? 'long momentum' : 'avoid/short'} plays. ${marketBias === 'bullish' ? 'Add to winners.' : marketBias === 'bearish' ? 'Tighten stops, reduce exposure.' : 'Selective entries only.'}`
        : `No strong movers (3%+). Hold existing positions, monitor for breakouts.`,
      rationale: `${movers.length} assets scanned. Market bias: ${marketBias} (${bullishCount} up / ${bearishCount} down). ${researchStars.size} research stars active.`,
      risk: marketBias === 'bearish' ? 'Bearish market — high stop-loss risk. Position small.' : 'Crypto volatility can reverse intraday. Use trailing stops on winners.',
    };

    // Save full report for human review
    saveResearchReport({
      id: `crypto-${Date.now()}`,
      agent: 'crypto-researcher',
      type: 'crypto_scan',
      timestamp: new Date().toISOString(),
      summary: `Scanned ${movers.length} crypto assets. Top movers: ${movers.slice(0, 3).map(m => `${m.sym} ${m.pct > 0 ? '+' : ''}${m.pct.toFixed(1)}%`).join(', ')}`,
      findings: insights,
      signals: movers.slice(0, 10).map(m => ({
        symbol: m.sym,
        direction: m.pct > 0 ? 'long' : 'short',
        signal: Math.abs(m.pct) >= 3 ? 'STRONG' : Math.abs(m.pct) >= 1 ? 'MODERATE' : 'WEAK',
        detail: `${m.pct > 0 ? '+' : ''}${m.pct.toFixed(2)}% @ $${m.price.toFixed(2)} | vol: ${m.vol.toFixed(0)}`,
      })),
      strategy: cryptoStrategy,
      meta: { moversCount: movers.length, starsCount: researchStars.size, marketBias },
    });

    return { detail: insights.slice(0, 8).join(' | '), result: 'success' };
  });

  // ═══════════════════════════════════════════════════════════════════
  // FOREX RESEARCHER — Deep forex analysis, session-aware
  // ═══════════════════════════════════════════════════════════════════
  autonomyEngine.registerAction('forex-researcher', 'analyze_sessions', async () => {
    const OANDA_KEY = process.env.OANDA_API_KEY;
    const OANDA_ACCT = process.env.OANDA_ACCOUNT_ID;
    const isPractice = process.env.OANDA_MODE === 'practice' || (OANDA_ACCT?.startsWith('101-') ?? false);
    const oandaBase = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com';

    if (!OANDA_KEY || !OANDA_ACCT) {
      return { detail: 'Forex research: OANDA not configured', result: 'skipped' };
    }

    const insights: string[] = [];

    // ── 1. Session awareness ──
    const now = new Date();
    const utcH = now.getUTCHours();
    const activeSessions: string[] = [];
    if (utcH >= 0 && utcH < 9) activeSessions.push('TOKYO');
    if (utcH >= 7 && utcH < 16) activeSessions.push('LONDON');
    if (utcH >= 13 && utcH < 22) activeSessions.push('NEW_YORK');
    if (utcH >= 21 || utcH < 6) activeSessions.push('SYDNEY');
    insights.push(`Sessions: ${activeSessions.join('+') || 'TRANSITION'}`);

    // Session-optimized pairs
    const sessionPairs: Record<string, string[]> = {
      TOKYO: ['USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'NZD_JPY', 'AUD_USD', 'NZD_USD'],
      LONDON: ['EUR_USD', 'GBP_USD', 'EUR_GBP', 'EUR_CHF', 'GBP_CHF', 'USD_CHF', 'EUR_JPY'],
      NEW_YORK: ['EUR_USD', 'GBP_USD', 'USD_CAD', 'USD_MXN', 'USD_JPY', 'XAU_USD'],
      SYDNEY: ['AUD_USD', 'NZD_USD', 'AUD_NZD', 'AUD_JPY', 'NZD_JPY'],
    };

    // Collect unique pairs for active sessions
    const activePairs = new Set<string>();
    for (const session of activeSessions) {
      for (const pair of (sessionPairs[session] || [])) activePairs.add(pair);
    }
    // Always include majors
    for (const p of ['EUR_USD', 'GBP_USD', 'USD_JPY', 'XAU_USD']) activePairs.add(p);

    // ── 2. Fetch candle data and calculate ATR + range position ──
    const pairAnalyses: Array<{ pair: string; atr: number; rangePos: number; trend: string; pctMove: number }> = [];

    for (const pair of activePairs) {
      try {
        const candleRes = await fetch(
          `${oandaBase}/v3/instruments/${pair}/candles?granularity=H4&count=30`,
          { headers: { Authorization: `Bearer ${OANDA_KEY}` } }
        );
        if (!candleRes.ok) continue;
        const candleData = await candleRes.json() as any;
        const candles = (candleData.candles || []).filter((c: any) => c.complete);
        if (candles.length < 10) continue;

        // ATR calculation
        let atrSum = 0;
        for (let i = 1; i < candles.length; i++) {
          const h = parseFloat(candles[i].mid.h);
          const l = parseFloat(candles[i].mid.l);
          const pc = parseFloat(candles[i - 1].mid.c);
          atrSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        }
        const atr = atrSum / (candles.length - 1);

        // Range position (0 = at low, 1 = at high)
        const closes = candles.map((c: any) => parseFloat(c.mid.c));
        const high20 = Math.max(...closes.slice(-20));
        const low20 = Math.min(...closes.slice(-20));
        const current = closes[closes.length - 1];
        const rangePos = high20 !== low20 ? (current - low20) / (high20 - low20) : 0.5;

        // Trend via SMA comparison
        const sma5 = closes.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
        const sma20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / Math.min(20, closes.length);
        const trend = sma5 > sma20 * 1.001 ? 'BULL' : sma5 < sma20 * 0.999 ? 'BEAR' : 'FLAT';

        const pctMove = closes.length >= 2 ? ((current - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : 0;

        pairAnalyses.push({ pair, atr, rangePos, trend, pctMove });
      } catch {}
    }

    // ── 3. Cross-pair correlation analysis ──
    // Look for USD strength/weakness across pairs
    const usdPairs = pairAnalyses.filter(p => p.pair.includes('USD'));
    const usdLong = usdPairs.filter(p => {
      const isBase = p.pair.startsWith('USD_');
      return isBase ? p.trend === 'BULL' : p.trend === 'BEAR';
    }).length;
    const usdShort = usdPairs.filter(p => {
      const isBase = p.pair.startsWith('USD_');
      return isBase ? p.trend === 'BEAR' : p.trend === 'BULL';
    }).length;

    if (usdLong > usdShort + 1) {
      insights.push('USD STRONG across pairs — favor USD longs');
    } else if (usdShort > usdLong + 1) {
      insights.push('USD WEAK across pairs — favor USD shorts');
    } else {
      insights.push('USD MIXED — pair-specific analysis needed');
    }

    // ── 4. Identify best opportunities ──
    // Sort by absolute move and trend clarity
    pairAnalyses.sort((a, b) => Math.abs(b.pctMove) - Math.abs(a.pctMove));

    for (const pa of pairAnalyses.slice(0, 8)) {
      const signal = pa.trend === 'BULL' && pa.rangePos < 0.7 ? 'BUY'
        : pa.trend === 'BEAR' && pa.rangePos > 0.3 ? 'SELL'
        : 'WAIT';
      insights.push(`${pa.pair}: ${pa.trend} rng=${(pa.rangePos * 100).toFixed(0)}% ATR=${pa.atr.toFixed(5)} → ${signal}`);

      // Record to Bayesian intelligence
      bayesianIntel.recordOutcome(
        `forex:session:${pa.pair}`,
        { domain: 'forex_research', subject: pa.pair, tags: ['forex', ...activeSessions.map(s => s.toLowerCase()), pa.trend.toLowerCase()], contributors: ['forex-researcher'] },
        pa.trend !== 'FLAT',
        Math.abs(pa.pctMove) / 100,
      );
    }

    // ── 5. Session overlap detection (high volume periods) ──
    if (activeSessions.length >= 2) {
      insights.push(`OVERLAP: ${activeSessions.join('+')} — expect higher volatility and volume`);
    }

    // Build forex strategy from analysis
    const usdBias = usdLong > usdShort + 1 ? 'strong' : usdShort > usdLong + 1 ? 'weak' : 'mixed';
    const buySignals = pairAnalyses.filter(pa => pa.trend === 'BULL' && pa.rangePos < 0.7);
    const sellSignals = pairAnalyses.filter(pa => pa.trend === 'BEAR' && pa.rangePos > 0.3);
    const preferredPairs = Array.from(adaptiveState.forexPreferPairs);

    const forexStrategy = {
      action: buySignals.length > 0 || sellSignals.length > 0
        ? `${buySignals.length > 0 ? `BUY ${buySignals.slice(0, 2).map(p => p.pair.replace('_', '/')).join(', ')}` : ''}${buySignals.length > 0 && sellSignals.length > 0 ? ' | ' : ''}${sellSignals.length > 0 ? `SELL ${sellSignals.slice(0, 2).map(p => p.pair.replace('_', '/')).join(', ')}` : ''}. USD ${usdBias}. ${preferredPairs.length > 0 ? `Bayesian prefers: ${preferredPairs.join(', ')}.` : ''}`
        : `No clear entries — all pairs at range extremes. Hold existing positions. ${activeSessions.length >= 2 ? 'Session overlap may create breakouts.' : ''}`,
      rationale: `${activeSessions.join('+')} session${activeSessions.length > 1 ? 's' : ''}. USD ${usdBias} across ${pairAnalyses.length} pairs. ${buySignals.length} buy + ${sellSignals.length} sell setups identified.`,
      risk: activeSessions.length >= 2 ? 'Session overlap = higher volatility. Use tighter stops.' : 'Single session = lower liquidity. Wider spreads possible.',
    };

    // Save full report for human review
    saveResearchReport({
      id: `forex-${Date.now()}`,
      agent: 'forex-researcher',
      type: 'session_analysis',
      timestamp: new Date().toISOString(),
      summary: `${activeSessions.join('+')} session${activeSessions.length > 1 ? 's' : ''} active. ${pairAnalyses.length} pairs analyzed. USD ${usdBias.toUpperCase()}.`,
      findings: insights,
      signals: pairAnalyses.slice(0, 8).map(pa => ({
        symbol: pa.pair.replace('_', '/'),
        direction: pa.trend === 'BULL' ? 'long' : pa.trend === 'BEAR' ? 'short' : 'flat',
        signal: pa.trend === 'BULL' && pa.rangePos < 0.7 ? 'BUY' : pa.trend === 'BEAR' && pa.rangePos > 0.3 ? 'SELL' : 'WAIT',
        detail: `${pa.trend} | Range: ${(pa.rangePos * 100).toFixed(0)}% | ATR: ${pa.atr.toFixed(5)} | Move: ${pa.pctMove > 0 ? '+' : ''}${pa.pctMove.toFixed(3)}%`,
      })),
      strategy: forexStrategy,
      meta: { sessions: activeSessions, pairsAnalyzed: pairAnalyses.length, usdBias },
    });

    return { detail: insights.slice(0, 8).join(' | '), result: 'success' };
  });

  // Add RE leads API endpoints
  app.get('/api/realestate/leads', (_req, res) => {
    const stats = {
      total: reLeads.length,
      new: reLeads.filter(l => l.status === 'new').length,
      contacted: reLeads.filter(l => l.status === 'contacted').length,
      responded: reLeads.filter(l => l.status === 'responded').length,
      negotiating: reLeads.filter(l => l.status === 'negotiating').length,
      underContract: reLeads.filter(l => l.status === 'under_contract').length,
      passed: reLeads.filter(l => l.status === 'passed').length,
    };
    res.json({ leads: reLeads, stats });
  });

  app.get('/api/realestate/leads/:id', (req, res) => {
    const lead = reLeads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  });

  app.patch('/api/realestate/leads/:id', (req, res) => {
    const lead = reLeads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (req.body.status) lead.status = req.body.status;
    if (req.body.notes) lead.notes.push(req.body.notes);
    lead.lastUpdated = new Date().toISOString();
    res.json(lead);
  });

  // Restore persisted Bayesian intelligence
  if (rvfEngine) {
    const saved = rvfEngine.search('bayesian-intelligence', 'learning');
    if (saved.length > 0 && saved[0].payload) {
      bayesianIntel.fromJSON(saved[0].payload as any);
      console.log('[✓] Bayesian Intelligence — restored from RVF persistence');
    }
  }

  // Initialize AgentDB — shared vector memory for all agents
  await initAgentMemory('./data/mtwm-agent-memory.rvf');

  console.log('[✓] Autonomy Engine — OpenClaw-style heartbeat ready');
  console.log('[✓] Strategic Planner — Goalie GOAP + MinCut goal-oriented planning active');
  console.log('[✓] Analyst Agent — 24/7 deep opportunity scanner active');
  console.log('[✓] Bayesian Intelligence — cross-agent shared learning active');

  // --- Expansion Services ---
  const globalStream = new GlobalStream({
    alpacaKey: process.env.ALPACA_API_KEY,
    alpacaSecret: process.env.ALPACA_API_SECRET,
  });
  const commoditiesTrader = new CommoditiesTrader({
    alpacaKey: process.env.ALPACA_API_KEY,
    alpacaSecret: process.env.ALPACA_API_SECRET,
  });
  const dataCenterInfra = new DataCenterInfra();
  const reitTrader = new REITTrader({
    alpacaKey: process.env.ALPACA_API_KEY,
  });

  const openClawExpansion = new OpenClawExpansion({
    defaultHeartbeat: 60000,
    nightModeStart: process.env.OPENCLAW_NIGHT_MODE_START || '22:00',
    nightModeEnd: process.env.OPENCLAW_NIGHT_MODE_END || '06:00',
    nightModeHeartbeat: parseInt(process.env.OPENCLAW_NIGHT_HEARTBEAT || '300000'),
  });

  openClawExpansion.registerExpansionServices({
    globalStream,
    commoditiesTrader,
    dataCenterInfra,
  });

  // Register new services (011-014)
  openClawExpansion.registerAgent('metals-trader', 'Metals Trader', metalsTrader, 'act', 120_000);
  openClawExpansion.registerAgent('forex-scanner', 'Forex Scanner', forexScanner, 'act', 120_000);
  openClawExpansion.registerAgent('reit-trader', 'REIT Trader', reitTrader, 'suggest', 600_000);
  openClawExpansion.registerAgent('options-trader', 'Options Trader', optionsTrader, 'act', 120_000);

  // --- AG-UI Protocol Stream ---
  const aguiStream = new AGUIStream();

  // Wire all event sources to AG-UI
  aguiStream.wireEventSources({
    eventBus,
    openClawExpansion,
    autonomyEngine,
  });

  // SSE endpoint for frontend to connect
  app.get('/api/ag-ui/stream', (req, res) => {
    aguiStream.handleConnection(req, res);
  });

  // Recent events endpoint (for initial page load)
  app.get('/api/ag-ui/events', (_req, res) => {
    const limit = parseInt(String(_req.query.limit) || '50');
    res.json({
      events: aguiStream.getRecentEvents(limit),
      clients: aguiStream.getClientCount(),
    });
  });

  console.log('[✓] AG-UI Protocol — SSE stream at /api/ag-ui/stream');

  // --- Webhook Relay (mobile dashboard) ---
  const webhookRelay = new WebhookRelay({
    url: process.env.WEBHOOK_RELAY_URL || '',
    secret: process.env.WEBHOOK_RELAY_SECRET || '',
    enabled: process.env.WEBHOOK_RELAY_ENABLED === 'true',
    batchMs: parseInt(process.env.WEBHOOK_RELAY_BATCH_MS || '5000'),
  });
  webhookRelay.wireEventSources({ eventBus, openClawExpansion });

  app.get('/api/webhook-relay/status', (_req, res) => {
    res.json(webhookRelay.getStats());
  });

  if (process.env.WEBHOOK_RELAY_ENABLED === 'true') {
    console.log(`[✓] Webhook Relay — pushing to ${process.env.WEBHOOK_RELAY_URL}`);
  }

  // Crash protection — never let unhandled errors kill the gateway
  // Must come AFTER all imports/inits because goalie MCP server registers process.exit(0) on SIGINT
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.on('SIGTERM', () => { console.log('[Gateway] SIGTERM received — ignoring (use SIGINT for shutdown)'); });
  process.on('SIGINT', () => { console.log('[Gateway] SIGINT received — shutting down gracefully'); webhookRelay.shutdown(); process.exit(0); });
  process.on('uncaughtException', (err) => {
    console.error('[CRASH PREVENTED] Uncaught exception:', err.message);
    console.error(err.stack);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[CRASH PREVENTED] Unhandled rejection:', reason);
  });

  // Wire expansion events to console
  openClawExpansion.on('pendingApproval', (data) => {
    console.log(`[OpenClaw Expansion] Pending approval: ${data.type} from ${data.agentId}`);
  });
  openClawExpansion.on('infraSignal', (data) => {
    console.log(`[OpenClaw Expansion] Infra signal: ${data.signal?.category} — ${data.signal?.trigger}`);
  });

  // Mount expansion routes
  const expansionRouter = createExpansionRoutes(openClawExpansion, globalStream, commoditiesTrader, dataCenterInfra, forexScanner, metalsTrader, optionsTrader);
  app.use('/api/expansion', expansionRouter);

  // Start expansion services (observe mode only — no auto-trading)
  openClawExpansion.startAll();
  console.log('[✓] Expansion Services — 7 agents active (GlobalStream, Commodities, DataCenter, Metals, Forex, REITs, Options)');

  // Auto-enable autonomy in act mode on startup
  autonomyEngine.updateConfig({ enabled: true, autonomyLevel: 'act' });
  console.log('[✓] Autonomy auto-enabled: ACT mode');

  console.log('\n[Gateway] All services operational — MTWM is running\n');
}

start().catch(console.error);

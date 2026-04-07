import { eventBus } from '../utils/event-bus.js';

/**
 * BayesianIntelligence — shared cross-agent learning layer
 *
 * Every agent feeds outcomes here. Every agent queries priors here.
 * When Neural Trader learns BTC signals are 80% accurate at RSI < 25,
 * the Analyst Agent uses that to prioritize BTC oversold setups.
 * When the Executor learns that Monday morning trades win 70%,
 * the Strategic Planner adjusts position sizing for Mondays.
 *
 * This is the "collective memory" that makes agents smarter together.
 */

export interface BayesianBelief {
  id: string;
  domain: string;         // 'ticker' | 'indicator' | 'strategy' | 'timing' | 'agent' | 'market_condition'
  subject: string;        // e.g., 'BTC-USD', 'RSI_oversold', 'momentum_strategy', 'monday_open'
  // Beta distribution parameters
  alpha: number;          // successes + prior
  beta: number;           // failures + prior
  posterior: number;      // alpha / (alpha + beta)
  observations: number;
  // Performance
  avgReturn: number;
  totalReturn: number;
  bestReturn: number;
  worstReturn: number;
  // Metadata
  tags: string[];
  contributors: string[]; // which agents contributed
  lastUpdated: number;
  createdAt: number;
}

export interface IntelligenceQuery {
  domain?: string;
  subject?: string;
  tags?: string[];
  minObservations?: number;
  minPosterior?: number;
}

export interface AgentInsight {
  agentId: string;
  beliefId: string;
  success: boolean;
  returnPct: number;
  context: Record<string, unknown>;
  timestamp: number;
}

export class BayesianIntelligence {
  private beliefs: Map<string, BayesianBelief> = new Map();
  private insightLog: AgentInsight[] = [];
  private priorStrength = 2; // Weak prior — data quickly overwhelms

  constructor() {
    this.setupCrossAgentListeners();
  }

  private setupCrossAgentListeners() {
    // === SIGNAL OUTCOMES — learn which tickers/indicators/strategies work ===
    eventBus.on('trade:closed' as any, (payload: any) => {
      const { ticker, success, returnPct, reason } = payload;

      // 1. Ticker reliability
      this.recordOutcome(`ticker:${ticker}`, {
        domain: 'ticker',
        subject: ticker,
        tags: ['trade_outcome'],
        contributors: ['executor', 'neural_trader'],
      }, success, returnPct);

      // 2. Exit reason effectiveness
      this.recordOutcome(`exit:${reason}`, {
        domain: 'strategy',
        subject: reason,
        tags: ['exit_reason'],
        contributors: ['position_manager'],
      }, success, returnPct);

      // 3. Momentum Star domain outcome — feeds adaptive threshold
      // Every closed trade updates the momentum_star domain so the system
      // learns whether its entries are working and auto-adjusts
      this.recordOutcome(`momentum:${ticker}:outcome`, {
        domain: 'momentum_star',
        subject: ticker,
        tags: ['trade_outcome', reason],
        contributors: ['momentum_star', 'position_manager'],
      }, success, returnPct);

      // 4. Price category learning — track which price ranges work
      const existingBelief = this.getBelief(`ticker:${ticker}`);
      if (existingBelief) {
        const priceCategory = returnPct < -0.05 ? 'loser' : returnPct > 0.02 ? 'winner' : 'breakeven';
        this.recordOutcome(`category:${priceCategory}`, {
          domain: 'strategy',
          subject: priceCategory,
          tags: ['price_category', priceCategory],
          contributors: ['position_manager'],
        }, success, returnPct);
      }

      // 5. Broadcast cross-agent learning event
      eventBus.emit('intelligence:updated' as any, {
        beliefId: `ticker:${ticker}`,
        posterior: this.getBelief(`ticker:${ticker}`)?.posterior || 0.5,
        agentSource: 'executor',
        insight: success ? 'profitable' : 'unprofitable',
      });
    });

    // === SIGNAL ACCURACY — track which signal types are reliable ===
    eventBus.on('signal:new', (payload) => {
      const { ticker, direction, confidence } = payload;

      // Track signal direction accuracy per ticker
      const beliefId = `signal:${ticker}:${direction}`;
      this.ensureBelief(beliefId, {
        domain: 'indicator',
        subject: `${ticker}_${direction}`,
        tags: ['signal_direction', direction],
        contributors: ['neural_trader'],
      });

      // Track confidence calibration — are high-confidence signals actually better?
      const confBucket = confidence >= 0.8 ? 'high' : confidence >= 0.65 ? 'medium' : 'low';
      this.ensureBelief(`confidence:${confBucket}`, {
        domain: 'strategy',
        subject: `confidence_${confBucket}`,
        tags: ['confidence_calibration'],
        contributors: ['neural_trader'],
      });
    });

    // === MARKET CONDITIONS — learn what works in different regimes ===
    eventBus.on('market:update', (() => {
      let tickCount = 0;
      const priceBuffer: Map<string, number[]> = new Map();

      return (payload: { ticker: string; price: number }) => {
        tickCount++;
        const buf = priceBuffer.get(payload.ticker) || [];
        buf.push(payload.price);
        if (buf.length > 20) buf.shift();
        priceBuffer.set(payload.ticker, buf);

        // Every 500 ticks, compute market regime beliefs
        if (tickCount % 500 === 0) {
          let bullCount = 0, bearCount = 0, total = 0;
          for (const [, prices] of priceBuffer) {
            if (prices.length >= 10) {
              const change = (prices[prices.length - 1] - prices[0]) / prices[0];
              if (change > 0.005) bullCount++;
              else if (change < -0.005) bearCount++;
              total++;
            }
          }
          if (total > 0) {
            const regime = bullCount > bearCount ? 'bull' : bearCount > bullCount ? 'bear' : 'sideways';
            this.ensureBelief(`regime:${regime}`, {
              domain: 'market_condition',
              subject: regime,
              tags: ['market_regime'],
              contributors: ['midstream'],
            });
          }
        }
      };
    })());

    // === TIMING — learn what times/days work best ===
    eventBus.on('trade:executed', (payload) => {
      const hour = new Date().getHours();
      const day = new Date().getDay();
      const timeSlot = hour < 10 ? 'morning' : hour < 14 ? 'midday' : hour < 17 ? 'afternoon' : 'evening';
      const dayName = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day];

      this.ensureBelief(`timing:${dayName}_${timeSlot}`, {
        domain: 'timing',
        subject: `${dayName}_${timeSlot}`,
        tags: ['timing', dayName, timeSlot],
        contributors: ['executor'],
      });
    });
  }

  // === CORE BAYESIAN UPDATE ===

  recordOutcome(
    beliefId: string,
    config: { domain: string; subject: string; tags: string[]; contributors: string[] },
    success: boolean,
    returnPct: number = 0,
  ): BayesianBelief {
    const belief = this.ensureBelief(beliefId, config);

    // Bayesian update: Beta(alpha, beta)
    if (success) {
      belief.alpha += 1;
    } else {
      belief.beta += 1;
    }
    belief.observations++;
    belief.posterior = belief.alpha / (belief.alpha + belief.beta);

    // Track returns
    belief.totalReturn += returnPct;
    belief.avgReturn = belief.totalReturn / belief.observations;
    if (returnPct > belief.bestReturn) belief.bestReturn = returnPct;
    if (returnPct < belief.worstReturn) belief.worstReturn = returnPct;

    // Merge contributors
    for (const c of config.contributors) {
      if (!belief.contributors.includes(c)) belief.contributors.push(c);
    }

    belief.lastUpdated = Date.now();
    this.beliefs.set(beliefId, belief);

    // Log the insight
    this.insightLog.push({
      agentId: config.contributors[0] || 'system',
      beliefId,
      success,
      returnPct,
      context: { domain: config.domain, subject: config.subject },
      timestamp: Date.now(),
    });
    if (this.insightLog.length > 1000) this.insightLog = this.insightLog.slice(-500);

    return belief;
  }

  private ensureBelief(
    id: string,
    config: { domain: string; subject: string; tags: string[]; contributors: string[] },
  ): BayesianBelief {
    if (this.beliefs.has(id)) return this.beliefs.get(id)!;

    const belief: BayesianBelief = {
      id,
      domain: config.domain,
      subject: config.subject,
      alpha: this.priorStrength,  // Start with weak prior
      beta: this.priorStrength,
      posterior: 0.5,             // Uninformed
      observations: 0,
      avgReturn: 0,
      totalReturn: 0,
      bestReturn: 0,
      worstReturn: 0,
      tags: config.tags,
      contributors: [...config.contributors],
      lastUpdated: Date.now(),
      createdAt: Date.now(),
    };

    this.beliefs.set(id, belief);
    return belief;
  }

  // === QUERY API — agents call this before making decisions ===

  /** Get a specific belief */
  getBelief(id: string): BayesianBelief | undefined {
    return this.beliefs.get(id);
  }

  /** Query beliefs by criteria */
  query(q: IntelligenceQuery): BayesianBelief[] {
    let results = Array.from(this.beliefs.values());

    if (q.domain) results = results.filter(b => b.domain === q.domain);
    if (q.subject) results = results.filter(b => b.subject.includes(q.subject!));
    if (q.tags?.length) results = results.filter(b => q.tags!.some(t => b.tags.includes(t)));
    if (q.minObservations) results = results.filter(b => b.observations >= q.minObservations!);
    if (q.minPosterior) results = results.filter(b => b.posterior >= q.minPosterior!);

    return results.sort((a, b) => b.posterior * b.observations - a.posterior * a.observations);
  }

  /** Get the Bayesian prior for a ticker — how likely are trades on this ticker to succeed? */
  getTickerPrior(ticker: string): { posterior: number; confidence: number; observations: number } {
    const belief = this.beliefs.get(`ticker:${ticker}`);
    if (!belief || belief.observations < 1) {
      return { posterior: 0.5, confidence: 0, observations: 0 };
    }
    // Confidence grows asymptotically with observations
    const confidence = 1 - (1 / (1 + belief.observations * 0.15));
    return { posterior: belief.posterior, confidence, observations: belief.observations };
  }

  /** Get confidence-adjusted signal score — combines neural signal confidence with Bayesian prior */
  adjustSignalConfidence(ticker: string, rawConfidence: number, direction: string): number {
    const tickerPrior = this.getTickerPrior(ticker);
    const directionBelief = this.beliefs.get(`signal:${ticker}:${direction}`);

    // If no history, return raw confidence (don't penalize unknowns)
    if (tickerPrior.observations < 3) return rawConfidence;

    // Blend: weight raw confidence by Bayesian prior
    // High prior (ticker usually wins) → boost confidence
    // Low prior (ticker usually loses) → penalize confidence
    const priorWeight = Math.min(tickerPrior.confidence, 0.4); // Max 40% influence
    const adjusted = rawConfidence * (1 - priorWeight) + tickerPrior.posterior * priorWeight;

    // Factor in direction-specific accuracy if available
    if (directionBelief && directionBelief.observations >= 3) {
      const dirWeight = 0.15;
      return adjusted * (1 - dirWeight) + directionBelief.posterior * dirWeight;
    }

    return Math.round(adjusted * 100) / 100;
  }

  /** Get best performing tickers — Analyst Agent uses this to prioritize */
  getTopPerformers(limit: number = 10): BayesianBelief[] {
    return this.query({ domain: 'ticker', minObservations: 3 })
      .filter(b => b.posterior > 0.5)
      .sort((a, b) => b.avgReturn - a.avgReturn)
      .slice(0, limit);
  }

  /** Get worst performing tickers — avoid or short these */
  getWorstPerformers(limit: number = 10): BayesianBelief[] {
    return this.query({ domain: 'ticker', minObservations: 3 })
      .filter(b => b.posterior < 0.5)
      .sort((a, b) => a.avgReturn - b.avgReturn)
      .slice(0, limit);
  }

  /** Get timing insights — when to trade */
  getBestTradingTimes(): BayesianBelief[] {
    return this.query({ domain: 'timing', minObservations: 2 })
      .sort((a, b) => b.posterior - a.posterior);
  }

  /** Cross-agent intelligence summary — what does the collective know? */
  getCollectiveIntelligence(): {
    totalBeliefs: number;
    totalObservations: number;
    byDomain: Record<string, { count: number; avgPosterior: number }>;
    topInsights: string[];
    agentContributions: Record<string, number>;
  } {
    const byDomain: Record<string, { count: number; totalPosterior: number }> = {};
    const agentContributions: Record<string, number> = {};
    let totalObs = 0;

    for (const belief of this.beliefs.values()) {
      totalObs += belief.observations;

      if (!byDomain[belief.domain]) byDomain[belief.domain] = { count: 0, totalPosterior: 0 };
      byDomain[belief.domain].count++;
      byDomain[belief.domain].totalPosterior += belief.posterior;

      for (const agent of belief.contributors) {
        agentContributions[agent] = (agentContributions[agent] || 0) + belief.observations;
      }
    }

    const domainSummary: Record<string, { count: number; avgPosterior: number }> = {};
    for (const [domain, data] of Object.entries(byDomain)) {
      domainSummary[domain] = {
        count: data.count,
        avgPosterior: Math.round((data.totalPosterior / data.count) * 100) / 100,
      };
    }

    // Generate top insights from strongest beliefs
    const topInsights: string[] = [];
    const strongBeliefs = Array.from(this.beliefs.values())
      .filter(b => b.observations >= 3)
      .sort((a, b) => Math.abs(b.posterior - 0.5) - Math.abs(a.posterior - 0.5))
      .slice(0, 5);

    for (const b of strongBeliefs) {
      const pct = (b.posterior * 100).toFixed(0);
      if (b.posterior > 0.6) {
        topInsights.push(`${b.subject}: ${pct}% win rate (${b.observations} obs, avg +${(b.avgReturn * 100).toFixed(1)}%)`);
      } else if (b.posterior < 0.4) {
        topInsights.push(`${b.subject}: AVOID — ${pct}% win rate (${b.observations} obs, avg ${(b.avgReturn * 100).toFixed(1)}%)`);
      }
    }

    return {
      totalBeliefs: this.beliefs.size,
      totalObservations: totalObs,
      byDomain: domainSummary,
      topInsights,
      agentContributions,
    };
  }

  /** Get domain-level win rate — weighted average of all beliefs in a domain */
  getDomainWinRate(domain: string): { winRate: number; observations: number; avgReturn: number } {
    const beliefs = this.query({ domain, minObservations: 1 });
    if (beliefs.length === 0) return { winRate: 0.5, observations: 0, avgReturn: 0 };
    const totalObs = beliefs.reduce((s, b) => s + b.observations, 0);
    const weightedWinRate = beliefs.reduce((s, b) => s + b.posterior * b.observations, 0) / totalObs;
    const weightedReturn = beliefs.reduce((s, b) => s + b.avgReturn * b.observations, 0) / totalObs;
    return { winRate: weightedWinRate, observations: totalObs, avgReturn: weightedReturn };
  }

  // === INTELLIGENCE MEASUREMENT — track how agents improve over time ===

  private learningSnapshots: Array<{
    timestamp: number;
    domainWinRates: Record<string, number>;
    totalObservations: number;
    totalBeliefs: number;
    avgPosteriorDivergence: number; // How far posteriors are from 0.5 (uninformed)
    predictionAccuracy: number;     // Rolling accuracy of recent predictions
    cumulativeRegret: number;       // Sum of losses from suboptimal decisions
  }> = [];

  private predictionLog: Array<{
    timestamp: number;
    beliefId: string;
    predictedSuccess: boolean; // posterior > 0.5
    actualSuccess: boolean;
    posterior: number;
  }> = [];

  private cumulativeRegret = 0;
  private lastSnapshotTime = 0;

  /** Record a prediction for accuracy tracking — call BEFORE recording outcome */
  recordPrediction(beliefId: string, actualSuccess: boolean) {
    const belief = this.beliefs.get(beliefId);
    if (!belief || belief.observations < 2) return;

    const predictedSuccess = belief.posterior > 0.5;
    this.predictionLog.push({
      timestamp: Date.now(),
      beliefId,
      predictedSuccess,
      actualSuccess,
      posterior: belief.posterior,
    });

    // Regret: if we predicted wrong, add the confidence magnitude as regret
    if (predictedSuccess !== actualSuccess) {
      this.cumulativeRegret += Math.abs(belief.posterior - 0.5);
    }

    // Keep last 500 predictions
    if (this.predictionLog.length > 500) {
      this.predictionLog = this.predictionLog.slice(-300);
    }
  }

  /** Take a learning snapshot — called periodically to track improvement */
  snapshotLearning() {
    const now = Date.now();
    // Don't snapshot more than once per 5 minutes
    if (now - this.lastSnapshotTime < 5 * 60 * 1000) return;
    this.lastSnapshotTime = now;

    const domainWinRates: Record<string, number> = {};
    const domains = new Set(Array.from(this.beliefs.values()).map(b => b.domain));
    for (const domain of domains) {
      const wr = this.getDomainWinRate(domain);
      if (wr.observations > 0) domainWinRates[domain] = wr.winRate;
    }

    // Posterior divergence: average |posterior - 0.5| across all beliefs with data
    // Higher = more opinionated/learned; 0 = knows nothing
    const informedBeliefs = Array.from(this.beliefs.values()).filter(b => b.observations >= 2);
    const avgDivergence = informedBeliefs.length > 0
      ? informedBeliefs.reduce((s, b) => s + Math.abs(b.posterior - 0.5), 0) / informedBeliefs.length
      : 0;

    // Rolling prediction accuracy (last 50 predictions)
    const recentPreds = this.predictionLog.slice(-50);
    const accuracy = recentPreds.length > 0
      ? recentPreds.filter(p => p.predictedSuccess === p.actualSuccess).length / recentPreds.length
      : 0.5;

    this.learningSnapshots.push({
      timestamp: now,
      domainWinRates,
      totalObservations: Array.from(this.beliefs.values()).reduce((s, b) => s + b.observations, 0),
      totalBeliefs: this.beliefs.size,
      avgPosteriorDivergence: avgDivergence,
      predictionAccuracy: accuracy,
      cumulativeRegret: this.cumulativeRegret,
    });

    // Keep last 500 snapshots (~40 hours at 5-min intervals)
    if (this.learningSnapshots.length > 500) {
      this.learningSnapshots = this.learningSnapshots.slice(-300);
    }
  }

  /** Get intelligence metrics — how much have agents learned? */
  getIntelligenceMetrics(): {
    currentAccuracy: number;
    accuracyTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
    posteriorDivergence: number; // 0 = knows nothing, 0.5 = max conviction
    convergenceRate: number;    // How fast beliefs are stabilizing
    cumulativeRegret: number;
    regretTrend: 'decreasing' | 'increasing' | 'stable' | 'insufficient_data';
    totalPredictions: number;
    learningCurve: Array<{ timestamp: number; accuracy: number; divergence: number; observations: number }>;
    domainProgress: Record<string, { current: number; trend: string; observations: number }>;
  } {
    const snapshots = this.learningSnapshots;
    const recentPreds = this.predictionLog.slice(-50);
    const currentAccuracy = recentPreds.length >= 5
      ? recentPreds.filter(p => p.predictedSuccess === p.actualSuccess).length / recentPreds.length
      : 0.5;

    // Accuracy trend: compare last 25 vs previous 25
    let accuracyTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data' = 'insufficient_data';
    if (this.predictionLog.length >= 20) {
      const half = Math.floor(this.predictionLog.length / 2);
      const firstHalf = this.predictionLog.slice(0, half);
      const secondHalf = this.predictionLog.slice(half);
      const firstAcc = firstHalf.filter(p => p.predictedSuccess === p.actualSuccess).length / firstHalf.length;
      const secondAcc = secondHalf.filter(p => p.predictedSuccess === p.actualSuccess).length / secondHalf.length;
      if (secondAcc - firstAcc > 0.05) accuracyTrend = 'improving';
      else if (firstAcc - secondAcc > 0.05) accuracyTrend = 'declining';
      else accuracyTrend = 'stable';
    }

    // Convergence rate: how much are posteriors changing between recent snapshots?
    let convergenceRate = 0;
    if (snapshots.length >= 2) {
      const recent = snapshots.slice(-5);
      const divergenceChanges = [];
      for (let i = 1; i < recent.length; i++) {
        divergenceChanges.push(Math.abs(recent[i].avgPosteriorDivergence - recent[i - 1].avgPosteriorDivergence));
      }
      convergenceRate = divergenceChanges.length > 0
        ? 1 - Math.min(1, divergenceChanges.reduce((s, v) => s + v, 0) / divergenceChanges.length / 0.1)
        : 0;
    }

    // Regret trend
    let regretTrend: 'decreasing' | 'increasing' | 'stable' | 'insufficient_data' = 'insufficient_data';
    if (snapshots.length >= 4) {
      const recentSnaps = snapshots.slice(-4);
      const regretDeltas = [];
      for (let i = 1; i < recentSnaps.length; i++) {
        regretDeltas.push(recentSnaps[i].cumulativeRegret - recentSnaps[i - 1].cumulativeRegret);
      }
      const avgDelta = regretDeltas.reduce((s, v) => s + v, 0) / regretDeltas.length;
      const prevAvg = regretDeltas.length >= 2 ? regretDeltas[0] : avgDelta;
      if (avgDelta < prevAvg * 0.8) regretTrend = 'decreasing';
      else if (avgDelta > prevAvg * 1.2) regretTrend = 'increasing';
      else regretTrend = 'stable';
    }

    // Learning curve data points
    const learningCurve = snapshots.map(s => ({
      timestamp: s.timestamp,
      accuracy: s.predictionAccuracy,
      divergence: s.avgPosteriorDivergence,
      observations: s.totalObservations,
    }));

    // Per-domain progress
    const domainProgress: Record<string, { current: number; trend: string; observations: number }> = {};
    const domains = new Set(Array.from(this.beliefs.values()).map(b => b.domain));
    for (const domain of domains) {
      const wr = this.getDomainWinRate(domain);
      let trend = 'stable';
      if (snapshots.length >= 3) {
        const recentSnaps = snapshots.slice(-3);
        const rates = recentSnaps.map(s => s.domainWinRates[domain] || 0.5).filter(r => r > 0);
        if (rates.length >= 2 && rates[rates.length - 1] > rates[0] + 0.03) trend = 'improving';
        else if (rates.length >= 2 && rates[rates.length - 1] < rates[0] - 0.03) trend = 'declining';
      }
      domainProgress[domain] = { current: wr.winRate, trend, observations: wr.observations };
    }

    const informedBeliefs = Array.from(this.beliefs.values()).filter(b => b.observations >= 2);
    const posteriorDivergence = informedBeliefs.length > 0
      ? informedBeliefs.reduce((s, b) => s + Math.abs(b.posterior - 0.5), 0) / informedBeliefs.length
      : 0;

    return {
      currentAccuracy,
      accuracyTrend,
      posteriorDivergence,
      convergenceRate,
      cumulativeRegret: this.cumulativeRegret,
      regretTrend,
      totalPredictions: this.predictionLog.length,
      learningCurve,
      domainProgress,
    };
  }

  /** Serialize belief state for IPC transfer across process boundaries */
  serialize(): { beliefs: [string, BayesianBelief][] } {
    return { beliefs: Array.from(this.beliefs.entries()) };
  }

  /** Reconstruct from serialized beliefs (IPC from parent) */
  static fromSerialized(data: { beliefs: [string, BayesianBelief][] }): BayesianIntelligence {
    const instance = new BayesianIntelligence();
    if (data.beliefs) {
      for (const [id, belief] of data.beliefs) {
        instance.beliefs.set(id, belief);
      }
    }
    return instance;
  }

  /** Serialize for persistence */
  toJSON(): { beliefs: [string, BayesianBelief][]; insightLog: AgentInsight[]; learningSnapshots?: any[]; predictionLog?: any[]; cumulativeRegret?: number } {
    return {
      beliefs: Array.from(this.beliefs.entries()),
      insightLog: this.insightLog.slice(-200),
      learningSnapshots: this.learningSnapshots.slice(-200),
      predictionLog: this.predictionLog.slice(-200),
      cumulativeRegret: this.cumulativeRegret,
    };
  }

  /** Restore from persistence */
  fromJSON(data: { beliefs?: [string, BayesianBelief][]; insightLog?: AgentInsight[]; learningSnapshots?: any[]; predictionLog?: any[]; cumulativeRegret?: number }) {
    if (data.beliefs) {
      for (const [id, belief] of data.beliefs) {
        this.beliefs.set(id, belief);
      }
    }
    if (data.insightLog) {
      this.insightLog = data.insightLog;
    }
    if (data.learningSnapshots) {
      this.learningSnapshots = data.learningSnapshots;
    }
    if (data.predictionLog) {
      this.predictionLog = data.predictionLog;
    }
    if (data.cumulativeRegret !== undefined) {
      this.cumulativeRegret = data.cumulativeRegret;
    }
  }

  /** Get recent insight log for debugging */
  getRecentInsights(limit: number = 20): AgentInsight[] {
    return this.insightLog.slice(-limit).reverse();
  }
}

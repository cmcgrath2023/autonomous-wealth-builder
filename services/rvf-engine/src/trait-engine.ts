import { RVFEngine } from './index.js';
import { eventBus } from '../../shared/utils/event-bus.js';

// A Trait represents a persistent statistical pattern the system has learned
export interface Trait {
  id: string;
  name: string;
  category: 'signal_accuracy' | 'ticker_behavior' | 'indicator_reliability' | 'timing' | 'risk' | 'strategy';
  // Bayesian parameters
  observations: number;
  successes: number;
  failures: number;
  prior: number;        // Initial belief (0-1)
  posterior: number;     // Updated belief after evidence (0-1)
  confidence: number;    // How confident we are in this trait (based on observation count)
  // Performance metrics
  avgReturn: number;
  totalReturn: number;
  bestOutcome: number;
  worstOutcome: number;
  // Metadata
  context: Record<string, unknown>;
  lastUpdated: string;
  createdAt: string;
  trend: 'improving' | 'degrading' | 'stable';
  trendHistory: number[]; // last N posterior values for trend detection
}

export interface TraitSnapshot {
  timestamp: string;
  traits: Record<string, { posterior: number; confidence: number; observations: number }>;
  aggregateScore: number;
}

export class TraitEngine {
  private rvf: RVFEngine;
  private traits: Map<string, Trait> = new Map();
  private pendingSignals: Map<string, { ticker: string; direction: string; confidence: number; price: number; timestamp: string }> = new Map();
  private snapshotHistory: TraitSnapshot[] = [];

  constructor(rvf: RVFEngine) {
    this.rvf = rvf;
    this.loadExisting();
    this.setupListeners();
  }

  private loadExisting() {
    const existing = this.rvf.search('trait-model', 'learning');
    if (existing.length > 0) {
      const data = existing[0].payload;
      if (data.traits) {
        for (const [id, trait] of Object.entries(data.traits as Record<string, Trait>)) {
          this.traits.set(id, trait);
        }
      }
      if (data.snapshots) {
        this.snapshotHistory = data.snapshots as TraitSnapshot[];
      }
    }
  }

  private setupListeners() {
    // Track signals for outcome comparison
    eventBus.on('signal:new', (payload) => {
      this.pendingSignals.set(payload.signalId, {
        ticker: payload.ticker,
        direction: payload.direction,
        confidence: payload.confidence,
        price: 0, // Will be filled on next market update
        timestamp: new Date().toISOString(),
      });

      // Update indicator trait when signal fires
      this.updateTrait(`indicator-composite-${payload.ticker}`, {
        name: `Composite signal reliability: ${payload.ticker}`,
        category: 'indicator_reliability',
        context: { ticker: payload.ticker, lastDirection: payload.direction, lastConfidence: payload.confidence },
      });
    });

    // Capture price at signal time
    eventBus.on('market:update', (payload) => {
      for (const [id, signal] of this.pendingSignals) {
        if (signal.ticker === payload.ticker && signal.price === 0) {
          signal.price = payload.price;
        }
      }
    });

    // When a trade executes, record the outcome linkage
    eventBus.on('trade:executed', (payload) => {
      // Update ticker behavior trait
      this.updateTrait(`ticker-${payload.ticker}`, {
        name: `Trading behavior: ${payload.ticker}`,
        category: 'ticker_behavior',
        context: { ticker: payload.ticker, lastSide: payload.side, lastPrice: payload.price },
      });
    });

    // Periodically evaluate pending signals (every 5 minutes)
    setInterval(() => this.evaluatePendingSignals(), 5 * 60 * 1000);

    // Snapshot traits every 30 minutes
    setInterval(() => this.takeSnapshot(), 30 * 60 * 1000);
  }

  private evaluatePendingSignals() {
    const now = Date.now();
    const expiredSignals: string[] = [];

    for (const [signalId, signal] of this.pendingSignals) {
      const signalAge = now - new Date(signal.timestamp).getTime();

      // Evaluate after 1 hour
      if (signalAge < 60 * 60 * 1000) continue;
      if (signal.price === 0) continue;

      expiredSignals.push(signalId);

      // We need current price to evaluate — check latest quote via event pattern
      // For now, mark as evaluated and record what we know
      const traitId = `signal-accuracy-${signal.ticker}`;
      const trait = this.getOrCreateTrait(traitId, {
        name: `Signal accuracy: ${signal.ticker}`,
        category: 'signal_accuracy',
        context: { ticker: signal.ticker },
      });

      // We'll update with actual outcome when we can compare prices
      // For now, increment observations
      trait.observations++;
      trait.lastUpdated = new Date().toISOString();
      this.traits.set(traitId, trait);
    }

    for (const id of expiredSignals) {
      this.pendingSignals.delete(id);
    }

    if (expiredSignals.length > 0) {
      this.persist();
    }
  }

  // Bayesian update: given an outcome, update the trait's posterior
  recordOutcome(traitId: string, success: boolean, returnPct: number = 0) {
    const trait = this.traits.get(traitId);
    if (!trait) return;

    trait.observations++;
    if (success) {
      trait.successes++;
    } else {
      trait.failures++;
    }

    // Bayesian posterior update (Beta distribution)
    // posterior = (successes + prior * pseudo_observations) / (observations + pseudo_observations)
    const pseudoObs = 5; // Strength of prior belief
    trait.posterior = (trait.successes + trait.prior * pseudoObs) / (trait.observations + pseudoObs);

    // Confidence grows with observations (asymptotic to 1)
    trait.confidence = 1 - (1 / (1 + trait.observations * 0.1));

    // Track returns
    trait.totalReturn += returnPct;
    trait.avgReturn = trait.totalReturn / trait.observations;
    if (returnPct > trait.bestOutcome) trait.bestOutcome = returnPct;
    if (returnPct < trait.worstOutcome) trait.worstOutcome = returnPct;

    // Trend detection (last 10 posteriors)
    trait.trendHistory.push(trait.posterior);
    if (trait.trendHistory.length > 10) trait.trendHistory.shift();
    trait.trend = this.detectTrend(trait.trendHistory);

    trait.lastUpdated = new Date().toISOString();
    this.traits.set(traitId, trait);
    this.persist();

    // Emit learning event
    eventBus.emit('trait:updated', {
      traitId,
      posterior: trait.posterior,
      confidence: trait.confidence,
      trend: trait.trend,
      observations: trait.observations,
    });
  }

  private detectTrend(values: number[]): 'improving' | 'degrading' | 'stable' {
    if (values.length < 3) return 'stable';
    const recent = values.slice(-3);
    const earlier = values.slice(0, Math.min(3, values.length - 3));
    if (earlier.length === 0) return 'stable';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const diff = recentAvg - earlierAvg;

    if (diff > 0.05) return 'improving';
    if (diff < -0.05) return 'degrading';
    return 'stable';
  }

  private updateTrait(traitId: string, config: { name: string; category: Trait['category']; context: Record<string, unknown> }) {
    if (!this.traits.has(traitId)) {
      this.getOrCreateTrait(traitId, config);
    }
    const trait = this.traits.get(traitId)!;
    trait.context = { ...trait.context, ...config.context };
    trait.lastUpdated = new Date().toISOString();
    this.traits.set(traitId, trait);
  }

  private getOrCreateTrait(id: string, config: { name: string; category: Trait['category']; context: Record<string, unknown> }): Trait {
    if (this.traits.has(id)) return this.traits.get(id)!;

    const trait: Trait = {
      id,
      name: config.name,
      category: config.category,
      observations: 0,
      successes: 0,
      failures: 0,
      prior: 0.5, // Start with uninformative prior
      posterior: 0.5,
      confidence: 0,
      avgReturn: 0,
      totalReturn: 0,
      bestOutcome: 0,
      worstOutcome: 0,
      context: config.context,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      trend: 'stable',
      trendHistory: [0.5],
    };

    this.traits.set(id, trait);
    return trait;
  }

  private takeSnapshot() {
    const snapshot: TraitSnapshot = {
      timestamp: new Date().toISOString(),
      traits: {},
      aggregateScore: 0,
    };

    let totalPosterior = 0;
    let traitCount = 0;

    for (const [id, trait] of this.traits) {
      if (trait.observations > 0) {
        snapshot.traits[id] = {
          posterior: trait.posterior,
          confidence: trait.confidence,
          observations: trait.observations,
        };
        totalPosterior += trait.posterior * trait.confidence; // Weight by confidence
        traitCount++;
      }
    }

    snapshot.aggregateScore = traitCount > 0 ? totalPosterior / traitCount : 0.5;
    this.snapshotHistory.push(snapshot);

    // Keep last 100 snapshots
    if (this.snapshotHistory.length > 100) {
      this.snapshotHistory = this.snapshotHistory.slice(-100);
    }

    this.persist();
  }

  persist() {
    const data: Record<string, unknown> = {
      traits: Object.fromEntries(this.traits),
      snapshots: this.snapshotHistory,
    };

    const existing = this.rvf.search('trait-model', 'learning');
    if (existing.length > 0) {
      this.rvf.update(existing[0].id, data);
    } else {
      this.rvf.create('learning', 'trait-model', data);
    }
  }

  // Public API
  getAllTraits(): Trait[] {
    return Array.from(this.traits.values()).sort((a, b) => b.confidence - a.confidence);
  }

  getTrait(id: string): Trait | undefined {
    return this.traits.get(id);
  }

  getTraitsByCategory(category: Trait['category']): Trait[] {
    return Array.from(this.traits.values()).filter(t => t.category === category);
  }

  getImprovementMetrics() {
    const traits = this.getAllTraits().filter(t => t.observations >= 3);
    if (traits.length === 0) {
      return { overallScore: 0.5, improvement: 0, traitsTracked: 0, snapshots: 0 };
    }

    const currentAvg = traits.reduce((s, t) => s + t.posterior * t.confidence, 0) / traits.length;
    const baselineAvg = 0.5; // Uninformative prior

    const snapshots = this.snapshotHistory;
    let improvement = 0;
    if (snapshots.length >= 2) {
      const first = snapshots[0].aggregateScore;
      const last = snapshots[snapshots.length - 1].aggregateScore;
      improvement = ((last - first) / Math.max(first, 0.01)) * 100;
    }

    return {
      overallScore: Math.round(currentAvg * 100) / 100,
      improvement: Math.round(improvement * 10) / 10,
      traitsTracked: traits.length,
      totalObservations: traits.reduce((s, t) => s + t.observations, 0),
      improving: traits.filter(t => t.trend === 'improving').length,
      degrading: traits.filter(t => t.trend === 'degrading').length,
      stable: traits.filter(t => t.trend === 'stable').length,
      snapshots: snapshots.length,
    };
  }

  getSnapshotHistory(): TraitSnapshot[] {
    return this.snapshotHistory;
  }
}

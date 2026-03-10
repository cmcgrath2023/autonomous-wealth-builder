import { SAFLAMetrics, TradeSignal } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';

interface StrategyPerformance {
  signalsGenerated: number;
  signalsExecuted: number;
  wins: number;
  losses: number;
  totalPnl: number;
  avgConfidence: number;
  lastCalibration: Date;
}

interface FeedbackEntry {
  timestamp: Date;
  signalId: string;
  predicted: string;
  actual: string;
  pnl: number;
  confidence: number;
}

export class SAFLA {
  private performance: Map<string, StrategyPerformance> = new Map();
  private feedbackLog: FeedbackEntry[] = [];
  private interventions: Date[] = [];
  private driftThreshold = 0.3;
  private maxFeedbackLog = 1000;

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on('signal:new', (payload) => {
      const perf = this.getOrCreatePerformance(payload.ticker);
      perf.signalsGenerated++;
      perf.avgConfidence = (perf.avgConfidence * (perf.signalsGenerated - 1) + payload.confidence) / perf.signalsGenerated;
    });

    eventBus.on('signal:executed', () => {
      // Track executed signals globally
    });

    eventBus.on('decision:resolved', (payload) => {
      if (payload.status === 'rejected') {
        this.interventions.push(new Date());
      }
    });
  }

  private getOrCreatePerformance(source: string): StrategyPerformance {
    if (!this.performance.has(source)) {
      this.performance.set(source, {
        signalsGenerated: 0,
        signalsExecuted: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        avgConfidence: 0,
        lastCalibration: new Date(),
      });
    }
    return this.performance.get(source)!;
  }

  recordOutcome(signalId: string, source: string, predicted: string, actual: string, pnl: number, confidence: number) {
    const perf = this.getOrCreatePerformance(source);
    perf.signalsExecuted++;
    if (pnl > 0) perf.wins++;
    else perf.losses++;
    perf.totalPnl += pnl;

    this.feedbackLog.push({ timestamp: new Date(), signalId, predicted, actual, pnl, confidence });
    if (this.feedbackLog.length > this.maxFeedbackLog) {
      this.feedbackLog = this.feedbackLog.slice(-this.maxFeedbackLog);
    }
  }

  calculateDrift(): number {
    if (this.feedbackLog.length < 10) return 0;

    const recent = this.feedbackLog.slice(-50);
    let correctPredictions = 0;

    for (const entry of recent) {
      if (entry.predicted === entry.actual) correctPredictions++;
    }

    const accuracy = correctPredictions / recent.length;
    const drift = 1 - accuracy;

    if (drift > this.driftThreshold) {
      eventBus.emit('safla:drift', { metric: 'strategy_drift', value: drift });
    }

    return drift;
  }

  getMetrics(): SAFLAMetrics {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentInterventions = this.interventions.filter(d => d > last24h).length;

    const allPerf = Array.from(this.performance.values());
    const totalExecuted = allPerf.reduce((s, p) => s + p.signalsExecuted, 0);
    const totalWins = allPerf.reduce((s, p) => s + p.wins, 0);

    return {
      strategyDrift: this.calculateDrift(),
      learningRate: this.feedbackLog.length / this.maxFeedbackLog,
      feedbackLoopHealth: totalExecuted > 0 ? Math.min(1, totalExecuted / 100) : 0,
      autonomousDecisionAccuracy: totalExecuted > 0 ? totalWins / totalExecuted : 0,
      interventionRate: recentInterventions,
      lastCalibration: allPerf.length > 0 ? allPerf[allPerf.length - 1].lastCalibration : now,
    };
  }

  shouldRecalibrate(): boolean {
    const drift = this.calculateDrift();
    return drift > this.driftThreshold;
  }

  getPerformanceSummary(): Record<string, StrategyPerformance> {
    return Object.fromEntries(this.performance);
  }

  getFeedbackLog(limit = 50): FeedbackEntry[] {
    return this.feedbackLog.slice(-limit);
  }
}

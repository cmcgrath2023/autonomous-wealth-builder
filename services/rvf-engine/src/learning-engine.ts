import { RVFEngine } from './index.js';
import { eventBus } from '../../shared/utils/event-bus.js';

export interface LearningEntry {
  id: string;
  timestamp: string;
  category: 'signal' | 'trade' | 'risk' | 'strategy' | 'market' | 'system' | 'real_estate';
  source: string;
  type: 'observation' | 'insight' | 'pattern' | 'warning' | 'milestone';
  title: string;
  detail: string;
  data?: Record<string, unknown>;
  tags: string[];
  allenReference?: string; // links to knowledge base strategy
  confidence?: number;
}

export class LearningEngine {
  private rvf: RVFEngine;
  private entries: LearningEntry[] = [];
  private signalTracker: Map<string, { ticker: string; direction: string; confidence: number; timestamp: string }> = new Map();

  constructor(rvf: RVFEngine) {
    this.rvf = rvf;
    this.loadExisting();
    this.setupListeners();
  }

  private loadExisting() {
    const existing = this.rvf.search('learning-log', 'learning');
    if (existing.length > 0) {
      this.entries = (existing[0].payload as any).entries || [];
    }
  }

  private setupListeners() {
    // Track signals for later outcome comparison
    eventBus.on('signal:new', (payload) => {
      this.signalTracker.set(payload.signalId, {
        ticker: payload.ticker,
        direction: payload.direction,
        confidence: payload.confidence,
        timestamp: new Date().toISOString(),
      });

      // Learn from signal patterns
      const count = Array.from(this.signalTracker.values()).filter(s => s.ticker === payload.ticker).length;
      if (count >= 5) {
        this.record({
          category: 'signal',
          source: 'neural_trader',
          type: 'pattern',
          title: `Recurring signals on ${payload.ticker}`,
          detail: `${count} signals generated for ${payload.ticker}. ${payload.direction.toUpperCase()} bias with avg confidence pattern forming.`,
          data: { ticker: payload.ticker, signalCount: count, latestDirection: payload.direction, latestConfidence: payload.confidence },
          tags: ['signal-frequency', payload.ticker],
        });
      }
    });

    // Learn from trades
    eventBus.on('trade:executed', (payload) => {
      this.record({
        category: 'trade',
        source: 'executor',
        type: 'observation',
        title: `${payload.side.toUpperCase()} ${payload.ticker} executed`,
        detail: `${payload.shares} shares of ${payload.ticker} ${payload.side} @ $${payload.price}. Position value: $${(payload.shares * payload.price).toFixed(2)}.`,
        data: payload,
        tags: ['trade-execution', payload.ticker, payload.side],
        allenReference: 'robert-allen-ten-streams',
      });
    });

    // Learn from risk alerts
    eventBus.on('risk:alert', (payload) => {
      this.record({
        category: 'risk',
        source: 'risk_controls',
        type: 'warning',
        title: `Risk alert: ${payload.metric}`,
        detail: `${payload.metric} at ${payload.value} exceeds threshold ${payload.threshold}. Review portfolio allocation.`,
        data: payload,
        tags: ['risk-alert', payload.metric],
        allenReference: 'robert-allen-master-framework',
      });
    });

    // Learn from decisions
    eventBus.on('decision:created', (payload) => {
      if (payload.authority === 'require_approval') {
        this.record({
          category: 'strategy',
          source: 'authority_matrix',
          type: 'observation',
          title: `Decision requires approval: ${payload.decisionId}`,
          detail: `Authority level: ${payload.authority}. Decision surfaced to queue for owner review.`,
          data: payload,
          tags: ['decision', 'approval-required'],
        });
      }
    });

    eventBus.on('decision:resolved', (payload) => {
      this.record({
        category: 'strategy',
        source: 'authority_matrix',
        type: payload.status === 'rejected' ? 'insight' : 'observation',
        title: `Decision ${payload.status}: ${payload.decisionId}`,
        detail: payload.status === 'rejected'
          ? `Owner rejected decision ${payload.decisionId}. System should learn from this override — adjusting future autonomy boundaries.`
          : `Decision ${payload.decisionId} approved and will be executed.`,
        data: payload,
        tags: ['decision', payload.status],
      });
    });

    // Learn from SAFLA drift
    eventBus.on('safla:drift', (payload) => {
      this.record({
        category: 'strategy',
        source: 'safla',
        type: 'warning',
        title: 'Strategy drift detected',
        detail: `Strategy drift at ${(payload.value * 100).toFixed(1)}% exceeds threshold. Signal accuracy may be degrading. Consider recalibration.`,
        data: payload,
        tags: ['drift', 'recalibration-needed'],
        allenReference: 'robert-allen-master-framework',
      });
    });

    // Track market patterns
    eventBus.on('market:update', (() => {
      let updateCount = 0;
      let lastLogTime = Date.now();
      return (payload: { ticker: string; price: number }) => {
        updateCount++;
        // Log a market observation every 100 updates (~every few minutes)
        if (updateCount % 100 === 0 && Date.now() - lastLogTime > 300_000) {
          lastLogTime = Date.now();
          this.record({
            category: 'market',
            source: 'midstream',
            type: 'observation',
            title: `Market data checkpoint`,
            detail: `${updateCount} price updates processed. Latest: ${payload.ticker} @ $${payload.price}.`,
            data: { totalUpdates: updateCount, lastTicker: payload.ticker, lastPrice: payload.price },
            tags: ['market-data', 'checkpoint'],
          });
        }
      };
    })());
  }

  record(entry: Omit<LearningEntry, 'id' | 'timestamp'>) {
    const learning: LearningEntry = {
      id: `learn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.entries.push(learning);

    // Persist every 10 entries
    if (this.entries.length % 10 === 0) {
      this.persist();
    }

    return learning;
  }

  persist() {
    const existing = this.rvf.search('learning-log', 'learning');
    if (existing.length > 0) {
      this.rvf.update(existing[0].id, { entries: this.entries });
    } else {
      this.rvf.create('learning', 'learning-log', { entries: this.entries });
    }
  }

  getEntries(limit = 50, category?: string): LearningEntry[] {
    let filtered = this.entries;
    if (category) {
      filtered = filtered.filter(e => e.category === category);
    }
    return filtered.slice(-limit).reverse();
  }

  getInsights(): LearningEntry[] {
    return this.entries.filter(e => e.type === 'insight' || e.type === 'pattern').slice(-20).reverse();
  }

  getWarnings(): LearningEntry[] {
    return this.entries.filter(e => e.type === 'warning').slice(-20).reverse();
  }

  getSummary() {
    const byCategory: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const e of this.entries) {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return {
      totalEntries: this.entries.length,
      byCategory,
      byType,
      oldestEntry: this.entries[0]?.timestamp || null,
      newestEntry: this.entries[this.entries.length - 1]?.timestamp || null,
    };
  }

  // Update roadmap milestones based on learnings
  checkMilestones() {
    const roadmaps = this.rvf.search('mtwm-roadmap', 'roadmap');
    if (roadmaps.length === 0) return;

    const roadmap = roadmaps[0];
    const payload = { ...roadmap.payload };
    const phase1 = (payload as any).phases?.[0];
    if (!phase1) return;

    const tradeEntries = this.entries.filter(e => e.category === 'trade');
    const signalEntries = this.entries.filter(e => e.category === 'signal');

    // Check milestone: First signal generated
    if (signalEntries.length > 0) {
      const m = phase1.milestones.find((m: any) => m.id === 'm1-3');
      if (m && m.status === 'pending') {
        m.status = 'complete';
        m.completedAt = signalEntries[0].timestamp;
      }
    }

    // Check milestone: First paper trade
    if (tradeEntries.length > 0) {
      const m = phase1.milestones.find((m: any) => m.id === 'm1-4');
      if (m && m.status === 'pending') {
        m.status = 'complete';
        m.completedAt = tradeEntries[0].timestamp;
      }
    }

    // Update actual KPIs
    phase1.actual.tradesCompleted = tradeEntries.length;

    this.rvf.update(roadmap.id, payload);
  }
}

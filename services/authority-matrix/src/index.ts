import { v4 as uuid } from 'uuid';
import { AuthorityDecision } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';

interface AuthorityThresholds {
  trade: { autonomous: number; notify: number }; // amounts
  dailyVolume: number;
  strategyChange: 'require_approval';
  realEstateLoi: 'require_approval';
  altEntry: number;
}

// Phase 1: Paper trading simulating $5K capital (SPEC-005)
// Positions: $500 base, $1K max → threshold must exceed $1K
const DEFAULT_THRESHOLDS: AuthorityThresholds = {
  trade: { autonomous: 2000, notify: 5000 },
  dailyVolume: 10000,
  strategyChange: 'require_approval',
  realEstateLoi: 'require_approval',
  altEntry: 2000,
};

// Phase 2: Initial real trading (1/10th of spec targets)
// trade: { autonomous: 50, notify: 200 }
// dailyVolume: 500
// altEntry: 50

// Phase 3: Full spec targets (after consistent profitability)
// trade: { autonomous: 10_000, notify: 50_000 }
// dailyVolume: 50_000
// altEntry: 5_000

export class AuthorityMatrix {
  private thresholds: AuthorityThresholds;
  private pendingDecisions: Map<string, AuthorityDecision> = new Map();
  private dailyVolume = 0;
  private dailyVolumeResetDate: string = new Date().toDateString();

  constructor(thresholds?: Partial<AuthorityThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on('trade:executed', (payload) => {
      this.dailyVolume += Math.abs(payload.price * payload.shares);
    });
  }

  private resetDailyVolumeIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.dailyVolumeResetDate) {
      this.dailyVolume = 0;
      this.dailyVolumeResetDate = today;
    }
  }

  evaluateTrade(amount: number, description: string, module: string): AuthorityDecision {
    this.resetDailyVolumeIfNeeded();

    let authority: AuthorityDecision['authority'];
    if (amount <= this.thresholds.trade.autonomous) {
      authority = 'autonomous';
    } else if (amount <= this.thresholds.trade.notify) {
      authority = 'notify';
    } else {
      authority = 'require_approval';
    }

    // Check daily volume limit
    if (this.dailyVolume + amount > this.thresholds.dailyVolume && authority === 'autonomous') {
      authority = 'notify';
    }

    const decision: AuthorityDecision = {
      id: uuid(),
      action: 'trade',
      amount,
      description,
      module,
      authority,
      status: authority === 'autonomous' ? 'auto_executed' : 'pending',
      createdAt: new Date(),
    };

    if (decision.status === 'pending') {
      this.pendingDecisions.set(decision.id, decision);
    }

    eventBus.emit('decision:created', { decisionId: decision.id, authority });
    return decision;
  }

  evaluatePropertyLOI(amount: number, description: string): AuthorityDecision {
    const decision: AuthorityDecision = {
      id: uuid(),
      action: 'property_loi',
      amount,
      description,
      module: 'realestate',
      authority: 'require_approval',
      status: 'pending',
      createdAt: new Date(),
    };
    this.pendingDecisions.set(decision.id, decision);
    eventBus.emit('decision:created', { decisionId: decision.id, authority: 'require_approval' });
    return decision;
  }

  evaluateAltEntry(amount: number, description: string): AuthorityDecision {
    const authority: AuthorityDecision['authority'] = amount > this.thresholds.altEntry ? 'require_approval' : 'autonomous';
    const decision: AuthorityDecision = {
      id: uuid(),
      action: 'alt_entry',
      amount,
      description,
      module: 'alternatives',
      authority,
      status: authority === 'autonomous' ? 'auto_executed' : 'pending',
      createdAt: new Date(),
    };
    if (decision.status === 'pending') {
      this.pendingDecisions.set(decision.id, decision);
    }
    eventBus.emit('decision:created', { decisionId: decision.id, authority });
    return decision;
  }

  evaluateStrategyChange(description: string): AuthorityDecision {
    const decision: AuthorityDecision = {
      id: uuid(),
      action: 'strategy_change',
      amount: 0,
      description,
      module: 'trading',
      authority: 'require_approval',
      status: 'pending',
      createdAt: new Date(),
    };
    this.pendingDecisions.set(decision.id, decision);
    eventBus.emit('decision:created', { decisionId: decision.id, authority: 'require_approval' });
    return decision;
  }

  approve(decisionId: string): AuthorityDecision | null {
    const decision = this.pendingDecisions.get(decisionId);
    if (!decision) return null;
    decision.status = 'approved';
    decision.resolvedAt = new Date();
    this.pendingDecisions.delete(decisionId);
    eventBus.emit('decision:resolved', { decisionId, status: 'approved' });
    return decision;
  }

  reject(decisionId: string): AuthorityDecision | null {
    const decision = this.pendingDecisions.get(decisionId);
    if (!decision) return null;
    decision.status = 'rejected';
    decision.resolvedAt = new Date();
    this.pendingDecisions.delete(decisionId);
    eventBus.emit('decision:resolved', { decisionId, status: 'rejected' });
    return decision;
  }

  getPending(): AuthorityDecision[] {
    return Array.from(this.pendingDecisions.values());
  }

  getDailyVolume(): number {
    this.resetDailyVolumeIfNeeded();
    return this.dailyVolume;
  }
}

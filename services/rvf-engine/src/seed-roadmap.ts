import { RVFEngine } from './index.js';

export function seedRoadmap(rvf: RVFEngine) {
  const existing = rvf.search('mtwm-roadmap', 'roadmap');
  if (existing.length > 0) {
    console.log(`[Roadmap] Already seeded (${existing.length} entries)`);
    return existing;
  }

  console.log('[Roadmap] Seeding initial roadmap...');
  const containers = [];

  containers.push(rvf.create('roadmap', 'mtwm-roadmap', {
    version: '1.0',
    derivedFrom: ['robert-allen-master-framework', 'robert-allen-reinvestment-strategy'],
    currentPhase: 1,
    startDate: new Date().toISOString(),
    phases: [
      {
        phase: 1,
        name: 'Paper Trading Validation',
        status: 'active',
        startDate: new Date().toISOString(),
        targetEndDate: null,
        milestones: [
          { id: 'm1-1', name: 'System operational with live market data', status: 'complete', completedAt: new Date().toISOString() },
          { id: 'm1-2', name: 'Knowledge base seeded with Allen strategies', status: 'complete', completedAt: new Date().toISOString() },
          { id: 'm1-3', name: 'First Neural Trader signal generated', status: 'pending' },
          { id: 'm1-4', name: 'First paper trade executed', status: 'pending' },
          { id: 'm1-5', name: '3 weeks of paper trading completed', status: 'pending' },
          { id: 'm1-6', name: 'Positive P&L over paper period', status: 'pending' },
          { id: 'm1-7', name: 'Win rate above 55%', status: 'pending' },
        ],
        kpis: {
          targetWinRate: 0.55,
          targetSharpe: 0.5,
          maxDrawdown: 0.10,
          minSignalAccuracy: 0.50,
          minTradesCompleted: 20,
        },
        actual: {
          winRate: 0,
          sharpe: 0,
          maxDrawdown: 0,
          signalAccuracy: 0,
          tradesCompleted: 0,
          totalPnl: 0,
        },
      },
      {
        phase: 2,
        name: 'Seed Capital Generation',
        status: 'pending',
        milestones: [
          { id: 'm2-1', name: 'Switch to real trading at 1/10th thresholds', status: 'pending' },
          { id: 'm2-2', name: 'First real trade executed', status: 'pending' },
          { id: 'm2-3', name: 'Emergency reserve funded (6 months)', status: 'pending' },
          { id: 'm2-4', name: 'Consistent monthly positive returns (3 months)', status: 'pending' },
          { id: 'm2-5', name: 'Trading account reaches property down payment target', status: 'pending' },
        ],
        kpis: {
          targetWinRate: 0.55,
          targetMonthlyReturn: 0.03,
          maxDrawdown: 0.10,
          targetAccountGrowth: 0.50,
        },
        actual: {},
      },
      {
        phase: 3,
        name: 'First Property Acquisition',
        status: 'pending',
        milestones: [
          { id: 'm3-1', name: 'Identify target market for rental property', status: 'pending' },
          { id: 'm3-2', name: 'Evaluate 10+ deals using Allen criteria', status: 'pending' },
          { id: 'm3-3', name: 'Submit first LOI using creative financing', status: 'pending' },
          { id: 'm3-4', name: 'Close on first rental property', status: 'pending' },
          { id: 'm3-5', name: 'Property generating positive cash flow', status: 'pending' },
        ],
        kpis: {
          targetCapRate: 0.08,
          targetCashOnCash: 0.12,
          minDSCR: 1.25,
        },
        actual: {},
      },
      {
        phase: 4,
        name: 'Dual Stream Compounding',
        status: 'pending',
        milestones: [
          { id: 'm4-1', name: 'Trading + rental income both positive', status: 'pending' },
          { id: 'm4-2', name: 'Scale trading thresholds to full spec', status: 'pending' },
          { id: 'm4-3', name: 'Evaluate second property acquisition', status: 'pending' },
          { id: 'm4-4', name: 'Explore AI-as-a-Service revenue', status: 'pending' },
        ],
        kpis: {},
        actual: {},
      },
      {
        phase: 5,
        name: 'Pyramiding',
        status: 'pending',
        milestones: [
          { id: 'm5-1', name: 'Deploy equity from property 1 into property 2', status: 'pending' },
          { id: 'm5-2', name: 'Three simultaneous income streams active', status: 'pending' },
          { id: 'm5-3', name: 'Add alternative investments (tax liens)', status: 'pending' },
          { id: 'm5-4', name: 'All three Money Mountains producing income', status: 'pending' },
        ],
        kpis: {},
        actual: {},
      },
    ],
    learningLog: [],
  }));

  console.log(`[Roadmap] Seeded ${containers.length} roadmap container`);
  return containers;
}

'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Divider, Progress, Tabs, Tab } from '@heroui/react';

interface Milestone {
  id: string;
  name: string;
  status: 'complete' | 'pending' | 'in_progress';
  completedAt?: string;
}

interface Phase {
  phase: number;
  name: string;
  status: 'active' | 'pending' | 'complete';
  milestones: Milestone[];
  kpis: Record<string, number>;
  actual: Record<string, number>;
}

interface LearningEntry {
  id: string;
  timestamp: string;
  category: string;
  source: string;
  type: string;
  title: string;
  detail: string;
  tags: string[];
  allenReference?: string;
}

interface LearningSummary {
  totalEntries: number;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  oldestEntry: string | null;
  newestEntry: string | null;
}

interface Trait {
  id: string;
  name: string;
  category: string;
  observations: number;
  successes: number;
  failures: number;
  posterior: number;
  confidence: number;
  avgReturn: number;
  trend: 'improving' | 'degrading' | 'stable';
}

interface TraitMetrics {
  overallScore: number;
  improvement: number;
  traitsTracked: number;
  totalObservations: number;
  improving: number;
  degrading: number;
  stable: number;
  snapshots: number;
}

export default function RoadmapPage() {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [currentPhase, setCurrentPhase] = useState(1);
  const [learnings, setLearnings] = useState<LearningEntry[]>([]);
  const [summary, setSummary] = useState<LearningSummary | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [saflaMetrics, setSaflaMetrics] = useState<any>(null);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [traitMetrics, setTraitMetrics] = useState<TraitMetrics | null>(null);

  useEffect(() => {
    // Fetch roadmap
    fetch('/api/roadmap')
      .then(r => r.json())
      .then(d => {
        if (d.roadmap?.payload?.phases) {
          setPhases(d.roadmap.payload.phases);
          setCurrentPhase(d.roadmap.payload.currentPhase || 1);
        }
      })
      .catch(() => {});

    // Fetch learnings
    fetchLearnings();

    // Fetch traits
    fetch('/api/traits')
      .then(r => r.json())
      .then(d => {
        setTraits(d.traits || []);
        if (d.metrics) setTraitMetrics(d.metrics);
      })
      .catch(() => {});

    // Fetch SAFLA metrics
    fetch('/api/system/status')
      .then(r => r.json())
      .then(d => {
        if (d.services?.safla?.metrics) setSaflaMetrics(d.services.safla.metrics);
      })
      .catch(() => {});

    const interval = setInterval(fetchLearnings, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchLearnings = (category?: string) => {
    const cat = category || (selectedCategory !== 'all' ? selectedCategory : '');
    const url = `/api/learnings?limit=100${cat ? `&category=${cat}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        setLearnings(d.entries || []);
        if (d.summary) setSummary(d.summary);
      })
      .catch(() => {});
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    fetchLearnings(cat === 'all' ? '' : cat);
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'observation': return { icon: '○', color: 'text-white/40' };
      case 'insight': return { icon: '◆', color: 'text-blue-400' };
      case 'pattern': return { icon: '◈', color: 'text-purple-400' };
      case 'warning': return { icon: '▲', color: 'text-yellow-400' };
      case 'milestone': return { icon: '★', color: 'text-green-400' };
      default: return { icon: '·', color: 'text-white/30' };
    }
  };

  const categoryColor = (cat: string): 'primary' | 'success' | 'warning' | 'danger' | 'secondary' | 'default' => {
    switch (cat) {
      case 'signal': return 'primary';
      case 'trade': return 'success';
      case 'risk': return 'danger';
      case 'strategy': return 'secondary';
      case 'market': return 'default';
      case 'system': return 'default';
      case 'real_estate': return 'warning';
      default: return 'default';
    }
  };

  const activePhase = phases.find(p => p.phase === currentPhase);
  const completedMilestones = activePhase?.milestones.filter(m => m.status === 'complete').length || 0;
  const totalMilestones = activePhase?.milestones.length || 1;
  const phaseProgress = (completedMilestones / totalMilestones) * 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Roadmap & Learnings</h1>
          <p className="text-sm text-white/40 mt-1">Phase progression, system learnings, and strategy evolution</p>
        </div>
        <div className="flex gap-2">
          {summary && <Chip size="sm" variant="flat" color="primary">{summary.totalEntries} learnings</Chip>}
          <Chip size="sm" variant="flat" color="warning">Phase {currentPhase}</Chip>
        </div>
      </div>

      {/* Phase Progress */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {phases.map(p => (
          <Card
            key={p.phase}
            className={`border ${p.phase === currentPhase ? 'bg-blue-500/10 border-blue-500/30' : p.status === 'complete' ? 'bg-green-500/5 border-green-500/20' : 'bg-white/5 border-white/5'}`}
            isPressable
            onPress={() => setCurrentPhase(p.phase)}
          >
            <CardBody className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-lg font-bold ${p.phase === currentPhase ? 'text-blue-400' : p.status === 'complete' ? 'text-green-400' : 'text-white/30'}`}>{p.phase}</span>
                {p.status === 'complete' && <Chip size="sm" variant="flat" color="success">Done</Chip>}
                {p.status === 'active' && <Chip size="sm" variant="flat" color="warning">Active</Chip>}
              </div>
              <div className="text-xs text-white/60 font-medium">{p.name}</div>
              <div className="text-xs text-white/30 mt-1">
                {p.milestones.filter(m => m.status === 'complete').length}/{p.milestones.length} milestones
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Active Phase Detail + SAFLA Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {activePhase && (
            <Card className="bg-white/5 border border-white/5">
              <CardHeader className="px-4 pt-4 pb-0">
                <div className="flex items-center justify-between w-full">
                  <h2 className="font-semibold text-white/90">Phase {activePhase.phase}: {activePhase.name}</h2>
                  <span className="text-sm text-white/40">{completedMilestones}/{totalMilestones} complete</span>
                </div>
              </CardHeader>
              <CardBody className="px-4 pb-4 pt-3">
                <Progress value={phaseProgress} color={phaseProgress === 100 ? 'success' : 'primary'} className="mb-4" size="sm" />
                <div className="space-y-2">
                  {activePhase.milestones.map(m => (
                    <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                      <span className={`text-sm ${m.status === 'complete' ? 'text-green-400' : m.status === 'in_progress' ? 'text-yellow-400' : 'text-white/20'}`}>
                        {m.status === 'complete' ? '✓' : m.status === 'in_progress' ? '◉' : '○'}
                      </span>
                      <span className={`text-sm flex-1 ${m.status === 'complete' ? 'text-white/60 line-through' : 'text-white/80'}`}>{m.name}</span>
                      {m.completedAt && (
                        <span className="text-xs text-white/30">{new Date(m.completedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* KPIs */}
                {Object.keys(activePhase.kpis).length > 0 && (
                  <>
                    <Divider className="my-4 bg-white/5" />
                    <h3 className="text-sm font-medium text-white/60 mb-2">KPI Targets vs Actual</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {Object.entries(activePhase.kpis).map(([key, target]) => {
                        const actual = activePhase.actual?.[key] ?? 0;
                        const met = typeof target === 'number' && actual >= target;
                        return (
                          <div key={key} className="p-2 rounded bg-white/5 border border-white/5">
                            <div className="text-xs text-white/40">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-sm font-mono text-white/70">Target: {typeof target === 'number' ? (target < 1 ? `${(target * 100).toFixed(0)}%` : target) : target}</span>
                              <span className={`text-sm font-mono font-medium ${met ? 'text-green-400' : 'text-white/40'}`}>
                                {typeof actual === 'number' ? (actual < 1 && actual > 0 ? `${(actual * 100).toFixed(1)}%` : actual) : '—'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        {/* SAFLA Metrics */}
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <h2 className="font-semibold text-white/90">SAFLA Oversight</h2>
          </CardHeader>
          <CardBody className="px-4 pb-4 pt-3 space-y-3">
            {saflaMetrics ? (
              <>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/40">Strategy Drift</span>
                    <span className={saflaMetrics.strategyDrift > 0.3 ? 'text-red-400' : 'text-green-400'}>
                      {(saflaMetrics.strategyDrift * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={saflaMetrics.strategyDrift * 100} color={saflaMetrics.strategyDrift > 0.3 ? 'danger' : 'success'} size="sm" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/40">Learning Rate</span>
                    <span className="text-white/60">{(saflaMetrics.learningRate * 100).toFixed(1)}%</span>
                  </div>
                  <Progress value={saflaMetrics.learningRate * 100} color="primary" size="sm" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/40">Feedback Loop Health</span>
                    <span className="text-white/60">{(saflaMetrics.feedbackLoopHealth * 100).toFixed(0)}%</span>
                  </div>
                  <Progress value={saflaMetrics.feedbackLoopHealth * 100} color="primary" size="sm" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/40">Decision Accuracy</span>
                    <span className="text-white/60">{(saflaMetrics.autonomousDecisionAccuracy * 100).toFixed(0)}%</span>
                  </div>
                  <Progress value={saflaMetrics.autonomousDecisionAccuracy * 100} color="primary" size="sm" />
                </div>
                <Divider className="bg-white/5" />
                <div className="text-xs text-white/30">
                  <div>Interventions (24h): {saflaMetrics.interventionRate}</div>
                  <div>Last calibration: {new Date(saflaMetrics.lastCalibration).toLocaleString()}</div>
                </div>
              </>
            ) : (
              <div className="text-sm text-white/30">Loading SAFLA metrics...</div>
            )}

            <Divider className="bg-white/5" />
            <h3 className="text-xs font-medium text-white/50">Learning Summary</h3>
            {summary && (
              <div className="space-y-1">
                {Object.entries(summary.byCategory || {}).map(([cat, count]) => (
                  <div key={cat} className="flex justify-between text-xs">
                    <Chip size="sm" variant="flat" color={categoryColor(cat)}>{cat}</Chip>
                    <span className="text-white/50">{count as number}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Bayesian Trait Model */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <div className="flex items-center justify-between w-full">
            <h2 className="font-semibold text-white/90">Bayesian Trait Model</h2>
            <div className="flex gap-2">
              {traitMetrics && (
                <>
                  <Chip size="sm" variant="flat" color="primary">Score: {(traitMetrics.overallScore * 100).toFixed(0)}%</Chip>
                  {traitMetrics.improvement !== 0 && (
                    <Chip size="sm" variant="flat" color={traitMetrics.improvement > 0 ? 'success' : 'danger'}>
                      {traitMetrics.improvement > 0 ? '+' : ''}{traitMetrics.improvement}% improvement
                    </Chip>
                  )}
                  <Chip size="sm" variant="bordered" color="default">{traitMetrics.traitsTracked} traits</Chip>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardBody className="px-4 pb-4 pt-3">
          {traits.length === 0 ? (
            <div className="text-center py-6">
              <div className="text-white/30 text-sm">No traits established yet.</div>
              <div className="text-white/20 text-xs mt-1">
                As the system generates signals and executes trades, it builds persistent statistical patterns.
                Each trait starts with an uninformative prior (50%) and updates via Bayesian inference with every outcome.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {traits.map(trait => {
                const trendIcon = trait.trend === 'improving' ? '↑' : trait.trend === 'degrading' ? '↓' : '→';
                const trendColor = trait.trend === 'improving' ? 'text-green-400' : trait.trend === 'degrading' ? 'text-red-400' : 'text-white/30';
                return (
                  <div key={trait.id} className="p-3 rounded-lg bg-white/5 border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white/80">{trait.name}</span>
                        <Chip size="sm" variant="flat" color={categoryColor(trait.category)}>{trait.category}</Chip>
                        <span className={`text-sm ${trendColor}`}>{trendIcon}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-white/40">{trait.observations} obs</span>
                        <span className="text-white/40">{trait.successes}W / {trait.failures}L</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-white/40">Belief (posterior)</span>
                          <span className={trait.posterior >= 0.6 ? 'text-green-400' : trait.posterior <= 0.4 ? 'text-red-400' : 'text-white/60'}>
                            {(trait.posterior * 100).toFixed(1)}%
                          </span>
                        </div>
                        <Progress value={trait.posterior * 100} color={trait.posterior >= 0.6 ? 'success' : trait.posterior <= 0.4 ? 'danger' : 'primary'} size="sm" />
                      </div>
                      <div className="w-24">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-white/40">Confidence</span>
                          <span className="text-white/60">{(trait.confidence * 100).toFixed(0)}%</span>
                        </div>
                        <Progress value={trait.confidence * 100} color="default" size="sm" />
                      </div>
                      {trait.avgReturn !== 0 && (
                        <div className="text-right w-20">
                          <div className="text-xs text-white/40">Avg Return</div>
                          <div className={`text-sm font-mono ${trait.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {trait.avgReturn >= 0 ? '+' : ''}{trait.avgReturn.toFixed(2)}%
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Learning Feed */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full gap-2">
            <h2 className="font-semibold text-white/90">System Learnings</h2>
            <Tabs
              size="sm"
              variant="light"
              selectedKey={selectedCategory}
              onSelectionChange={(key) => handleCategoryChange(key as string)}
              classNames={{ tabList: 'bg-white/5', tab: 'text-xs' }}
            >
              <Tab key="all" title="All" />
              <Tab key="signal" title="Signals" />
              <Tab key="trade" title="Trades" />
              <Tab key="risk" title="Risk" />
              <Tab key="strategy" title="Strategy" />
              <Tab key="market" title="Market" />
            </Tabs>
          </div>
        </CardHeader>
        <CardBody className="px-4 pb-4 pt-3">
          {learnings.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-white/30 text-sm">No learnings recorded yet.</div>
              <div className="text-white/20 text-xs mt-1">The system will record observations, insights, patterns, and warnings as it operates.</div>
              <div className="text-white/20 text-xs mt-1">Generate a signal scan or execute a trade to see learnings appear here.</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {learnings.map(entry => {
                const ti = typeIcon(entry.type);
                return (
                  <div key={entry.id} className="flex gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                    <span className={`text-lg ${ti.color} shrink-0 mt-0.5`}>{ti.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-white/80">{entry.title}</span>
                        <Chip size="sm" variant="flat" color={categoryColor(entry.category)}>{entry.category}</Chip>
                        <Chip size="sm" variant="bordered" color="default" className="text-xs">{entry.type}</Chip>
                      </div>
                      <p className="text-xs text-white/50">{entry.detail}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-white/20">{new Date(entry.timestamp).toLocaleString()}</span>
                        <span className="text-xs text-white/20">via {entry.source}</span>
                        {entry.allenReference && (
                          <Chip size="sm" variant="dot" color="warning" className="text-xs">{entry.allenReference}</Chip>
                        )}
                      </div>
                      {entry.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {entry.tags.map(t => <span key={t} className="text-xs text-white/20 bg-white/5 px-1.5 py-0.5 rounded">{t}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

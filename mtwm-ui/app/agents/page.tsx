'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Progress, Divider, Button, Switch, Select, SelectItem } from '@heroui/react';

interface AgentDef {
  id: string;
  name: string;
  role: string;
  description: string;
  module: string;
  capabilities: string[];
  status: 'active' | 'idle' | 'error' | 'pending' | 'busy';
  currentTask?: string;
  stats: {
    tasksCompleted: number;
    uptime: string;
    lastAction?: string;
  };
}

interface AutonomyConfig {
  enabled: boolean;
  heartbeatIntervalMs: number;
  autonomyLevel: 'observe' | 'suggest' | 'act';
  nightMode: boolean;
  nightStart: number;
  nightEnd: number;
  enabledAgents: string[];
}

interface ActivityEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  detail: string;
  result: 'success' | 'skipped' | 'error';
  autonomyLevel: string;
}

const AGENT_ROSTER: AgentDef[] = [
  {
    id: 'neural-trader',
    name: 'Neural Trader',
    role: 'Trader',
    description: 'Scans market data using 7-vote intelligence system: RSI, MACD, Bollinger Bands, EMA stack, momentum, mean reversion, and ruv-FANN neural forecast (LSTM+GRU ensemble). 60% minimum confidence, 1.5:1 reward/risk required.',
    module: 'trading',
    capabilities: ['Signal generation', 'Technical analysis', 'Neural forecasting (LSTM+GRU)', 'Pattern recognition', 'Confidence scoring'],
    status: 'active',
    currentTask: 'Scanning market signals',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'mincut-optimizer',
    name: 'MinCut',
    role: 'Portfolio Analyst',
    description: 'Optimizes portfolio allocation using Kelly criterion position sizing, correlation analysis, and sector concentration limits.',
    module: 'trading',
    capabilities: ['Position sizing', 'Kelly criterion', 'Correlation analysis', 'Rebalancing'],
    status: 'idle',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'safla-oversight',
    name: 'SAFLA',
    role: 'Risk Overseer',
    description: 'Meta-cognitive oversight agent. Monitors strategy drift, tracks feedback loop health, and triggers recalibration when performance degrades.',
    module: 'governance',
    capabilities: ['Drift detection', 'Feedback analysis', 'Recalibration triggers', 'Intervention tracking'],
    status: 'active',
    currentTask: 'Monitoring strategy drift',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'midstream-feed',
    name: 'MidStream',
    role: 'Data Analyst',
    description: 'Ingests real-time market data from Alpaca (stocks + crypto). Provides price feeds to all other agents via the event bus.',
    module: 'data',
    capabilities: ['Stock data ingestion', 'Crypto data ingestion', 'Price streaming', 'Watchlist management'],
    status: 'active',
    currentTask: 'Market data ingestion',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'qudag-witness',
    name: 'QuDAG Witness',
    role: 'Compliance Officer',
    description: 'Records all system events to the SHA-256 witness chain. Ensures full auditability and tamper-proof record of every decision and trade.',
    module: 'governance',
    capabilities: ['Event recording', 'Chain verification', 'Credential vault', 'Audit trail'],
    status: 'active',
    currentTask: 'Recording witness chain',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'authority-matrix',
    name: 'Authority Matrix',
    role: 'Governance Lead',
    description: 'Enforces three-phase trading thresholds. Routes decisions to autonomous execution, notification, or owner approval based on amount and phase.',
    module: 'governance',
    capabilities: ['Threshold enforcement', 'Decision routing', 'Phase management', 'Daily volume tracking'],
    status: 'active',
    currentTask: 'Enforcing governance rules',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'trait-learner',
    name: 'Trait Engine',
    role: 'Learning Specialist',
    description: 'Builds persistent Bayesian statistical models from every signal and trade outcome. Tracks improvement over time via posterior updates.',
    module: 'learning',
    capabilities: ['Bayesian inference', 'Pattern tracking', 'Trend detection', 'Improvement metrics'],
    status: 'active',
    currentTask: 'Updating trait posteriors',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'ruv-swarm',
    name: 'ruv-FANN Neural',
    role: 'Neural Intelligence',
    description: 'Ephemeral LSTM and GRU neural networks via ruv-swarm. Trains on recent price history, predicts next-bar direction, and provides the 7th vote in the signal system. CPU-native, sub-100ms inference.',
    module: 'intelligence',
    capabilities: ['LSTM forecasting', 'GRU prediction', 'Ensemble agreement', 'Ephemeral networks', 'Time-series analysis'],
    status: 'active',
    currentTask: 'Neural price forecasting',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'analyst-agent',
    name: 'Analyst Agent',
    role: 'Opportunity Scanner',
    description: 'Runs 24/7 deep scans across all assets. Identifies oversold bounces, short candidates, defense/DoD momentum plays, and inverse ETF opportunities. Finds deals in any market condition — bull, bear, or sideways.',
    module: 'trading',
    capabilities: ['Oversold bounce detection', 'Short candidate identification', 'Defense sector analysis', 'Inverse ETF timing', 'Cross-asset scanning'],
    status: 'active',
    currentTask: 'Scanning 23 assets for opportunities',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 'goalie-planner',
    name: 'Goalie GOAP',
    role: 'Strategic Planner',
    description: 'Goal-Oriented Action Planning with A* pathfinding. Computes the optimal path from current capital to target. Continuously evaluates progress and adjusts strategy via dynamic replanning.',
    module: 'intelligence',
    capabilities: ['GOAP A* planning', 'Outcome-based strategy', 'Dynamic replanning', 'Progress evaluation', 'Phase management'],
    status: 'active',
    currentTask: 'Evaluating $5K → $15K strategy',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 're-scout',
    name: 'Property Scout',
    role: 'Deal Sourcer',
    description: 'Scans MLS, FSBO, auction, and foreclosure listings in Olympia/Tumwater WA. Filters by Nothing Down viability and cash flow metrics.',
    module: 'realestate',
    capabilities: ['Listing aggregation', 'Price filtering', 'DOM tracking', 'Motivated seller scoring'],
    status: 'pending',
    stats: { tasksCompleted: 0, uptime: '—', lastAction: 'Awaiting property pipeline activation' },
  },
  {
    id: 're-analyst',
    name: 'Deal Analyst',
    role: 'Underwriter',
    description: 'Deep financial analysis: cap rate, cash-on-cash, DSCR, Kelly position sizing. Applies Allen deal scoring with sublinear optimization.',
    module: 'realestate',
    capabilities: ['NOI calculation', 'Debt service analysis', 'Allen score computation', 'Kelly allocation'],
    status: 'pending',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 're-negotiator',
    name: 'Offer Strategist',
    role: 'Negotiator',
    description: 'Designs optimal offer structures using Nothing Down techniques. Selects between seller financing, lease options, subject-to, and wraps.',
    module: 'realestate',
    capabilities: ['Offer letter drafting', 'Term negotiation', 'Counter-offer strategy', 'Creative term sheets'],
    status: 'pending',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 're-outreach',
    name: 'Owner Outreach',
    role: 'Acquisitions Rep',
    description: 'Reaches out to property owners directly — FSBO, expired listings, pre-foreclosure, absentee owners. Presents Nothing Down proposals.',
    module: 'realestate',
    capabilities: ['Owner contact research', 'Outreach letter generation', 'Follow-up scheduling', 'Response tracking'],
    status: 'pending',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 're-compliance',
    name: 'RE Compliance',
    role: 'Due Diligence',
    description: 'Verifies property details, title status, liens, zoning, and regulatory compliance for Thurston County before LOI.',
    module: 'realestate',
    capabilities: ['Title search', 'Property tax verification', 'Zoning lookup', 'Environmental check'],
    status: 'pending',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
  {
    id: 're-portfolio',
    name: 'RE Portfolio Mgr',
    role: 'Portfolio Optimizer',
    description: 'Manages RE portfolio allocation using MinCut Kelly criterion. Monitors reinvestment threshold from trading profits.',
    module: 'realestate',
    capabilities: ['Kelly allocation', 'Sector balance', 'Cash flow aggregation', 'Reinvestment monitoring'],
    status: 'pending',
    stats: { tasksCompleted: 0, uptime: '—' },
  },
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDef[]>(AGENT_ROSTER);
  const [swarmStats, setSwarmStats] = useState({ activeAgents: 0, queuedTasks: 0, completedToday: 0 });
  const [autonomyConfig, setAutonomyConfig] = useState<AutonomyConfig | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [autonomyStatus, setAutonomyStatus] = useState<any>(null);

  const fetchAutonomy = useCallback(() => {
    fetch('/api/autonomy?endpoint=config')
      .then(r => r.json())
      .then(data => { if (!data.error) setAutonomyConfig(data); })
      .catch(() => {});
    fetch('/api/autonomy?endpoint=activity')
      .then(r => r.json())
      .then(data => { if (data.activity) setActivity(data.activity); })
      .catch(() => {});
    fetch('/api/autonomy?endpoint=status')
      .then(r => r.json())
      .then(data => { if (!data.error) setAutonomyStatus(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/system/status')
      .then(r => r.json())
      .then(data => {
        if (data.swarm) {
          setSwarmStats(data.swarm);
          if (data.swarm.agents) {
            setAgents(prev => prev.map(agent => {
              const live = data.swarm.agents.find((a: any) => a.name === agent.id);
              if (live) {
                return { ...agent, status: live.status, currentTask: live.currentTask };
              }
              return agent;
            }));
          }
        }
      })
      .catch(() => {});

    fetch('/api/traits')
      .then(r => r.json())
      .then(data => {
        if (data.metrics) {
          setAgents(prev => prev.map(a => {
            if (a.id === 'trait-learner') {
              return {
                ...a,
                stats: {
                  ...a.stats,
                  tasksCompleted: data.metrics.totalObservations || 0,
                  lastAction: data.metrics.traitsTracked > 0
                    ? `Tracking ${data.metrics.traitsTracked} traits, ${data.metrics.totalObservations} observations`
                    : 'Awaiting first observations',
                },
              };
            }
            return a;
          }));
        }
      })
      .catch(() => {});

    fetchAutonomy();
    const interval = setInterval(fetchAutonomy, 15000);
    return () => clearInterval(interval);
  }, [fetchAutonomy]);

  const toggleAutonomy = async () => {
    const res = await fetch('/api/autonomy?action=toggle', { method: 'POST' });
    const data = await res.json();
    if (!data.error) setAutonomyConfig(data);
    setTimeout(fetchAutonomy, 500);
  };

  const updateAutonomyConfig = async (partial: Partial<AutonomyConfig>) => {
    const res = await fetch('/api/autonomy?action=config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (!data.error) setAutonomyConfig(data);
  };

  const statusColor = (s: string): 'success' | 'warning' | 'danger' | 'default' => {
    switch (s) {
      case 'active': case 'busy': return 'success';
      case 'idle': return 'warning';
      case 'error': return 'danger';
      default: return 'default';
    }
  };

  const moduleColor = (m: string): 'primary' | 'success' | 'warning' | 'secondary' | 'default' => {
    switch (m) {
      case 'trading': return 'primary';
      case 'governance': return 'secondary';
      case 'data': return 'success';
      case 'learning': return 'warning';
      case 'realestate': return 'success';
      default: return 'default';
    }
  };

  const resultColor = (r: string): 'success' | 'warning' | 'danger' | 'default' => {
    switch (r) {
      case 'success': return 'success';
      case 'skipped': return 'warning';
      case 'error': return 'danger';
      default: return 'default';
    }
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const activeCount = agents.filter(a => a.status === 'active' || a.status === 'busy').length;

  const intervalOptions = [
    { value: '60000', label: '1 min' },
    { value: '300000', label: '5 min' },
    { value: '600000', label: '10 min' },
    { value: '1800000', label: '30 min' },
    { value: '3600000', label: '1 hour' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agent Team</h1>
          <p className="text-sm text-white/40 mt-1">Persistent agents with distinct roles managing portfolio operations</p>
        </div>
        <div className="flex gap-2">
          <Chip size="sm" variant="flat" color="success">{activeCount} active</Chip>
          <Chip size="sm" variant="flat" color="default">{agents.length} total</Chip>
        </div>
      </div>

      {/* Swarm Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{activeCount}</div>
            <div className="text-xs text-white/40">Active Agents</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4 text-center">
            <div className="text-2xl font-bold text-white/80">{swarmStats.queuedTasks}</div>
            <div className="text-xs text-white/40">Queued Tasks</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4 text-center">
            <div className="text-2xl font-bold text-white/80">{swarmStats.completedToday}</div>
            <div className="text-xs text-white/40">Completed Today</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40 mb-1">Agent Utilization</div>
            <Progress value={(activeCount / agents.length) * 100} color="primary" size="sm" />
            <div className="text-xs text-white/30 mt-1 text-right">{Math.round((activeCount / agents.length) * 100)}%</div>
          </CardBody>
        </Card>
      </div>

      {/* Autonomous Operations — OpenClaw-style */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="flex justify-between items-center px-4 pt-4 pb-0">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-white/90">Autonomous Operations</h3>
            <Chip size="sm" variant="flat" color={autonomyConfig?.enabled ? 'success' : 'default'}>
              {autonomyConfig?.enabled ? 'Running' : 'Stopped'}
            </Chip>
            {autonomyStatus?.isNightMode && (
              <Chip size="sm" variant="flat" color="warning">Night Mode</Chip>
            )}
          </div>
          <div className="flex items-center gap-4">
            {autonomyStatus?.heartbeatCount > 0 && (
              <span className="text-xs text-white/30">{autonomyStatus.heartbeatCount} heartbeats</span>
            )}
            <Switch
              size="sm"
              isSelected={autonomyConfig?.enabled || false}
              onValueChange={toggleAutonomy}
              color="success"
            />
          </div>
        </CardHeader>
        <CardBody className="px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Config Panel */}
            <div className="space-y-3">
              <div className="text-xs text-white/50 font-medium uppercase tracking-wider">Configuration</div>

              <div>
                <div className="text-xs text-white/40 mb-1">Autonomy Level</div>
                <div className="flex gap-1">
                  {(['observe', 'suggest', 'act'] as const).map(level => (
                    <Button
                      key={level}
                      size="sm"
                      variant={autonomyConfig?.autonomyLevel === level ? 'solid' : 'flat'}
                      color={level === 'act' ? 'danger' : level === 'suggest' ? 'warning' : 'primary'}
                      onPress={() => updateAutonomyConfig({ autonomyLevel: level })}
                      className="capitalize text-xs"
                    >
                      {level}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-white/25 mt-1">
                  {autonomyConfig?.autonomyLevel === 'observe' && 'Monitor only — no autonomous actions'}
                  {autonomyConfig?.autonomyLevel === 'suggest' && 'Generate signals and suggestions, queue for approval'}
                  {autonomyConfig?.autonomyLevel === 'act' && 'Execute within Authority Matrix thresholds'}
                </p>
              </div>

              <div>
                <div className="text-xs text-white/40 mb-1">Heartbeat Interval</div>
                <Select
                  size="sm"
                  selectedKeys={autonomyConfig ? [String(autonomyConfig.heartbeatIntervalMs)] : []}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    if (val) updateAutonomyConfig({ heartbeatIntervalMs: parseInt(val) });
                  }}
                  className="max-w-[140px]"
                  aria-label="Heartbeat interval"
                >
                  {intervalOptions.map(opt => (
                    <SelectItem key={opt.value}>{opt.label}</SelectItem>
                  ))}
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  size="sm"
                  isSelected={autonomyConfig?.nightMode || false}
                  onValueChange={(v) => updateAutonomyConfig({ nightMode: v })}
                />
                <span className="text-xs text-white/40">Night mode ({autonomyConfig?.nightStart || 22}:00–{autonomyConfig?.nightEnd || 7}:00)</span>
              </div>
            </div>

            {/* Enabled Agents */}
            <div className="space-y-3">
              <div className="text-xs text-white/50 font-medium uppercase tracking-wider">Enabled Agents</div>
              <div className="space-y-1.5">
                {agents.map(agent => (
                  <div key={agent.id} className="flex items-center gap-2">
                    <Switch
                      size="sm"
                      isSelected={autonomyConfig?.enabledAgents?.includes(agent.id) || false}
                      onValueChange={(v) => {
                        if (!autonomyConfig) return;
                        const updated = v
                          ? [...autonomyConfig.enabledAgents, agent.id]
                          : autonomyConfig.enabledAgents.filter(a => a !== agent.id);
                        updateAutonomyConfig({ enabledAgents: updated });
                      }}
                    />
                    <span className="text-xs text-white/60">{agent.name}</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${agent.status === 'active' || agent.status === 'busy' ? 'bg-green-400' : 'bg-white/20'}`} />
                  </div>
                ))}
              </div>
            </div>

            {/* Activity Feed */}
            <div className="space-y-3">
              <div className="text-xs text-white/50 font-medium uppercase tracking-wider">Activity Feed</div>
              <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
                {activity.length === 0 ? (
                  <div className="text-xs text-white/25 py-4 text-center">
                    Enable autonomy to begin heartbeat operations
                  </div>
                ) : (
                  activity.slice(0, 20).map(entry => (
                    <div key={entry.id} className="p-2 rounded bg-white/[0.03] border border-white/[0.03]">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Chip size="sm" variant="dot" color={resultColor(entry.result)} className="h-4 text-[10px]">
                          {entry.agent}
                        </Chip>
                        <span className="text-[10px] text-white/20 ml-auto">{formatTime(entry.timestamp)}</span>
                      </div>
                      <p className="text-[11px] text-white/40 leading-tight">{entry.detail}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map(agent => (
          <Card key={agent.id} className="bg-white/5 border border-white/5">
            <CardBody className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.status === 'active' || agent.status === 'busy' ? 'bg-green-400 animate-pulse' : agent.status === 'idle' ? 'bg-yellow-400' : agent.status === 'error' ? 'bg-red-400' : 'bg-white/20'}`} />
                  <h3 className="text-sm font-semibold text-white/90">{agent.name}</h3>
                  <Chip size="sm" variant="flat" color={statusColor(agent.status)}>{agent.status}</Chip>
                </div>
                <div className="flex gap-1">
                  <Chip size="sm" variant="bordered" color={moduleColor(agent.module)}>{agent.module}</Chip>
                  <Chip size="sm" variant="flat" color="default">{agent.role}</Chip>
                </div>
              </div>

              <p className="text-xs text-white/40 mb-3">{agent.description}</p>

              {agent.currentTask && (
                <div className="text-xs text-blue-400/60 mb-2">
                  Current: {agent.currentTask}
                </div>
              )}

              <div className="flex flex-wrap gap-1 mb-3">
                {agent.capabilities.map(cap => (
                  <span key={cap} className="text-xs text-white/25 bg-white/5 px-1.5 py-0.5 rounded">{cap}</span>
                ))}
              </div>

              <Divider className="bg-white/5 mb-2" />
              <div className="flex justify-between text-xs text-white/30">
                <span>{agent.stats.tasksCompleted > 0 ? `${agent.stats.tasksCompleted} tasks` : 'No tasks yet'}</span>
                <span>{agent.stats.lastAction || ''}</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

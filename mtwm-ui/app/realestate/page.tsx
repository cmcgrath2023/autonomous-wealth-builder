'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Card, CardBody, CardHeader, Chip, Button, Divider, Progress,
  Select, SelectItem, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell,
  Tabs, Tab, Tooltip, Accordion, AccordionItem,
} from '@heroui/react';

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
  schedule?: string;
}

const SCHEDULE_OPTIONS = [
  { key: 'once', label: 'One-time' },
  { key: '15m', label: 'Every 15 min' },
  { key: '1h', label: 'Every hour' },
  { key: '4h', label: 'Every 4 hours' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
];

const CATEGORY_ICONS: Record<string, string> = {
  'market-research': '📊',
  'deal-sourcing': '🔍',
  'infrastructure': '⚙️',
  'financial-planning': '💰',
  'networking': '🤝',
};

// --- Sub-Market Comparison Chart (horizontal bars) ---
function SubMarketChart({ data }: { data: Record<string, any> }) {
  const markets = Object.entries(data);
  const maxPrice = Math.max(...markets.map(([, v]) => parseFloat(String(v.medianPrice || '0').replace(/[$K,]/g, '')) || 0));

  return (
    <div className="space-y-3">
      {markets.map(([name, info]: [string, any]) => {
        const price = parseFloat(String(info.medianPrice || '0').replace(/[$K,]/g, '')) || 0;
        const pricePct = maxPrice > 0 ? (price / maxPrice) * 100 : 0;
        const capRate = parseFloat(String(info.capRate || '0').replace('%', '')) || 0;

        return (
          <div key={name} className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-white/90 capitalize">{name}</span>
              <div className="flex gap-2">
                <Chip size="sm" variant="flat" color="primary">{info.medianPrice}</Chip>
                <Chip size="sm" variant="flat" color="success">Cap: {info.capRate}</Chip>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <div className="text-[10px] text-white/40 mb-0.5">Median Price</div>
                <Progress value={pricePct} color="primary" size="sm" />
              </div>
              <div>
                <div className="text-[10px] text-white/40 mb-0.5">Cap Rate</div>
                <Progress value={Math.min(capRate * 10, 100)} color="success" size="sm" />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/50">Rent: {info.rent || info.avgRent}</span>
              <span className="text-white/50">Vacancy: {info.vacancy}</span>
            </div>
            {info.notes && <p className="text-[11px] text-white/30 mt-1">{info.notes}</p>}
            {info.bestFor && <p className="text-[11px] text-blue-400/60 mt-1">Best for: {info.bestFor}</p>}
          </div>
        );
      })}
    </div>
  );
}

// --- Technique Cards ---
function TechniqueCards({ techniques }: { techniques: any[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {techniques.map((t: any, i: number) => (
        <Card key={i} className="bg-white/[0.03] border border-white/5">
          <CardBody className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-white/90">{t.technique || t.name}</span>
              <Chip size="sm" variant="flat" color={
                (t.viability || '').includes('HIGH') ? 'success' :
                (t.viability || '').includes('MODERATE') ? 'warning' : 'default'
              }>{t.viability || t.risk || '—'}</Chip>
            </div>
            <p className="text-xs text-white/40">{t.notes || t.desc}</p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

// --- Company Table ---
function CompanyTable({ companies }: { companies: any[] }) {
  return (
    <Table aria-label="Companies" classNames={{ wrapper: 'bg-transparent shadow-none', th: 'bg-white/5 text-white/50', td: 'text-white/70' }}>
      <TableHeader>
        <TableColumn>Company</TableColumn>
        <TableColumn>Area</TableColumn>
        <TableColumn>Fee</TableColumn>
        <TableColumn>Notes</TableColumn>
      </TableHeader>
      <TableBody>
        {companies.map((c: any, i: number) => (
          <TableRow key={i}>
            <TableCell><span className="text-sm font-medium">{c.name}</span></TableCell>
            <TableCell><span className="text-xs">{c.area}</span></TableCell>
            <TableCell><Chip size="sm" variant="flat" color="warning">{c.fee}</Chip></TableCell>
            <TableCell><span className="text-xs text-white/50">{c.notes}</span></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// --- Smart Result Renderer ---
function SmartResult({ data }: { data: Record<string, any> }) {
  // Detect sub-market comparison data
  const subMarkets = data.subMarkets || data.comparison;
  const techniques = data.techniquesApplicable;
  const companies = data.companies;

  return (
    <div className="space-y-4">
      {/* Key metrics at top */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {Object.entries(data).map(([k, v]) => {
          if (typeof v !== 'string' && typeof v !== 'number') return null;
          return (
            <div key={k} className="p-2 rounded bg-white/[0.03] border border-white/5">
              <div className="text-[10px] text-white/40 uppercase tracking-wide">
                {k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
              </div>
              <div className="text-sm text-white/80 font-medium mt-0.5">{String(v)}</div>
            </div>
          );
        })}
      </div>

      {/* Sub-market chart */}
      {subMarkets && typeof subMarkets === 'object' && (
        <div>
          <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Sub-Market Comparison</h4>
          <SubMarketChart data={subMarkets as Record<string, any>} />
        </div>
      )}

      {/* Technique cards */}
      {Array.isArray(techniques) && techniques.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Applicable Techniques</h4>
          <TechniqueCards techniques={techniques} />
        </div>
      )}

      {/* Company table */}
      {Array.isArray(companies) && companies.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Companies</h4>
          <CompanyTable companies={companies} />
        </div>
      )}

      {/* Arrays rendered as chips/lists */}
      {Object.entries(data).map(([k, v]) => {
        if (!Array.isArray(v) || k === 'techniquesApplicable' || k === 'companies' || k === 'keyEmployers') return null;
        return (
          <div key={k}>
            <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-1">
              {k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
            </h4>
            <div className="flex flex-wrap gap-1">
              {(v as string[]).map((item, i) => (
                <Chip key={i} size="sm" variant="flat" color="default">{typeof item === 'string' ? item : JSON.stringify(item)}</Chip>
              ))}
            </div>
          </div>
        );
      })}

      {/* Key employers */}
      {Array.isArray(data.keyEmployers) && (
        <div>
          <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-1">Key Employers</h4>
          <div className="flex flex-wrap gap-1">
            {(data.keyEmployers as string[]).map((e, i) => (
              <Chip key={i} size="sm" variant="bordered" color="primary">{e}</Chip>
            ))}
          </div>
        </div>
      )}

      {/* Nested objects (thresholds, fees, etc) */}
      {Object.entries(data).map(([k, v]) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v) || k === 'subMarkets' || k === 'comparison' || k === 'reitBenchmarks') return null;
        return (
          <div key={k}>
            <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
              {k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(v as Record<string, unknown>).map(([sk, sv]) => (
                <div key={sk} className="p-2 rounded bg-white/[0.03] border border-white/5">
                  <div className="text-[10px] text-white/40">{sk.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</div>
                  {typeof sv === 'object' && sv !== null ? (
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(sv as Record<string, unknown>).map(([ssk, ssv]) => (
                        <div key={ssk} className="text-xs">
                          <span className="text-white/40">{ssk.replace(/([A-Z])/g, ' $1')}: </span>
                          <span className="text-white/70">{String(ssv)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-white/80 mt-0.5">{String(sv)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* REIT benchmarks */}
      {data.reitBenchmarks && typeof data.reitBenchmarks === 'object' && Object.keys(data.reitBenchmarks as object).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">REIT Benchmark Prices</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.reitBenchmarks as Record<string, number>).map(([sym, price]) => (
              <Card key={sym} className="bg-white/[0.03] border border-white/5">
                <CardBody className="p-2 text-center">
                  <div className="text-xs text-white/40">{sym}</div>
                  <div className="text-sm font-bold text-green-400">${Number(price).toFixed(2)}</div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Recommendation (always last) */}
      {data.recommendation && (
        <Card className="bg-blue-500/5 border border-blue-500/20">
          <CardBody className="p-3">
            <div className="text-xs font-semibold text-blue-400 mb-1">Recommendation</div>
            <p className="text-sm text-white/70">{String(data.recommendation)}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export default function RealEstatePage() {
  const [tasks, setTasks] = useState<RETask[]>([]);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks');

  const fetchTasks = useCallback(async () => {
    try {
      const r = await fetch('/api/realestate');
      const data = await r.json();
      if (data.tasks) setTasks(data.tasks.map((t: RETask) => ({
        ...t,
        results: t.results || [],
        runCount: t.runCount || 0,
        schedule: t.schedule || 'once',
      })));
    } catch {}
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const executeTask = useCallback(async (id: string) => {
    setRunningTasks(rs => new Set(rs).add(id));
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'in_progress' as const } : t));

    try {
      const resp = await fetch(`/api/realestate/tasks/${id}/execute`, { method: 'POST' });
      const data = await resp.json();
      if (data.task && data.result) {
        setTasks(prev => prev.map(t => t.id === id ? {
          ...t,
          status: 'done' as const,
          completedAt: data.task.completedAt,
          runCount: data.task.runCount,
          lastRun: data.task.lastRun,
          results: [...(t.results || []), data.result],
        } : t));
        setExpandedResults(er => new Set(er).add(id));
      }
    } catch {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'pending' as const } : t));
    } finally {
      setRunningTasks(rs => { const n = new Set(rs); n.delete(id); return n; });
    }
  }, []);

  const runAll = useCallback(async () => {
    setRunningAll(true);
    const pending = tasks.filter(t => t.status === 'pending' || t.status === 'done');
    for (const task of pending) {
      await executeTask(task.id);
    }
    setRunningAll(false);
  }, [tasks, executeTask]);

  const toggleResults = useCallback((id: string) => {
    setExpandedResults(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const setSchedule = useCallback((id: string, schedule: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, schedule } : t));
  }, []);

  const priorityColor = (p: string): 'danger' | 'warning' | 'default' => {
    switch (p) { case 'high': return 'danger'; case 'normal': return 'warning'; default: return 'default'; }
  };

  const statusColor = (s: string): 'warning' | 'primary' | 'success' | 'default' => {
    switch (s) { case 'pending': return 'warning'; case 'in_progress': return 'primary'; case 'done': return 'success'; default: return 'default'; }
  };

  const categoryLabel: Record<string, string> = {
    'market-research': 'Market Research', 'deal-sourcing': 'Deal Sourcing',
    'infrastructure': 'Infrastructure', 'financial-planning': 'Financial Planning', 'networking': 'Networking',
  };

  const doneCount = tasks.filter(t => t.status === 'done').length;
  const pendingCount = tasks.filter(t => t.status === 'pending').length;
  const progressPct = tasks.length > 0 ? (doneCount / tasks.length) * 100 : 0;
  const totalResults = tasks.reduce((s, t) => s + (t.results?.length || 0), 0);
  const completedTasks = tasks.filter(t => t.status === 'done' && t.results.length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Real Estate Pipeline</h1>
          <p className="text-sm text-white/40 mt-1">
            Olympia/Tumwater WA — Allen Nothing Down Strategy
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 && (
            <Button
              size="sm"
              color="primary"
              variant="solid"
              isLoading={runningAll}
              onPress={runAll}
            >
              Run All Tasks ({pendingCount})
            </Button>
          )}
          <Chip size="sm" variant="flat" color="success">{doneCount}/{tasks.length} complete</Chip>
          <Chip size="sm" variant="bordered" color="default">{totalResults} reports</Chip>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40 mb-1">Pipeline Progress</div>
            <Progress value={progressPct} color="success" size="md" className="mb-1" />
            <div className="text-lg font-bold text-white/90">{Math.round(progressPct)}%</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{totalResults}</div>
            <div className="text-xs text-white/40">Reports Generated</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4 text-center">
            <div className="text-2xl font-bold text-white/80">$10K–25K</div>
            <div className="text-xs text-white/40">Target (Creative)</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{tasks.length}</div>
            <div className="text-xs text-white/40">Research Tasks</div>
          </CardBody>
        </Card>
      </div>

      {/* Tabs: Tasks vs Reports */}
      <Tabs
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(key as string)}
        variant="underlined"
        classNames={{ tabList: 'border-b border-white/5', tab: 'text-white/60' }}
      >
        <Tab key="tasks" title={`Task Queue (${tasks.length})`} />
        <Tab key="reports" title={`Reports (${totalResults})`} />
        <Tab key="strategies" title="Nothing Down Strategies" />
      </Tabs>

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div className="space-y-3">
          {tasks.map(task => (
            <Card
              key={task.id}
              className={`border ${
                task.status === 'done' ? 'bg-green-500/5 border-green-500/10' :
                task.status === 'in_progress' ? 'bg-blue-500/5 border-blue-500/10' :
                'bg-white/5 border-white/5'
              }`}
            >
              <CardBody className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-base">{CATEGORY_ICONS[task.category] || '📋'}</span>
                      <Chip size="sm" variant="flat" color={priorityColor(task.priority)}>{task.priority}</Chip>
                      <Chip size="sm" variant="bordered" color="default">{categoryLabel[task.category] || task.category}</Chip>
                      <Chip size="sm" variant="dot" color={statusColor(task.status)}>{task.status.replace('_', ' ')}</Chip>
                      {task.runCount > 0 && (
                        <span className="text-[10px] text-white/25">{task.runCount} run{task.runCount !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-white/90">{task.title}</h4>
                    <p className="text-xs text-white/35 mt-1">{task.detail}</p>
                    {task.lastRun && (
                      <div className="text-[10px] text-white/20 mt-1">
                        Last run: {new Date(task.lastRun).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 sm:ml-4 items-start sm:items-end sm:min-w-[150px]">
                    {task.status === 'pending' && (
                      <Button size="sm" variant="solid" color="primary" onPress={() => executeTask(task.id)}
                        isLoading={runningTasks.has(task.id)}>
                        Run Task
                      </Button>
                    )}
                    {task.status === 'in_progress' && (
                      <Chip size="sm" variant="flat" color="primary" className="animate-pulse">Executing...</Chip>
                    )}
                    {task.status === 'done' && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="flat" color="default" onPress={() => executeTask(task.id)}
                          isLoading={runningTasks.has(task.id)}>
                          Re-run
                        </Button>
                        {task.results?.length > 0 && (
                          <Button size="sm" variant="flat" color="success" onPress={() => toggleResults(task.id)}>
                            {expandedResults.has(task.id) ? 'Hide' : 'View'}
                          </Button>
                        )}
                      </div>
                    )}
                    <Select
                      size="sm" variant="bordered"
                      selectedKeys={[task.schedule || 'once']}
                      onChange={(e) => setSchedule(task.id, e.target.value)}
                      className="max-w-[130px]"
                      classNames={{ trigger: 'h-7 min-h-7 bg-white/[0.03] border-white/10', value: 'text-[11px] text-white/50' }}
                      aria-label="Schedule"
                    >
                      {SCHEDULE_OPTIONS.map(opt => (
                        <SelectItem key={opt.key}>{opt.label}</SelectItem>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* Expanded results */}
                {expandedResults.has(task.id) && task.results?.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    {task.results.slice().reverse().map((result, i) => (
                      <div key={i} className={`${i > 0 ? 'mt-4 pt-4 border-t border-white/5' : ''}`}>
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <Chip size="sm" variant="flat" color="success">Report #{task.results.length - i}</Chip>
                          <span className="text-[10px] text-white/30">{new Date(result.timestamp).toLocaleString()}</span>
                          <Chip size="sm" variant="bordered" color="default" className="text-[10px]">{result.source}</Chip>
                        </div>
                        <div className="text-sm text-white/70 font-medium mb-3">{result.summary}</div>
                        <SmartResult data={result.data} />
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          {completedTasks.length === 0 ? (
            <Card className="bg-white/5 border border-white/5">
              <CardBody className="p-8 text-center">
                <div className="text-white/40 text-sm mb-2">No reports generated yet.</div>
                <Button size="sm" color="primary" variant="flat" onPress={() => setActiveTab('tasks')}>
                  Go to Task Queue
                </Button>
              </CardBody>
            </Card>
          ) : (
            <Accordion variant="splitted" className="gap-3">
              {completedTasks.map(task => (
                <AccordionItem
                  key={task.id}
                  title={
                    <div className="flex items-center gap-2">
                      <span>{CATEGORY_ICONS[task.category] || '📋'}</span>
                      <span className="text-sm font-medium">{task.title}</span>
                      <Chip size="sm" variant="flat" color="success">{task.results.length} report{task.results.length !== 1 ? 's' : ''}</Chip>
                    </div>
                  }
                  classNames={{ base: 'bg-white/5 border border-white/5', title: 'text-white/90', content: 'text-white/60' }}
                >
                  {task.results.slice().reverse().map((result, i) => (
                    <div key={i} className={`${i > 0 ? 'mt-4 pt-4 border-t border-white/5' : ''} pb-2`}>
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="text-xs text-white/30">{new Date(result.timestamp).toLocaleString()}</span>
                        <Chip size="sm" variant="bordered" color="default" className="text-[10px]">{result.source}</Chip>
                      </div>
                      <div className="text-sm text-white/70 font-medium mb-3">{result.summary}</div>
                      <SmartResult data={result.data} />
                    </div>
                  ))}
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      )}

      {/* Strategies Tab */}
      {activeTab === 'strategies' && (
        <div className="space-y-4">
          <Card className="bg-white/5 border border-white/5">
            <CardHeader className="px-4 pt-4 pb-0">
              <h3 className="font-semibold text-white/90">Nothing Down Techniques — Olympia/Tumwater WA</h3>
            </CardHeader>
            <CardBody className="px-4 pb-4 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { name: 'Seller Financing', risk: 'low', viability: 'HIGH', desc: 'Negotiate seller-held mortgages. Common with FSBO properties and retiring landlords in Olympia. ~12% FSBO rate.' },
                  { name: 'Lease Option', risk: 'low', viability: 'HIGH', desc: 'Control property with option to buy. Strong rental demand supports lease-option approach with state worker tenant base.' },
                  { name: 'Subject-To', risk: 'medium', viability: 'MODERATE', desc: 'Take over existing mortgage payments. Works with motivated sellers. WA state allows subject-to transactions.' },
                  { name: 'Wraparound Mortgage', risk: 'medium', viability: 'MODERATE', desc: 'Create new mortgage wrapping existing. Useful where seller has low-rate existing mortgage.' },
                  { name: 'Hard Money + Refi', risk: 'medium', viability: 'MODERATE', desc: 'Short-term purchase, then refinance. Best for distressed properties needing $20K-$50K renovation. Local HML: 10-12%.' },
                  { name: 'Partner Split', risk: 'low', viability: 'HIGH', desc: 'MTWM provides deal analysis + management; partner provides down payment. 50/50 equity split. Available with $0 capital.' },
                ].map(tech => (
                  <Card key={tech.name} className="bg-white/[0.03] border border-white/5">
                    <CardBody className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white/90">{tech.name}</span>
                        <div className="flex gap-1">
                          <Chip size="sm" variant="flat" color={tech.risk === 'low' ? 'success' : 'warning'}>{tech.risk} risk</Chip>
                        </div>
                      </div>
                      <Chip size="sm" variant="dot" color={tech.viability === 'HIGH' ? 'success' : 'warning'}>{tech.viability} viability</Chip>
                      <p className="text-xs text-white/40 leading-relaxed">{tech.desc}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card className="bg-white/5 border border-white/5">
            <CardHeader className="px-4 pt-4 pb-0">
              <h3 className="font-semibold text-white/90">Motivated Seller Indicators</h3>
            </CardHeader>
            <CardBody className="px-4 pb-4 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  'Listed 90+ days without price reduction',
                  'Tax-delinquent properties (Thurston County records)',
                  'Pre-foreclosure / NOD filings',
                  'Out-of-state owners (absentee landlords)',
                  'Estate sales / probate properties',
                  'Code violation properties (City of Olympia records)',
                ].map((indicator, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded bg-white/[0.03] border border-white/5">
                    <span className="text-green-400 text-xs">●</span>
                    <span className="text-xs text-white/60">{indicator}</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

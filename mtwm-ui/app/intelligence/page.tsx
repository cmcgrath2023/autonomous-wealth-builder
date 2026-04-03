'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Spinner, Progress } from '@heroui/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis } from 'recharts';

interface Belief {
  id: string;
  subject: string;
  domain: string;
  posterior: number;
  observations: number;
  avgReturn: number;
}

interface BayesianStats {
  totalBeliefs: number;
  totalObservations: number;
  byDomain: Record<string, number>;
  topInsights: string[];
}

interface IntelMetrics {
  currentAccuracy: number;
  accuracyTrend: string;
  totalPredictions: number;
  cumulativeRegret: number;
}

interface TridentMemory {
  id: string;
  title: string;
  category: string;
  tags: string[];
  content?: string;
}

interface SonaStatus {
  patterns: number;
  memories: number;
  pareto: number;
  connected: boolean;
  tier: string;
}

const REFRESH_MS = 30_000;

export default function IntelligencePage() {
  const [bayesian, setBayesian] = useState<BayesianStats | null>(null);
  const [metrics, setMetrics] = useState<IntelMetrics | null>(null);
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [tridentMemories, setTridentMemories] = useState<TridentMemory[]>([]);
  const [sonaStatus, setSonaStatus] = useState<SonaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, metricsRes, topRes, worstRes] = await Promise.allSettled([
        fetch('/api/gateway?path=/api/status'),
        fetch('/api/gateway?path=/api/intelligence/metrics'),
        fetch('/api/gateway?path=/api/intelligence/top-performers'),
        fetch('/api/gateway?path=/api/intelligence/worst-performers'),
      ]);

      if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
        const d = await statusRes.value.json();
        setBayesian(d.bayesianIntel || null);
      }
      if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
        const d = await metricsRes.value.json();
        setMetrics(d);
      }

      // Combine top + worst performers into beliefs
      const allBeliefs: Belief[] = [];
      if (topRes.status === 'fulfilled' && topRes.value.ok) {
        const d = await topRes.value.json();
        for (const p of d.performers || []) allBeliefs.push({ ...p, domain: 'top' });
      }
      if (worstRes.status === 'fulfilled' && worstRes.value.ok) {
        const d = await worstRes.value.json();
        for (const p of d.performers || []) allBeliefs.push({ ...p, domain: 'worst' });
      }
      setBeliefs(allBeliefs);

      // Trident memories — fetch via gateway proxy (gateway has Brain credentials)
      try {
        const tridentRes = await fetch('/api/gateway/intelligence/trident');
        if (tridentRes.ok) {
          const d = await tridentRes.json();
          setTridentMemories(d.memories || []);
          setSonaStatus(d.sona || null);
        }
      } catch {}
    } catch (e) {
      console.error('Intelligence refresh failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (loading) return <div className="flex justify-center items-center h-64"><Spinner size="lg" /></div>;

  const preferredTickers = beliefs.filter(b => b.domain === 'top' && b.posterior > 0.6);
  const avoidTickers = beliefs.filter(b => b.domain === 'worst' && b.posterior < 0.4);

  // Knowledge graph data — beliefs as nodes sized by observations
  const graphData = beliefs.map(b => ({
    name: b.subject,
    x: b.posterior * 100,
    y: b.avgReturn * 100,
    z: Math.max(b.observations * 20, 60),
    fill: b.posterior > 0.6 ? '#22c55e' : b.posterior < 0.4 ? '#ef4444' : '#eab308',
  }));

  // Bar chart — beliefs sorted by posterior
  const barData = [...beliefs]
    .sort((a, b) => b.posterior - a.posterior)
    .slice(0, 20)
    .map(b => ({
      ticker: b.subject,
      posterior: Math.round(b.posterior * 100),
      observations: b.observations,
      avgReturn: b.avgReturn,
      color: b.posterior > 0.6 ? '#22c55e' : b.posterior < 0.4 ? '#ef4444' : '#eab308',
    }));

  // Trident category breakdown
  const catCounts: Record<string, number> = {};
  for (const m of tridentMemories) {
    const cat = m.tags?.includes('outcome') ? 'Trade Outcomes' :
                m.tags?.includes('entry') ? 'Trade Entries' :
                m.tags?.includes('research') ? 'Research' :
                m.tags?.includes('rule') ? 'Rules' :
                m.tags?.includes('daily') ? 'Daily Summaries' : 'Other';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Intelligence</h1>
        <p className="text-white/50 text-sm mt-1">Brain, Bayesian learnings, and SONA training status</p>
      </div>

      {/* Top metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">Beliefs</div>
            <div className="text-2xl font-bold text-white">{bayesian?.totalBeliefs ?? 0}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">Observations</div>
            <div className="text-2xl font-bold text-white">{bayesian?.totalObservations ?? 0}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">Accuracy</div>
            <div className="text-2xl font-bold text-white">{metrics ? `${(metrics.currentAccuracy * 100).toFixed(0)}%` : '--'}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">SONA Patterns</div>
            <div className="text-2xl font-bold text-white">{sonaStatus?.patterns?.toLocaleString() ?? '--'}</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <div className="text-white/40 text-xs mb-1">Trident Memories</div>
            <div className="text-2xl font-bold text-white">{tridentMemories.length || '--'}</div>
          </CardBody>
        </Card>
      </div>

      {/* Trident connection + SONA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-white/5 border border-white/10">
          <CardHeader className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-white/80">Trident (Brain MCP)</h3>
            <Chip size="sm" color={sonaStatus?.connected ? 'success' : 'danger'} variant="flat" className="ml-auto">
              {sonaStatus?.connected ? 'Connected' : 'Disconnected'}
            </Chip>
          </CardHeader>
          <CardBody className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-white/40">Tier:</span> <span className="text-white ml-1">{sonaStatus?.tier || 'unknown'}</span></div>
              <div><span className="text-white/40">Memories:</span> <span className="text-white ml-1">{sonaStatus?.memories?.toLocaleString() || 0}</span></div>
              <div><span className="text-white/40">SONA Patterns:</span> <span className="text-white ml-1">{sonaStatus?.patterns?.toLocaleString() || 0}</span></div>
              <div><span className="text-white/40">Pareto Front:</span> <span className="text-white ml-1">{sonaStatus?.pareto?.toLocaleString() || 0}</span></div>
            </div>
            {Object.keys(catCounts).length > 0 && (
              <div className="space-y-1.5 mt-2">
                <div className="text-xs text-white/40 mb-1">Memory Breakdown</div>
                {Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                  <div key={cat} className="flex items-center gap-2 text-xs">
                    <span className="text-white/60 w-28">{cat}</span>
                    <Progress value={count} maxValue={Math.max(...Object.values(catCounts))} size="sm" className="flex-1" color="primary" />
                    <span className="text-white/50 w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Bayesian Intelligence */}
        <Card className="bg-white/5 border border-white/10">
          <CardHeader className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-white/80">Bayesian Intelligence</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-white/40 mb-1">Preferred Tickers</div>
                <div className="flex flex-wrap gap-1">
                  {preferredTickers.length > 0 ? preferredTickers.map(b => (
                    <Chip key={b.subject} size="sm" color="success" variant="flat">{b.subject}</Chip>
                  )) : <span className="text-white/30 text-xs">None yet</span>}
                </div>
              </div>
              <div>
                <div className="text-xs text-white/40 mb-1">Avoid Tickers</div>
                <div className="flex flex-wrap gap-1">
                  {avoidTickers.length > 0 ? avoidTickers.map(b => (
                    <Chip key={b.subject} size="sm" color="danger" variant="flat">{b.subject}</Chip>
                  )) : <span className="text-white/30 text-xs">None yet</span>}
                </div>
              </div>
            </div>
            {bayesian?.topInsights && bayesian.topInsights.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-white/40 mb-1">Top Insights</div>
                {bayesian.topInsights.slice(0, 5).map((insight, i) => (
                  <div key={i} className="text-xs text-white/60 py-0.5">{insight}</div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Knowledge Graph — belief scatter plot */}
      {graphData.length > 0 && (
        <Card className="bg-white/5 border border-white/10">
          <CardHeader className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-white/80">Knowledge Graph — Belief Space</h3>
            <span className="text-xs text-white/30 ml-2">x: confidence, y: avg return, size: observations</span>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <XAxis dataKey="x" name="Confidence" unit="%" stroke="#555" tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis dataKey="y" name="Avg Return" unit="%" stroke="#555" tick={{ fill: '#888', fontSize: 11 }} />
                <ZAxis dataKey="z" range={[40, 400]} />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-black/90 border border-white/10 rounded px-3 py-2 text-xs">
                        <div className="text-white font-bold">{d.name}</div>
                        <div className="text-white/60">Confidence: {d.x.toFixed(0)}%</div>
                        <div className="text-white/60">Avg Return: {d.y.toFixed(1)}%</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={graphData}>
                  {graphData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* Belief Rankings */}
      {barData.length > 0 && (
        <Card className="bg-white/5 border border-white/10">
          <CardHeader className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-white/80">Ticker Belief Rankings</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <ResponsiveContainer width="100%" height={Math.max(barData.length * 28, 200)}>
              <BarChart data={barData} layout="vertical" margin={{ left: 50, right: 20 }}>
                <XAxis type="number" domain={[0, 100]} stroke="#555" tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis dataKey="ticker" type="category" stroke="#555" tick={{ fill: '#ccc', fontSize: 11 }} width={48} />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-black/90 border border-white/10 rounded px-3 py-2 text-xs">
                        <div className="text-white font-bold">{d.ticker}</div>
                        <div className="text-white/60">Posterior: {d.posterior}%</div>
                        <div className="text-white/60">Observations: {d.observations}</div>
                        <div className="text-white/60">Avg Return: {(d.avgReturn * 100).toFixed(1)}%</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="posterior" radius={[0, 4, 4, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* Recent Trident Memories */}
      {tridentMemories.length > 0 && (
        <Card className="bg-white/5 border border-white/10">
          <CardHeader className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-white/80">Recent Trident Memories</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {tridentMemories.slice(0, 30).map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-xs py-1 border-b border-white/5">
                  <Chip size="sm" variant="flat" color={
                    m.tags?.includes('win') ? 'success' :
                    m.tags?.includes('loss') ? 'danger' :
                    m.tags?.includes('research') ? 'primary' :
                    'default'
                  }>
                    {m.tags?.includes('outcome') ? 'Trade' :
                     m.tags?.includes('entry') ? 'Buy' :
                     m.tags?.includes('research') ? 'Research' :
                     m.tags?.includes('rule') ? 'Rule' : 'Memory'}
                  </Chip>
                  <span className="text-white/70 flex-1 truncate">{m.title}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

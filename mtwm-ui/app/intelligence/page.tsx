'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardBody, CardHeader, Chip, Spinner, Progress } from '@heroui/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import dynamic from 'next/dynamic';

// Force-graph must be loaded client-side only (uses WebGL)
const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false });

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
}

interface SonaStatus {
  patterns: number;
  memories: number;
  pareto: number;
  connected: boolean;
  tier: string;
}

interface GraphNode {
  id: string;
  name: string;
  group: string;
  val: number;
  color: string;
}

interface GraphLink {
  source: string;
  target: string;
  color: string;
}

const REFRESH_MS = 30_000;

// Build knowledge graph from Trident memories + Bayesian beliefs
function buildGraph(memories: TridentMemory[], beliefs: Belief[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  const addNode = (id: string, name: string, group: string, val: number, color: string) => {
    if (nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({ id, name, group, val, color });
  };

  // Central hub nodes
  addNode('hub:trading', 'Trading', 'hub', 12, '#3b82f6');
  addNode('hub:research', 'Research', 'hub', 10, '#8b5cf6');
  addNode('hub:rules', 'Rules', 'hub', 8, '#f59e0b');
  addNode('hub:sona', 'SONA', 'hub', 10, '#06b6d4');

  // Bayesian beliefs → ticker nodes
  for (const b of beliefs) {
    const color = b.posterior > 0.6 ? '#22c55e' : b.posterior < 0.4 ? '#ef4444' : '#eab308';
    const size = Math.max(3, Math.min(b.observations * 1.5, 15));
    addNode(`ticker:${b.subject}`, b.subject, 'ticker', size, color);
    links.push({ source: 'hub:trading', target: `ticker:${b.subject}`, color: color + '60' });
  }

  // Trident memories → categorized nodes
  const tickerCounts: Record<string, { wins: number; losses: number }> = {};
  const sectors = new Set<string>();
  const researchTickers = new Set<string>();

  for (const m of memories) {
    const tags = m.tags || [];

    if (tags.includes('outcome')) {
      // Trade outcome — extract ticker from tags
      const ticker = tags.find(t => !['trade', 'outcome', 'win', 'loss', 'stop_loss', 'take_profit', 'eod_close', 'trailing_stop', 'rotation', 'premarket_liquidation', 'historical_seed', 'long', 'short', 'momentum', 'entry', 'buy'].includes(t) && t.length >= 1 && t.length <= 10);
      if (ticker) {
        const sym = ticker.toUpperCase().replace('_', '/');
        if (!tickerCounts[sym]) tickerCounts[sym] = { wins: 0, losses: 0 };
        if (tags.includes('win')) tickerCounts[sym].wins++;
        else if (tags.includes('loss')) tickerCounts[sym].losses++;
      }
    } else if (tags.includes('research') || tags.includes('cycle')) {
      // Research cycle — extract mentioned tickers
      for (const t of tags) {
        if (t.length >= 2 && t.length <= 8 && !['research', 'cycle', 'stars'].includes(t)) {
          researchTickers.add(t.toUpperCase());
        }
      }
    } else if (tags.includes('rule')) {
      const ruleId = `rule:${m.id.slice(0, 8)}`;
      addNode(ruleId, m.title.slice(0, 30), 'rule', 4, '#f59e0b');
      links.push({ source: 'hub:rules', target: ruleId, color: '#f59e0b40' });
    }
  }

  // Create ticker nodes from trade history
  for (const [sym, counts] of Object.entries(tickerCounts)) {
    const total = counts.wins + counts.losses;
    const winRate = total > 0 ? counts.wins / total : 0.5;
    const color = winRate > 0.5 ? '#22c55e' : winRate < 0.35 ? '#ef4444' : '#eab308';
    const size = Math.max(3, Math.min(total * 2, 15));
    addNode(`ticker:${sym}`, `${sym} (${counts.wins}W/${counts.losses}L)`, 'ticker', size, color);
    links.push({ source: 'hub:trading', target: `ticker:${sym}`, color: color + '50' });
  }

  // Research connections
  for (const ticker of researchTickers) {
    if (nodeIds.has(`ticker:${ticker}`)) {
      links.push({ source: 'hub:research', target: `ticker:${ticker}`, color: '#8b5cf640' });
    } else {
      addNode(`ticker:${ticker}`, ticker, 'research-star', 3, '#8b5cf6');
      links.push({ source: 'hub:research', target: `ticker:${ticker}`, color: '#8b5cf640' });
    }
  }

  // SONA connections to beliefs
  for (const b of beliefs.filter(b => b.observations >= 3)) {
    if (nodeIds.has(`ticker:${b.subject}`)) {
      links.push({ source: 'hub:sona', target: `ticker:${b.subject}`, color: '#06b6d440' });
    }
  }

  return { nodes, links };
}

export default function IntelligencePage() {
  const [bayesian, setBayesian] = useState<BayesianStats | null>(null);
  const [metrics, setMetrics] = useState<IntelMetrics | null>(null);
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [tridentMemories, setTridentMemories] = useState<TridentMemory[]>([]);
  const [sonaStatus, setSonaStatus] = useState<SonaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const graphRef = useRef<HTMLDivElement>(null);
  const [graphDimensions, setGraphDimensions] = useState({ width: 800, height: 500 });

  // Responsive graph sizing
  useEffect(() => {
    const updateSize = () => {
      if (graphRef.current) {
        setGraphDimensions({
          width: graphRef.current.offsetWidth,
          height: Math.min(500, window.innerHeight * 0.45),
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [loading]);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, metricsRes, topRes, worstRes] = await Promise.allSettled([
        fetch('/api/gateway/status'),
        fetch('/api/gateway/intelligence/metrics'),
        fetch('/api/gateway/intelligence/top-performers'),
        fetch('/api/gateway/intelligence/worst-performers'),
      ]);

      if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
        const d = await statusRes.value.json();
        setBayesian(d.bayesianIntel || null);
      }
      if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
        const d = await metricsRes.value.json();
        setMetrics(d);
      }

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

      // Trident memories via gateway proxy
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

  const graphData = useMemo(() => buildGraph(tridentMemories, beliefs), [tridentMemories, beliefs]);

  if (loading) return <div className="flex justify-center items-center h-64"><Spinner size="lg" /></div>;

  const preferredTickers = beliefs.filter(b => b.domain === 'top' && b.posterior > 0.6);
  const avoidTickers = beliefs.filter(b => b.domain === 'worst' && b.posterior < 0.4);

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

      {/* Knowledge Graph */}
      <Card className="bg-white/5 border border-white/10">
        <CardHeader className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-white/80">Knowledge Graph</h3>
          <div className="flex gap-3 ml-auto text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22c55e]" /> Winning</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ef4444]" /> Losing</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#3b82f6]" /> Trading</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#8b5cf6]" /> Research</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f59e0b]" /> Rules</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#06b6d4]" /> SONA</span>
          </div>
        </CardHeader>
        <CardBody className="p-0 overflow-hidden" style={{ height: graphDimensions.height }}>
          <div ref={graphRef} className="w-full h-full">
            {graphData.nodes.length > 0 && (
              <ForceGraph3D
                width={graphDimensions.width}
                height={graphDimensions.height}
                graphData={graphData}
                nodeLabel={(node: any) => node.name}
                nodeColor={(node: any) => node.color}
                nodeVal={(node: any) => node.val}
                nodeOpacity={0.9}
                linkColor={(link: any) => link.color}
                linkOpacity={0.4}
                linkWidth={1}
                backgroundColor="rgba(0,0,0,0)"
                showNavInfo={false}
                enableNodeDrag={true}
                enableNavigationControls={true}
                nodeThreeObjectExtend={true}
                nodeThreeObject={(node: any) => {
                  // Add text labels to hub nodes
                  if (node.group === 'hub') {
                    const THREE = require('three');
                    const sprite = new THREE.Sprite(
                      new THREE.SpriteMaterial({
                        map: new THREE.CanvasTexture((() => {
                          const canvas = document.createElement('canvas');
                          canvas.width = 128;
                          canvas.height = 48;
                          const ctx = canvas.getContext('2d')!;
                          ctx.fillStyle = node.color;
                          ctx.font = 'bold 20px sans-serif';
                          ctx.textAlign = 'center';
                          ctx.fillText(node.name, 64, 30);
                          return canvas;
                        })()),
                        transparent: true,
                      })
                    );
                    sprite.scale.set(20, 8, 1);
                    sprite.position.y = 8;
                    return sprite;
                  }
                  return false;
                }}
              />
            )}
          </div>
        </CardBody>
      </Card>

      {/* Trident + Bayesian panels */}
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

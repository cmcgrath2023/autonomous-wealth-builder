'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardBody, CardHeader, Chip, Spinner, Progress } from '@heroui/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import dynamic from 'next/dynamic';
import { BrainSummary } from '@/components/intelligence/BrainSummary';
import { CoherenceEngine } from '@/components/intelligence/CoherenceEngine';

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
  content?: string;
}

interface SonaStatus {
  patterns: number;
  memories: number;
  pareto: number;
  connected: boolean;
  tier: string;
  ewcTasks: number;
  bufferSuccessRate: number;
  trajectoriesBuffered: number;
}

interface CognitiveStatus {
  graphNodes: number;
  graphEdges: number;
  clusters: number;
  avgQuality: number;
  driftStatus: string;
  loraEpoch: number;
  sonaPatterns: number;
  sonaTrajectories: number;
  metaPlateau: string;
  embeddingDim: number;
  knowledgeVelocity: number;
  gwtAvgSalience: number;
}

interface TridentCounts {
  outcomes: number;
  entries: number;
  research: number;
  rules: number;
  dailies: number;
  total: number;
}

interface GraphNode {
  id: string;
  name: string;
  group: string;
  val: number;
  color: string;
  memory?: TridentMemory;
}

interface GraphLink {
  source: string;
  target: string;
  color: string;
}

interface SelectedNode {
  node: GraphNode;
  memory?: TridentMemory;
}

const REFRESH_MS = 30_000;

const GROUP_COLORS: Record<string, string> = {
  hub: '#3b82f6',
  'hub-trading': '#3b82f6',
  'hub-research': '#8b5cf6',
  'hub-rules': '#f59e0b',
  'hub-sona': '#06b6d4',
  'hub-daily': '#10b981',
  'hub-entries': '#f97316',
  outcome: '#22c55e',
  'outcome-loss': '#ef4444',
  entry: '#f97316',
  research: '#8b5cf6',
  rule: '#f59e0b',
  daily: '#10b981',
  ticker: '#60a5fa',
  'ticker-win': '#22c55e',
  'ticker-lose': '#ef4444',
  'ticker-neutral': '#eab308',
  sector: '#a78bfa',
  belief: '#06b6d4',
};

function buildDenseGraph(memories: TridentMemory[], beliefs: Belief[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  const addNode = (id: string, name: string, group: string, val: number, color: string, memory?: TridentMemory) => {
    if (nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({ id, name, group, val, color, memory });
  };

  // ── Central brain hub ──
  addNode('hub:brain', 'MTWM Brain', 'hub', 20, '#60a5fa');

  // ── Category hubs (large orbiting nodes) ──
  addNode('hub:trading', 'Trading', 'hub-trading', 14, '#3b82f6');
  addNode('hub:research', 'Research', 'hub-research', 12, '#8b5cf6');
  addNode('hub:rules', 'Rules', 'hub-rules', 10, '#f59e0b');
  addNode('hub:sona', 'SONA', 'hub-sona', 12, '#06b6d4');
  addNode('hub:daily', 'Daily', 'hub-daily', 10, '#10b981');
  addNode('hub:entries', 'Entries', 'hub-entries', 10, '#f97316');

  // Connect hubs to brain
  for (const hub of ['trading', 'research', 'rules', 'sona', 'daily', 'entries']) {
    links.push({ source: 'hub:brain', target: `hub:${hub}`, color: GROUP_COLORS[`hub-${hub}`] + '80' });
  }

  // ── Parse all memories into structured nodes ──
  const tickerStats: Record<string, { wins: number; losses: number; entries: number; researched: boolean }> = {};
  const sectors = new Set<string>();

  for (const m of memories) {
    const tags = m.tags || [];

    if (tags.includes('outcome')) {
      // Trade outcome node
      const ticker = extractTicker(tags);
      if (ticker) {
        if (!tickerStats[ticker]) tickerStats[ticker] = { wins: 0, losses: 0, entries: 0, researched: false };
        if (tags.includes('win')) tickerStats[ticker].wins++;
        else if (tags.includes('loss')) tickerStats[ticker].losses++;
      }
      const isWin = tags.includes('win');
      const nodeId = `outcome:${m.id.slice(0, 8)}`;
      addNode(nodeId, m.title.slice(0, 40), isWin ? 'outcome' : 'outcome-loss', isWin ? 4 : 3, isWin ? '#22c55e' : '#ef4444', m);
      links.push({ source: 'hub:trading', target: nodeId, color: (isWin ? '#22c55e' : '#ef4444') + '30' });
      if (ticker && nodeIds.has(`ticker:${ticker}`)) {
        links.push({ source: `ticker:${ticker}`, target: nodeId, color: '#ffffff15' });
      }
    } else if (tags.includes('entry') || tags.includes('buy')) {
      const ticker = extractTicker(tags);
      if (ticker) {
        if (!tickerStats[ticker]) tickerStats[ticker] = { wins: 0, losses: 0, entries: 0, researched: false };
        tickerStats[ticker].entries++;
      }
      const nodeId = `entry:${m.id.slice(0, 8)}`;
      addNode(nodeId, m.title.slice(0, 40), 'entry', 3, '#f97316', m);
      links.push({ source: 'hub:entries', target: nodeId, color: '#f9731630' });
    } else if (tags.includes('research') || tags.includes('cycle')) {
      const nodeId = `research:${m.id.slice(0, 8)}`;
      addNode(nodeId, m.title.slice(0, 50), 'research', 4, '#8b5cf6', m);
      links.push({ source: 'hub:research', target: nodeId, color: '#8b5cf630' });
      // Cross-link research to tickers mentioned
      for (const t of tags) {
        if (t.length >= 2 && t.length <= 8 && !['research', 'cycle', 'stars'].includes(t)) {
          const sym = t.toUpperCase();
          if (tickerStats[sym]) tickerStats[sym].researched = true;
        }
      }
    } else if (tags.includes('rule')) {
      const nodeId = `rule:${m.id.slice(0, 8)}`;
      addNode(nodeId, m.title.slice(0, 40), 'rule', 3, '#f59e0b', m);
      links.push({ source: 'hub:rules', target: nodeId, color: '#f59e0b30' });
    } else if (tags.includes('daily') || tags.includes('summary')) {
      const nodeId = `daily:${m.id.slice(0, 8)}`;
      addNode(nodeId, m.title.slice(0, 40), 'daily', 3, '#10b981', m);
      links.push({ source: 'hub:daily', target: nodeId, color: '#10b98130' });
    }
  }

  // ── Ticker aggregate nodes (large, represent instruments) ──
  for (const [sym, stats] of Object.entries(tickerStats)) {
    const total = stats.wins + stats.losses;
    const winRate = total > 0 ? stats.wins / total : 0.5;
    const group = winRate > 0.5 ? 'ticker-win' : winRate < 0.35 ? 'ticker-lose' : 'ticker-neutral';
    const color = winRate > 0.5 ? '#22c55e' : winRate < 0.35 ? '#ef4444' : '#eab308';
    const size = Math.max(4, Math.min(total * 1.5 + stats.entries, 16));
    addNode(`ticker:${sym}`, `${sym} (${stats.wins}W/${stats.losses}L)`, group, size, color);
    links.push({ source: 'hub:trading', target: `ticker:${sym}`, color: color + '40' });
    if (stats.researched) {
      links.push({ source: 'hub:research', target: `ticker:${sym}`, color: '#8b5cf630' });
    }
  }

  // ── Bayesian beliefs → SONA connections ──
  for (const b of beliefs) {
    const color = b.posterior > 0.6 ? '#22c55e' : b.posterior < 0.4 ? '#ef4444' : '#eab308';
    const nodeId = `belief:${b.subject}`;
    if (!nodeIds.has(`ticker:${b.subject}`)) {
      addNode(nodeId, `${b.subject} (${(b.posterior * 100).toFixed(0)}%)`, 'belief', Math.max(3, b.observations), color);
    }
    const target = nodeIds.has(`ticker:${b.subject}`) ? `ticker:${b.subject}` : nodeId;
    links.push({ source: 'hub:sona', target, color: '#06b6d430' });
  }

  // ── Cross-connections: link outcome nodes to their tickers ──
  for (const n of nodes) {
    if (n.group === 'outcome' || n.group === 'outcome-loss' || n.group === 'entry') {
      const ticker = n.memory ? extractTicker(n.memory.tags) : null;
      if (ticker && nodeIds.has(`ticker:${ticker}`) && n.id !== `ticker:${ticker}`) {
        links.push({ source: n.id, target: `ticker:${ticker}`, color: '#ffffff10' });
      }
    }
  }

  return { nodes, links };
}

function extractTicker(tags: string[]): string | null {
  const knownTags = new Set(['trade', 'outcome', 'win', 'loss', 'stop_loss', 'take_profit', 'eod_close', 'trailing_stop', 'circuit_breaker', 'rotation', 'premarket_liquidation', 'historical_seed', 'long', 'short', 'momentum', 'entry', 'buy', 'research', 'cycle', 'stars', 'rule', 'trading', 'escalation', 'daily', 'summary', 'profit', 'loss']);
  const ticker = tags.find(t => !knownTags.has(t) && t.length >= 1 && t.length <= 10);
  return ticker ? ticker.toUpperCase().replace('_', '/') : null;
}

export default function IntelligencePage() {
  const [bayesian, setBayesian] = useState<BayesianStats | null>(null);
  const [metrics, setMetrics] = useState<IntelMetrics | null>(null);
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [tridentMemories, setTridentMemories] = useState<TridentMemory[]>([]);
  const [sonaStatus, setSonaStatus] = useState<SonaStatus | null>(null);
  const [cognitive, setCognitive] = useState<CognitiveStatus | null>(null);
  const [counts, setCounts] = useState<TridentCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [graphMode, setGraphMode] = useState<'knowledge' | 'memory'>('knowledge');
  const [pgGraphData, setPgGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const graphRef = useRef<HTMLDivElement>(null);
  const [graphDimensions, setGraphDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const updateSize = () => {
      if (graphRef.current) {
        setGraphDimensions({
          width: graphRef.current.offsetWidth,
          height: Math.min(650, window.innerHeight * 0.55),
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [loading]);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, metricsRes, topRes, worstRes, tridentRes] = await Promise.allSettled([
        fetch('/api/gateway/status'),
        fetch('/api/gateway/intelligence/metrics'),
        fetch('/api/gateway/intelligence/top-performers'),
        fetch('/api/gateway/intelligence/worst-performers'),
        fetch('/api/gateway/intelligence/trident'),
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

      if (tridentRes.status === 'fulfilled' && tridentRes.value.ok) {
        const d = await tridentRes.value.json();
        setTridentMemories(d.memories || []);
        setSonaStatus(d.sona || null);
        setCognitive(d.cognitive || null);
        setCounts(d.counts || null);
      }
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

  // Fetch PG knowledge graph (real company relationships)
  useEffect(() => {
    fetch('/api/intelligence/graph')
      .then(r => r.json())
      .then(d => {
        if (d.nodes?.length > 0) {
          setPgGraphData({
            nodes: d.nodes.map((n: any) => ({ ...n, memory: undefined })),
            links: d.links.map((l: any) => ({ source: l.source, target: l.target, color: l.color || '#6b7280' })),
          });
        }
      })
      .catch(() => {});
  }, []);

  const memoryGraphData = useMemo(() => buildDenseGraph(tridentMemories, beliefs), [tridentMemories, beliefs]);
  const graphData = graphMode === 'knowledge' && pgGraphData.nodes.length > 0 ? pgGraphData : memoryGraphData;

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

  return (
    <div className="space-y-6">
      {/* Top metric cards — relevant counts at a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <MetricCard label="SONA Patterns" value={(cognitive?.sonaPatterns || sonaStatus?.patterns || 0).toLocaleString()} sub="learned from trading" />
        <MetricCard label="Pareto Optimal" value={(sonaStatus?.pareto || 0).toLocaleString()} sub="coherence verified" />
        <MetricCard label="Memories" value={counts?.total || tridentMemories.length || '--'} sub="in Trident brain" />
        <MetricCard label="Beliefs" value={bayesian?.totalBeliefs ?? 0} sub={`${bayesian?.totalObservations ?? 0} observations`} />
        <MetricCard label="Companies" value={pgGraphData.nodes.length || '--'} sub={`${pgGraphData.links.length} relationships`} />
        <MetricCard label="MCP Tools" value="40" sub="REST + MCP access" />
      </div>

      {/* Trident Coherence Engine — three prong display */}
      <CoherenceEngine />

      {/* Brain Summary — what the system has learned + research status */}
      <BrainSummary />

      {/* Knowledge Graph + Detail Flyout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-white/5 border border-white/10 lg:col-span-2">
          <CardHeader className="px-4 pt-4 pb-2 flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-white/80">
                {graphMode === 'knowledge' ? 'Company Knowledge Graph' : 'Brain Memory Graph'}
              </h3>
              <div className="flex bg-white/10 rounded-lg p-0.5">
                <button
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${graphMode === 'knowledge' ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/60'}`}
                  onClick={() => setGraphMode('knowledge')}
                >
                  Knowledge ({pgGraphData.nodes.length} cos, {pgGraphData.links.length} edges)
                </button>
                <button
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${graphMode === 'memory' ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/60'}`}
                  onClick={() => setGraphMode('memory')}
                >
                  Memory ({memoryGraphData.nodes.length} nodes)
                </button>
              </div>
            </div>
            <div className="flex gap-3 ml-auto text-[10px] flex-wrap">
              {graphMode === 'knowledge' ? (
                <>
                  <Legend color="#3b82f6" label="Supplier" />
                  <Legend color="#ef4444" label="Competitor" />
                  <Legend color="#22c55e" label="Customer" />
                  <Legend color="#fbbf24" label="Partner" />
                  <Legend color="#6b7280" label="Peer" />
                </>
              ) : (
                <>
                  <Legend color="#3b82f6" label="Trading" />
                  <Legend color="#8b5cf6" label="Research" />
                  <Legend color="#f59e0b" label="Rules" />
                  <Legend color="#06b6d4" label="SONA" />
                  <Legend color="#22c55e" label="Win" />
                  <Legend color="#ef4444" label="Loss" />
                </>
              )}
            </div>
          </CardHeader>
          <CardBody className="p-0 overflow-hidden" style={{ height: graphDimensions.height }}>
            <div ref={graphRef} className="w-full h-full">
              {graphData.nodes.length > 0 && (
                <ForceGraph3D
                  width={graphDimensions.width}
                  height={graphDimensions.height}
                  graphData={graphData}
                  nodeLabel={(node: any) => `${node.name} [${node.group}]`}
                  nodeColor={(node: any) => node.color}
                  nodeVal={(node: any) => node.val}
                  nodeOpacity={0.9}
                  linkColor={(link: any) => link.color || '#6b7280'}
                  linkOpacity={graphMode === 'knowledge' ? 0.6 : 0.3}
                  linkWidth={graphMode === 'knowledge' ? 1.5 : 0.5}
                  backgroundColor="rgba(0,0,0,0)"
                  showNavInfo={false}
                  enableNodeDrag={true}
                  enableNavigationControls={true}
                  nodeThreeObjectExtend={true}
                  onNodeClick={(node: any) => {
                    setSelectedNode({ node, memory: node.memory });
                  }}
                  nodeThreeObject={(node: any) => {
                    if (node.group?.startsWith('hub')) {
                      const THREE = require('three');
                      const canvas = document.createElement('canvas');
                      canvas.width = 256;
                      canvas.height = 64;
                      const ctx = canvas.getContext('2d')!;
                      ctx.fillStyle = node.color;
                      ctx.font = `bold ${node.id === 'hub:brain' ? '28' : '22'}px sans-serif`;
                      ctx.textAlign = 'center';
                      ctx.fillText(node.name, 128, 42);
                      const sprite = new THREE.Sprite(
                        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })
                      );
                      sprite.scale.set(node.id === 'hub:brain' ? 30 : 22, node.id === 'hub:brain' ? 8 : 6, 1);
                      sprite.position.y = node.id === 'hub:brain' ? 12 : 8;
                      return sprite;
                    }
                    // Ticker nodes get small labels
                    if (node.group?.startsWith('ticker')) {
                      const THREE = require('three');
                      const canvas = document.createElement('canvas');
                      canvas.width = 128;
                      canvas.height = 32;
                      const ctx = canvas.getContext('2d')!;
                      ctx.fillStyle = node.color;
                      ctx.font = 'bold 14px sans-serif';
                      ctx.textAlign = 'center';
                      ctx.fillText(node.name.split(' ')[0], 64, 20);
                      const sprite = new THREE.Sprite(
                        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })
                      );
                      sprite.scale.set(14, 4, 1);
                      sprite.position.y = 5;
                      return sprite;
                    }
                    return false;
                  }}
                  d3AlphaDecay={0.02}
                  d3VelocityDecay={0.3}
                  warmupTicks={50}
                  cooldownTicks={100}
                />
              )}
            </div>
          </CardBody>
        </Card>

        {/* Detail Flyout Panel */}
        <Card className="bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-white/10">
          <CardHeader className="px-5 pt-5 pb-2">
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">
              {selectedNode ? 'Entity Detail' : 'Select an Entity'}
            </h3>
          </CardHeader>
          <CardBody className="px-5 pb-5 overflow-y-auto" style={{ maxHeight: graphDimensions.height - 60 }}>
            {selectedNode ? (
              <div className="space-y-4">
                <div className="pb-3 border-b border-white/10">
                  <div className="text-xl font-bold tracking-tight" style={{ color: selectedNode.node.color }}>{selectedNode.node.name}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <Chip size="sm" variant="flat" className="bg-white/10">{selectedNode.node.group}</Chip>
                    <button className="text-xs text-white/30 hover:text-white/60 ml-auto" onClick={() => setSelectedNode(null)}>dismiss</button>
                  </div>
                </div>

                {/* Knowledge Graph node detail — show company relationships */}
                {graphMode === 'knowledge' && (() => {
                  const nodeId = selectedNode.node.id;
                  const connections = graphData.links
                    .filter(l => {
                      const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
                      const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
                      return src === nodeId || tgt === nodeId;
                    })
                    .map(l => {
                      const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
                      const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
                      const neighbor = src === nodeId ? tgt : src;
                      const neighborNode = graphData.nodes.find(n => n.id === neighbor);
                      return { neighbor, name: neighborNode?.name || neighbor, color: l.color, group: neighborNode?.group || '' };
                    });

                  const suppliers = connections.filter(c => c.color === '#3b82f6');
                  const competitors = connections.filter(c => c.color === '#ef4444');
                  const customers = connections.filter(c => c.color === '#22c55e');
                  const partners = connections.filter(c => c.color === '#fbbf24');
                  const peers = connections.filter(c => c.color === '#6b7280' || !['#3b82f6','#ef4444','#22c55e','#fbbf24'].includes(c.color));

                  // Check if Bayesian has data on this ticker
                  const belief = beliefs.find(b => b.subject === nodeId);

                  return (
                    <div className="space-y-3">
                      <div className="text-xs text-white/50">
                        {connections.length} connections in knowledge graph
                      </div>

                      {belief && (
                        <div className="bg-white/5 rounded-lg p-2.5 space-y-1">
                          <div className="text-[10px] text-white/40 uppercase">Bayesian Belief</div>
                          <div className="flex justify-between text-xs">
                            <span className="text-white/50">Win probability</span>
                            <span className={belief.posterior > 0.6 ? 'text-emerald-400' : belief.posterior < 0.4 ? 'text-red-400' : 'text-amber-400'}>{(belief.posterior * 100).toFixed(0)}%</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-white/50">Observations</span>
                            <span className="text-white/80">{belief.observations}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-white/50">Avg return</span>
                            <span className={belief.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}>{(belief.avgReturn * 100).toFixed(2)}%</span>
                          </div>
                        </div>
                      )}

                      {suppliers.length > 0 && (
                        <div>
                          <div className="text-[10px] text-blue-400 uppercase mb-1">Suppliers ({suppliers.length})</div>
                          {suppliers.map((c, i) => <RelChip key={i} name={c.neighbor} color="#3b82f6" />)}
                        </div>
                      )}
                      {customers.length > 0 && (
                        <div>
                          <div className="text-[10px] text-green-400 uppercase mb-1">Customers ({customers.length})</div>
                          {customers.map((c, i) => <RelChip key={i} name={c.neighbor} color="#22c55e" />)}
                        </div>
                      )}
                      {competitors.length > 0 && (
                        <div>
                          <div className="text-[10px] text-red-400 uppercase mb-1">Competitors ({competitors.length})</div>
                          {competitors.map((c, i) => <RelChip key={i} name={c.neighbor} color="#ef4444" />)}
                        </div>
                      )}
                      {partners.length > 0 && (
                        <div>
                          <div className="text-[10px] text-yellow-400 uppercase mb-1">Partners ({partners.length})</div>
                          {partners.map((c, i) => <RelChip key={i} name={c.neighbor} color="#fbbf24" />)}
                        </div>
                      )}
                      {peers.length > 0 && (
                        <div>
                          <div className="text-[10px] text-white/40 uppercase mb-1">Sector Peers ({peers.length})</div>
                          {peers.slice(0, 10).map((c, i) => <RelChip key={i} name={c.neighbor} color="#6b7280" />)}
                          {peers.length > 10 && <span className="text-[10px] text-white/30">+{peers.length - 10} more</span>}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {selectedNode.memory && (
                  <>
                    <div>
                      <div className="text-xs text-white/40 mb-1">Title</div>
                      <div className="text-sm text-white/80">{selectedNode.memory.title}</div>
                    </div>
                    <div>
                      <div className="text-xs text-white/40 mb-1">Category</div>
                      <Chip size="sm" variant="flat" color="primary">{selectedNode.memory.category || 'uncategorized'}</Chip>
                    </div>
                    {selectedNode.memory.content && (
                      <div>
                        <div className="text-xs text-white/40 mb-1">Content</div>
                        <div className="text-xs text-white/60 whitespace-pre-wrap leading-relaxed bg-white/5 rounded p-2 max-h-64 overflow-y-auto font-mono">
                          {selectedNode.memory.content}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-white/40 mb-1">Tags</div>
                      <div className="flex flex-wrap gap-1">
                        {selectedNode.memory.tags.map((t, i) => (
                          <Chip key={i} size="sm" variant="flat" color={
                            t === 'win' ? 'success' : t === 'loss' ? 'danger' : t === 'research' ? 'primary' : t === 'entry' || t === 'buy' ? 'warning' : 'default'
                          }>{t}</Chip>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-white/40 mb-1">Connections</div>
                      <div className="text-xs text-white/50">
                        {graphData.links.filter(l =>
                          (typeof l.source === 'string' ? l.source : (l.source as any).id) === selectedNode!.node.id ||
                          (typeof l.target === 'string' ? l.target : (l.target as any).id) === selectedNode!.node.id
                        ).length} edges
                      </div>
                    </div>
                    <div className="text-xs text-white/30 font-mono">ID: {selectedNode.memory.id}</div>
                  </>
                )}
                {!selectedNode.memory && selectedNode.node.group?.startsWith('hub') && (
                  <div className="space-y-2">
                    <div className="text-sm text-white/50">
                      Hub node — central connector for {selectedNode.node.name.toLowerCase()} memories.
                    </div>
                    <div className="text-xs text-white/40">
                      Connected edges: {graphData.links.filter(l =>
                        (typeof l.source === 'string' ? l.source : (l.source as any).id) === selectedNode!.node.id ||
                        (typeof l.target === 'string' ? l.target : (l.target as any).id) === selectedNode!.node.id
                      ).length}
                    </div>
                    {selectedNode.node.id === 'hub:sona' && cognitive && (
                      <div className="space-y-1.5 pt-2 border-t border-white/5">
                        <div className="text-xs font-medium text-cyan-400">SONA Stats</div>
                        <div className="text-xs text-white/50">Patterns: <span className="text-white">{cognitive.sonaPatterns.toLocaleString()}</span></div>
                        <div className="text-xs text-white/50">Trajectories: <span className="text-white">{cognitive.sonaTrajectories}</span></div>
                        <div className="text-xs text-white/50">LoRA Epoch: <span className="text-white">{cognitive.loraEpoch}</span></div>
                        <div className="text-xs text-white/50">Meta: <span className={cognitive.metaPlateau === 'learning' ? 'text-green-400' : 'text-white'}>{cognitive.metaPlateau}</span></div>
                      </div>
                    )}
                    {selectedNode.node.id === 'hub:brain' && cognitive && (
                      <div className="space-y-1.5 pt-2 border-t border-white/5">
                        <div className="text-xs font-medium text-blue-400">Cognitive Status</div>
                        <div className="text-xs text-white/50">Graph: <span className="text-white">{cognitive.graphNodes} nodes / {cognitive.graphEdges.toLocaleString()} edges</span></div>
                        <div className="text-xs text-white/50">Clusters: <span className="text-white">{cognitive.clusters}</span></div>
                        <div className="text-xs text-white/50">Avg Quality: <span className="text-white">{(cognitive.avgQuality * 100).toFixed(1)}%</span></div>
                        <div className="text-xs text-white/50">Drift: <span className={cognitive.driftStatus === 'stable' ? 'text-green-400' : 'text-yellow-400'}>{cognitive.driftStatus}</span></div>
                        <div className="text-xs text-white/50">Velocity: <span className="text-white">{cognitive.knowledgeVelocity}</span></div>
                        <div className="text-xs text-white/50">Salience: <span className="text-white">{cognitive.gwtAvgSalience.toFixed(2)}</span></div>
                      </div>
                    )}
                  </div>
                )}
                {!selectedNode.memory && selectedNode.node.group?.startsWith('ticker') && (
                  <div className="space-y-2">
                    <div className="text-sm text-white/50">
                      Ticker aggregate — represents all trades for this instrument.
                    </div>
                    {(() => {
                      const ticker = selectedNode.node.name.split(' ')[0];
                      const belief = beliefs.find(b => b.subject === ticker);
                      if (!belief) return null;
                      return (
                        <div className="space-y-1.5 pt-2 border-t border-white/5">
                          <div className="text-xs font-medium" style={{ color: selectedNode.node.color }}>Bayesian Belief</div>
                          <div className="text-xs text-white/50">Posterior: <span className="text-white">{(belief.posterior * 100).toFixed(1)}%</span></div>
                          <div className="text-xs text-white/50">Observations: <span className="text-white">{belief.observations}</span></div>
                          <div className="text-xs text-white/50">Avg Return: <span className={belief.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}>{(belief.avgReturn * 100).toFixed(2)}%</span></div>
                        </div>
                      );
                    })()}
                    <div className="text-xs text-white/40">
                      Connected: {graphData.links.filter(l =>
                        (typeof l.source === 'string' ? l.source : (l.source as any).id) === selectedNode!.node.id ||
                        (typeof l.target === 'string' ? l.target : (l.target as any).id) === selectedNode!.node.id
                      ).length} edges
                    </div>
                  </div>
                )}
                {!selectedNode.memory && selectedNode.node.group === 'belief' && (
                  <div className="space-y-2">
                    <div className="text-sm text-white/50">Bayesian belief from SONA training.</div>
                    {(() => {
                      const ticker = selectedNode.node.name.split(' ')[0];
                      const belief = beliefs.find(b => b.subject === ticker);
                      if (!belief) return null;
                      return (
                        <div className="space-y-1.5 pt-2 border-t border-white/5">
                          <div className="text-xs text-white/50">Posterior: <span className="text-white">{(belief.posterior * 100).toFixed(1)}%</span></div>
                          <div className="text-xs text-white/50">Observations: <span className="text-white">{belief.observations}</span></div>
                          <div className="text-xs text-white/50">Avg Return: <span className={belief.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}>{(belief.avgReturn * 100).toFixed(2)}%</span></div>
                          <div className="text-xs text-white/50">Domain: <span className="text-white">{belief.domain}</span></div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white/40">Click any node in the graph to view its details here.</p>
                <div className="text-xs text-white/30 space-y-1">
                  <div>Large nodes = category hubs (Trading, Research, etc.)</div>
                  <div>Medium nodes = tickers/instruments</div>
                  <div>Small nodes = individual memories</div>
                  <div>Green = winning trades</div>
                  <div>Red = losing trades</div>
                  <div>Drag to rotate, scroll to zoom</div>
                </div>
                {counts && (
                  <div className="mt-3 space-y-1.5">
                    <div className="text-xs text-white/40 font-medium">Memory Breakdown</div>
                    <BreakdownRow label="Trade Outcomes" count={counts.outcomes} max={counts.total} color="success" />
                    <BreakdownRow label="Entries" count={counts.entries} max={counts.total} color="warning" />
                    <BreakdownRow label="Research" count={counts.research} max={counts.total} color="secondary" />
                    <BreakdownRow label="Rules" count={counts.rules} max={counts.total} color="primary" />
                    <BreakdownRow label="Dailies" count={counts.dailies} max={counts.total} color="default" />
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Trident + Bayesian panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-white/5 border border-white/10">
          <CardHeader className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-white/80">Trident Cognitive Engine</h3>
            <Chip size="sm" color={sonaStatus?.connected ? 'success' : 'danger'} variant="flat" className="ml-auto">
              {sonaStatus?.connected ? 'Connected' : 'Disconnected'}
            </Chip>
          </CardHeader>
          <CardBody className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-white/40">Tier:</span> <span className="text-white ml-1">{sonaStatus?.tier || 'unknown'}</span></div>
              <div><span className="text-white/40">Memories:</span> <span className="text-white ml-1">{sonaStatus?.memories?.toLocaleString() || 0}</span></div>
              <div><span className="text-white/40">SONA Patterns:</span> <span className="text-white ml-1">{(cognitive?.sonaPatterns || sonaStatus?.patterns || 0).toLocaleString()}</span></div>
              <div><span className="text-white/40">LoRA Epoch:</span> <span className="text-white ml-1">{cognitive?.loraEpoch ?? '--'}</span></div>
              <div><span className="text-white/40">Drift Status:</span> <span className={`ml-1 ${cognitive?.driftStatus === 'stable' ? 'text-green-400' : cognitive?.driftStatus === 'drifting' ? 'text-yellow-400' : 'text-white'}`}>{cognitive?.driftStatus ?? '--'}</span></div>
              <div><span className="text-white/40">Meta Learning:</span> <span className={`ml-1 ${cognitive?.metaPlateau === 'learning' ? 'text-green-400' : 'text-white'}`}>{cognitive?.metaPlateau ?? '--'}</span></div>
              <div><span className="text-white/40">Clusters:</span> <span className="text-white ml-1">{cognitive?.clusters ?? '--'}</span></div>
              <div><span className="text-white/40">Avg Quality:</span> <span className="text-white ml-1">{cognitive ? `${(cognitive.avgQuality * 100).toFixed(1)}%` : '--'}</span></div>
            </div>
            {cognitive && (
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
                <div className="text-center">
                  <div className="text-lg font-bold text-cyan-400">{cognitive.graphNodes}</div>
                  <div className="text-[10px] text-white/40">Graph Nodes</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-cyan-400">{cognitive.graphEdges.toLocaleString()}</div>
                  <div className="text-[10px] text-white/40">Graph Edges</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-cyan-400">{cognitive.knowledgeVelocity}</div>
                  <div className="text-[10px] text-white/40">Knowledge Velocity</div>
                </div>
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
            <h3 className="text-sm font-semibold text-white/80">Recent Trident Memories ({tridentMemories.length})</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {tridentMemories.slice(0, 50).map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-xs py-1 border-b border-white/5 cursor-pointer hover:bg-white/5 rounded px-1"
                  onClick={() => setSelectedNode({ node: { id: m.id, name: m.title, group: 'memory', val: 3, color: '#888', memory: m }, memory: m })}
                >
                  <Chip size="sm" variant="flat" color={
                    m.tags?.includes('win') ? 'success' :
                    m.tags?.includes('loss') ? 'danger' :
                    m.tags?.includes('research') ? 'primary' :
                    m.tags?.includes('entry') ? 'warning' :
                    'default'
                  }>
                    {m.tags?.includes('outcome') ? 'Trade' :
                     m.tags?.includes('entry') ? 'Buy' :
                     m.tags?.includes('research') ? 'Research' :
                     m.tags?.includes('rule') ? 'Rule' :
                     m.tags?.includes('daily') ? 'Daily' : 'Memory'}
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

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="bg-white/5 border border-white/10">
      <CardBody className="p-3">
        <div className="text-white/40 text-xs mb-1">{label}</div>
        <div className="text-xl font-bold text-white">{value}</div>
        {sub && <div className="text-xs text-white/30 mt-0.5">{sub}</div>}
      </CardBody>
    </Card>
  );
}

function RelChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-white/5 rounded px-2 py-1 mr-1 mb-1" style={{ borderLeft: `2px solid ${color}` }}>
      <span className="font-mono font-semibold text-white/80">{name}</span>
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function BreakdownRow({ label, count, max, color }: { label: string; count: number; max: number; color: 'success' | 'warning' | 'secondary' | 'primary' | 'default' }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-white/60 w-28">{label}</span>
      <Progress value={count} maxValue={max || 1} size="sm" className="flex-1" color={color} />
      <span className="text-white/50 w-8 text-right">{count}</span>
    </div>
  );
}

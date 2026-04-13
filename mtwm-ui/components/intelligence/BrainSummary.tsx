'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody, Chip } from '@heroui/react';

interface BrainData {
  connected: boolean;
  sonaPatterns: number;
  sonaMemories: number;
  sonaTier: string;
  sonaMessage: string;
  loraEpoch: number;
  driftStatus: string;
  tradeWins: number;
  tradeLosses: number;
  summary: string;
  learnings: Array<{ icon: string; text: string; type: 'good' | 'bad' | 'info' }>;
}

interface GraphData {
  stats: { companies: number; relationships: number; activeSignals: number; activeTheses: number };
  theses: Array<{ id: number; title: string; ticker: string; conviction: number; status: string; action: string }>;
  sectorMomentum: Array<{ sector: string; avg_change_5d: number; trend: string; top_ticker: string }>;
}

export function BrainSummary() {
  const [brain, setBrain] = useState<BrainData | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);

  useEffect(() => {
    fetch('/api/intelligence/summary').then(r => r.json()).then(setBrain).catch(() => {});
    fetch('/api/intelligence/graph').then(r => r.json()).then(setGraph).catch(() => {});
    const i = setInterval(() => {
      fetch('/api/intelligence/summary').then(r => r.json()).then(setBrain).catch(() => {});
      fetch('/api/intelligence/graph').then(r => r.json()).then(setGraph).catch(() => {});
    }, 60_000);
    return () => clearInterval(i);
  }, []);

  if (!brain) return null;

  const winRate = brain.tradeWins + brain.tradeLosses > 0
    ? Math.round((brain.tradeWins / (brain.tradeWins + brain.tradeLosses)) * 100)
    : null;

  return (
    <div className="space-y-4">
      {/* Status Banner */}
      <div className={`rounded-xl px-5 py-4 border ${brain.connected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${brain.connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            <div>
              <div className="text-sm font-semibold text-white">
                {brain.connected ? 'Brain Connected' : 'Brain Disconnected'}
              </div>
              <div className="text-xs text-white/50 mt-0.5">{brain.summary}</div>
            </div>
          </div>
          <div className="flex gap-3 text-right">
            <div>
              <div className="text-lg font-mono font-bold text-white">{brain.sonaPatterns.toLocaleString()}</div>
              <div className="text-[10px] text-white/40 uppercase">SONA Patterns</div>
            </div>
            <div>
              <div className="text-lg font-mono font-bold text-white">{brain.sonaMemories}</div>
              <div className="text-[10px] text-white/40 uppercase">Memories</div>
            </div>
            {winRate !== null && (
              <div>
                <div className={`text-lg font-mono font-bold ${winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{winRate}%</div>
                <div className="text-[10px] text-white/40 uppercase">Win Rate</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-column: Learnings + Research Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* What the Brain Has Learned */}
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <h3 className="text-sm font-semibold text-white/70 mb-3">What the Brain Has Learned</h3>
            {brain.learnings.length === 0 ? (
              <div className="text-xs text-white/30 py-4 text-center">No learnings yet — the brain needs trade data to learn from.</div>
            ) : (
              <div className="space-y-2">
                {brain.learnings.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-base leading-none mt-0.5">{l.icon}</span>
                    <span className={
                      l.type === 'good' ? 'text-emerald-400' :
                      l.type === 'bad' ? 'text-red-400' :
                      'text-white/60'
                    }>{l.text}</span>
                  </div>
                ))}
              </div>
            )}
            {brain.sonaMessage && (
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="text-[10px] text-white/30 uppercase mb-1">SONA Status</div>
                <div className="text-xs text-cyan-400/80 font-mono">{brain.sonaMessage}</div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Research System Status */}
        <Card className="bg-white/5 border border-white/10">
          <CardBody className="p-4">
            <h3 className="text-sm font-semibold text-white/70 mb-3">Research System</h3>
            {graph ? (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <StatBox label="Companies" value={graph.stats.companies} />
                  <StatBox label="Relationships" value={graph.stats.relationships} />
                  <StatBox label="Active Signals" value={graph.stats.activeSignals} />
                  <StatBox label="Active Theses" value={graph.stats.activeTheses} />
                </div>

                {/* Active Theses */}
                {graph.theses.length > 0 && (
                  <div>
                    <div className="text-[10px] text-white/30 uppercase mb-1.5">Active Investment Theses</div>
                    <div className="space-y-1.5">
                      {graph.theses.slice(0, 5).map(t => (
                        <div key={t.id} className="flex items-center justify-between text-xs bg-white/5 rounded px-2 py-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono font-semibold text-white/90">{t.ticker}</span>
                            <span className="text-white/40 truncate">{t.title.slice(0, 50)}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`font-mono ${t.conviction >= 70 ? 'text-emerald-400' : t.conviction >= 50 ? 'text-amber-400' : 'text-white/50'}`}>
                              {t.conviction}
                            </span>
                            <Chip size="sm" variant="flat" color={
                              t.action === 'act' ? 'success' : t.action === 'suggest' ? 'warning' : 'default'
                            }>{t.action}</Chip>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sector Momentum */}
                {graph.sectorMomentum.length > 0 && (
                  <div>
                    <div className="text-[10px] text-white/30 uppercase mb-1.5">Sector Momentum</div>
                    <div className="flex flex-wrap gap-1.5">
                      {graph.sectorMomentum
                        .sort((a: any, b: any) => (b.avg_change_5d || 0) - (a.avg_change_5d || 0))
                        .slice(0, 8)
                        .map((s: any, i: number) => {
                          const pct = parseFloat(s.avg_change_5d || '0');
                          return (
                            <Chip key={i} size="sm" variant="flat" color={
                              pct > 3 ? 'success' : pct > 0 ? 'default' : 'danger'
                            }>
                              {s.sector} {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                            </Chip>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-white/30 py-4 text-center">Loading research data...</div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-mono font-bold text-white">{value.toLocaleString()}</div>
      <div className="text-[10px] text-white/40">{label}</div>
    </div>
  );
}

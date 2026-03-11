'use client';

import { useEffect, useState, useCallback } from 'react';

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

interface IntelligenceData {
  predictionAccuracy: number;
  accuracyTrend: string;
  posteriorDivergence: number;
  convergenceRate: number;
  cumulativeRegret: number;
  regretTrend: string;
  totalPredictions: number;
  totalBeliefs: number;
  totalObservations: number;
  agentContributions: Record<string, number>;
  domainProgress: Record<string, { current: number; trend: string; observations: number }>;
  learningCurve: Array<{ timestamp: number; accuracy: number; divergence: number; observations: number }>;
  topInsights: string[];
}

interface TraitSnapshot {
  timestamp: string;
  aggregateScore: number;
  traits: Record<string, { posterior: number; confidence: number; observations: number }>;
}

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

export function IntelligenceGrowth() {
  const [intel, setIntel] = useState<IntelligenceData | null>(null);
  const [traits, setTraits] = useState<TraitMetrics | null>(null);
  const [snapshots, setSnapshots] = useState<TraitSnapshot[]>([]);
  const [error, setError] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [metricsRes, traitsRes, snapshotsRes] = await Promise.all([
        fetch(`${GATEWAY}/api/intelligence/metrics`).catch(() => null),
        fetch(`${GATEWAY}/api/traits`).catch(() => null),
        fetch(`${GATEWAY}/api/traits/history/snapshots`).catch(() => null),
      ]);

      if (metricsRes?.ok) {
        const d = await metricsRes.json();
        setIntel(d.intelligence);
      }
      if (traitsRes?.ok) {
        const d = await traitsRes.json();
        setTraits(d.metrics);
      }
      if (snapshotsRes?.ok) {
        const d = await snapshotsRes.json();
        setSnapshots(d.snapshots || []);
      }
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (error && !intel && !traits) {
    return (
      <div className="bg-white/5 rounded-2xl border border-white/5 p-5">
        <h3 className="text-sm font-semibold text-white/60 mb-3">Agent Intelligence</h3>
        <div className="text-xs text-white/30">Unable to reach gateway</div>
      </div>
    );
  }

  const trendIcon = (t: string) =>
    t === 'improving' ? '▲' : t === 'declining' || t === 'degrading' ? '▼' : t === 'stable' ? '—' : '·';
  const trendColor = (t: string) =>
    t === 'improving' ? 'text-green-400' : t === 'declining' || t === 'degrading' ? 'text-red-400' : 'text-white/50';

  // Compute avg confidence from trait engine (Brad Ross style)
  const avgConfidence = traits?.overallScore || 0;
  const confidencePct = Math.min(95, Math.max(5, avgConfidence * 100));
  const patternsEvolved = traits?.traitsTracked || 0;
  const totalObs = (traits?.totalObservations || 0) + (intel?.totalObservations || 0);
  const systemImprovement = traits?.improvement || 0;
  const maxConfCases = traits ? (traits.improving + traits.stable) : 0;

  // Domains sorted by observations
  const domains = intel ? Object.entries(intel.domainProgress)
    .filter(([, v]) => v.observations > 0)
    .sort((a, b) => b[1].observations - a[1].observations) : [];

  // Agent contributions
  const agents = intel ? Object.entries(intel.agentContributions)
    .sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const maxAgentObs = agents[0]?.[1] || 1;

  // Snapshot evolution chart (last 20 snapshots)
  const chartSnapshots = snapshots.slice(-20);

  return (
    <div className="bg-white/5 rounded-2xl border border-white/5 p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/60">Agent Intelligence Growth</h3>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${totalObs > 100 ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
          <span className="text-[10px] text-white/30">{totalObs > 100 ? 'Actively learning' : 'Bootstrapping'}</span>
        </div>
      </div>

      {/* AVG CONFIDENCE BAR — Brad Ross style */}
      <div>
        <div className="h-4 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
          <div
            className="h-full bg-gradient-to-r from-sky-600 to-sky-400 relative transition-all duration-1000"
            style={{ width: `${confidencePct}%` }}
          >
            <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-white/50" />
          </div>
        </div>
        <div className="flex justify-between text-xs mt-2 font-mono">
          <span className="text-sky-400">AVG CONFIDENCE</span>
          <span className="text-white">{avgConfidence.toFixed(3)}</span>
        </div>
      </div>

      {/* Key Stats — Brad Ross cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/5 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-sky-400 font-mono">{patternsEvolved}</div>
          <div className="text-[10px] text-white/40 mt-1">Patterns Evolved</div>
        </div>
        <div className="bg-white/5 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-purple-400 font-mono">{maxConfCases}</div>
          <div className="text-[10px] text-white/40 mt-1">Converged Traits</div>
        </div>
        <div className="bg-white/5 rounded-xl p-3 text-center">
          <div className={`text-2xl font-bold font-mono ${systemImprovement > 0 ? 'text-green-400' : systemImprovement < 0 ? 'text-red-400' : 'text-white/50'}`}>
            {systemImprovement > 0 ? '+' : ''}{systemImprovement.toFixed(1)}%
          </div>
          <div className="text-[10px] text-white/40 mt-1">System Improvement</div>
        </div>
      </div>

      {/* Bayesian Intelligence Metrics */}
      {intel && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-xl p-3">
            <div className="text-[10px] text-white/40 mb-1">Prediction Accuracy</div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-xl font-bold ${intel.totalPredictions >= 5 ? (intel.predictionAccuracy >= 0.55 ? 'text-green-400' : 'text-amber-400') : 'text-white/50'}`}>
                {intel.totalPredictions >= 5 ? `${(intel.predictionAccuracy * 100).toFixed(0)}%` : '—'}
              </span>
              <span className={`text-[10px] ${trendColor(intel.accuracyTrend)}`}>
                {trendIcon(intel.accuracyTrend)}
              </span>
            </div>
            <div className="text-[10px] text-white/25">{intel.totalPredictions} predictions</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3">
            <div className="text-[10px] text-white/40 mb-1">Cumulative Regret</div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-xl font-bold ${intel.cumulativeRegret < 1 ? 'text-green-400' : intel.cumulativeRegret < 5 ? 'text-amber-400' : 'text-red-400'}`}>
                {intel.cumulativeRegret.toFixed(2)}
              </span>
              <span className={`text-[10px] ${trendColor(intel.regretTrend === 'decreasing' ? 'improving' : intel.regretTrend === 'increasing' ? 'declining' : 'stable')}`}>
                {trendIcon(intel.regretTrend === 'decreasing' ? 'improving' : intel.regretTrend === 'increasing' ? 'declining' : 'stable')}
              </span>
            </div>
            <div className="text-[10px] text-white/25">Lower = smarter</div>
          </div>
        </div>
      )}

      {/* Confidence Evolution Chart — from trait snapshots */}
      {chartSnapshots.length >= 3 && (
        <div>
          <div className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">Confidence Evolution</div>
          <div className="flex items-end gap-[2px] h-20">
            {chartSnapshots.map((snap, i) => {
              const score = snap.aggregateScore;
              const height = Math.max(4, score * 100);
              const color = score >= 0.55 ? 'bg-sky-500/60' : score >= 0.40 ? 'bg-amber-500/60' : 'bg-red-500/60';
              const traitCount = Object.keys(snap.traits).length;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-t ${color} transition-all duration-500 hover:opacity-80`}
                  style={{ height: `${height}%` }}
                  title={`Score: ${(score * 100).toFixed(1)}% | ${traitCount} traits | ${snap.timestamp}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] text-white/20 mt-1">
            <span>{chartSnapshots[0]?.timestamp.slice(5, 16).replace('T', ' ')}</span>
            <span>{chartSnapshots[chartSnapshots.length - 1]?.timestamp.slice(5, 16).replace('T', ' ')}</span>
          </div>
        </div>
      )}

      {/* Domain Intelligence Progress */}
      {domains.length > 0 && (
        <div>
          <div className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">Domain Intelligence</div>
          <div className="space-y-1.5">
            {domains.slice(0, 6).map(([domain, info]) => {
              const pct = (info.current * 100).toFixed(0);
              const barWidth = Math.max(5, info.current * 100);
              const barColor = info.current > 0.55 ? 'bg-green-500/60' : info.current > 0.40 ? 'bg-amber-500/60' : 'bg-red-500/60';
              const label = domain.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              return (
                <div key={domain} className="flex items-center gap-2">
                  <div className="w-24 text-[10px] text-white/50 truncate">{label}</div>
                  <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor} transition-all duration-1000`} style={{ width: `${barWidth}%` }} />
                  </div>
                  <div className="w-10 text-right text-[10px] text-white/60 font-mono">{pct}%</div>
                  <div className={`w-4 text-[10px] ${trendColor(info.trend)}`}>{trendIcon(info.trend)}</div>
                  <div className="w-12 text-right text-[10px] text-white/30">{info.observations}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agent Contributions */}
      {agents.length > 0 && (
        <div>
          <div className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">Agent Contributions</div>
          <div className="space-y-1">
            {agents.map(([agent, obs]) => (
              <div key={agent} className="flex items-center gap-2">
                <div className="w-28 text-[10px] text-white/50 truncate font-mono">{agent}</div>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-purple-500/40 transition-all duration-1000" style={{ width: `${(obs / maxAgentObs) * 100}%` }} />
                </div>
                <div className="w-12 text-right text-[10px] text-white/40 font-mono">{obs}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discovered Insights */}
      {intel && intel.topInsights.length > 0 && (
        <div>
          <div className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">Discovered Insights</div>
          <div className="space-y-1">
            {intel.topInsights.slice(0, 4).map((insight, i) => (
              <div key={i} className={`text-[11px] font-mono ${insight.includes('AVOID') ? 'text-red-400/70' : 'text-green-400/70'}`}>
                {insight.includes('AVOID') ? '✕' : '✓'} {insight}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer stats */}
      <div className="flex justify-between text-[9px] text-white/20 border-t border-white/5 pt-2">
        <span>{intel?.totalBeliefs || 0} beliefs + {patternsEvolved} traits</span>
        <span>{totalObs.toLocaleString()} total observations</span>
        <span>{snapshots.length} snapshots</span>
      </div>
    </div>
  );
}

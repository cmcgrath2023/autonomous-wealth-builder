'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody, Progress } from '@heroui/react';

interface TridenStatus {
  connected: boolean;
  version: string;
  tools: number;
  sonaPatterns: number;
  paretoFront: number;
  memories: number;
  sonaMessage: string;
  tier: string;
}

export function CoherenceEngine() {
  const [status, setStatus] = useState<TridenStatus | null>(null);
  const [pulsePhase, setPulsePhase] = useState(0);

  useEffect(() => {
    fetchStatus();
    const i = setInterval(fetchStatus, 30_000);
    const pulse = setInterval(() => setPulsePhase(p => (p + 1) % 100), 50);
    return () => { clearInterval(i); clearInterval(pulse); };
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/intelligence/trident');
      if (!res.ok) return;
      const d = await res.json();
      setStatus({
        connected: d.sona?.connected ?? false,
        version: '0.1.0',
        tools: 40,
        sonaPatterns: d.sona?.patterns ?? 0,
        paretoFront: d.sona?.pareto ?? 0,
        memories: d.sona?.memories ?? 0,
        sonaMessage: d.cognitive?.sonaMessage ?? '',
        tier: d.sona?.tier ?? 'unknown',
      });
    } catch {}
  }

  if (!status) return null;

  const paretoRatio = status.sonaPatterns > 0 ? (status.paretoFront / status.sonaPatterns) * 100 : 0;
  const coherenceScore = Math.min(100, Math.round(paretoRatio * 1.2)); // approximate

  return (
    <Card className="bg-gradient-to-br from-slate-900/80 to-cyan-950/40 border border-cyan-500/20 overflow-hidden">
      <CardBody className="p-0">
        {/* Header with animated status */}
        <div className="px-6 pt-5 pb-4 relative">
          {/* Subtle animated background */}
          <div className="absolute inset-0 opacity-10" style={{
            background: `radial-gradient(circle at ${30 + Math.sin(pulsePhase * 0.063) * 20}% ${40 + Math.cos(pulsePhase * 0.047) * 15}%, rgba(6,182,212,0.4) 0%, transparent 50%),
                         radial-gradient(circle at ${70 + Math.cos(pulsePhase * 0.051) * 15}% ${60 + Math.sin(pulsePhase * 0.073) * 10}%, rgba(139,92,246,0.3) 0%, transparent 40%)`,
          }} />

          <div className="relative flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2.5 h-2.5 rounded-full ${status.connected ? 'bg-cyan-400 shadow-lg shadow-cyan-400/50' : 'bg-red-400'}`}
                  style={{ animation: status.connected ? 'pulse 2s infinite' : 'none' }} />
                <h2 className="text-lg font-bold text-white tracking-tight">Trident Coherence Engine</h2>
              </div>
              <p className="text-xs text-white/40">
                Memory + Intelligence + Structural Coherence — one unified reasoning layer
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-cyan-400/60 uppercase tracking-wider">Tier</div>
              <div className="text-sm font-bold text-cyan-400">{status.tier.toUpperCase()}</div>
            </div>
          </div>
        </div>

        {/* Three Prongs */}
        <div className="grid grid-cols-3 gap-px bg-white/5">
          {/* Prong I: Memory */}
          <div className="bg-slate-900/80 px-5 py-4">
            <div className="text-[10px] text-blue-400 uppercase tracking-wider mb-2 font-semibold">I. Memory</div>
            <div className="text-2xl font-bold text-white font-mono">{status.memories.toLocaleString()}</div>
            <div className="text-[10px] text-white/40 mt-0.5">persistent memories</div>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span className="text-[10px] text-white/50">PostgreSQL + HNSW retrieval</span>
            </div>
          </div>

          {/* Prong II: Intelligence */}
          <div className="bg-slate-900/80 px-5 py-4">
            <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-2 font-semibold">II. Intelligence</div>
            <div className="text-2xl font-bold text-white font-mono">{status.sonaPatterns.toLocaleString()}</div>
            <div className="text-[10px] text-white/40 mt-0.5">SONA patterns learned</div>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span className="text-[10px] text-white/50">Bayesian beliefs + FANN inference</span>
            </div>
          </div>

          {/* Prong III: Coherence */}
          <div className="bg-slate-900/80 px-5 py-4">
            <div className="text-[10px] text-cyan-400 uppercase tracking-wider mb-2 font-semibold">III. Coherence</div>
            <div className="text-2xl font-bold text-white font-mono">{status.paretoFront.toLocaleString()}</div>
            <div className="text-[10px] text-white/40 mt-0.5">pareto-optimal patterns</div>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span className="text-[10px] text-white/50">Sheaf Laplacian verification</span>
            </div>
          </div>
        </div>

        {/* Coherence Score Bar */}
        <div className="px-6 py-4 bg-slate-900/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white/50">Coherence Ratio</span>
            <span className="text-xs font-mono text-cyan-400">{paretoRatio.toFixed(1)}%</span>
          </div>
          <Progress
            value={paretoRatio}
            color="primary"
            size="sm"
            className="max-w-full"
            classNames={{
              indicator: 'bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500',
              track: 'bg-white/5',
            }}
          />
          <div className="flex justify-between mt-1.5 text-[10px] text-white/30">
            <span>{status.paretoFront.toLocaleString()} optimal / {status.sonaPatterns.toLocaleString()} total patterns</span>
            <span>{status.tools} MCP tools active</span>
          </div>
        </div>

        {/* SONA Status */}
        {status.sonaMessage && (
          <div className="px-6 py-3 border-t border-white/5 bg-slate-900/40">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400/80 font-mono">{status.sonaMessage}</span>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

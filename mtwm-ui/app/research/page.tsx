'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardBody, Chip } from '@heroui/react';

interface Signal {
  symbol: string;
  direction: string;
  signal: string;
  detail: string;
}

interface Strategy {
  action: string;
  rationale: string;
  risk: string;
  result?: string;
}

interface Report {
  id: string;
  agent: string;
  type: string;
  timestamp: string;
  summary: string;
  findings: string[];
  signals: Signal[];
  strategy?: Strategy;
  meta: Record<string, unknown>;
}

const AGENT_LABELS: Record<string, { name: string; color: string }> = {
  'crypto-researcher': { name: 'Crypto Research', color: 'warning' },
  'forex-researcher': { name: 'Forex Research', color: 'primary' },
  'news-desk': { name: 'Market Intelligence', color: 'secondary' },
  'research-agent': { name: 'Equity Research', color: 'success' },
};

function SignalBadge({ signal }: { signal: string }) {
  const color = signal === 'BUY' || signal === 'STRONG'
    ? 'bg-green-500/20 text-green-400'
    : signal === 'SELL'
      ? 'bg-red-500/20 text-red-400'
      : signal === 'MODERATE'
        ? 'bg-amber-500/20 text-amber-400'
        : 'bg-white/10 text-white/40';
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${color}`}>{signal}</span>;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function ReportCard({ report }: { report: Report }) {
  const [expanded, setExpanded] = useState(false);
  const agentInfo = AGENT_LABELS[report.agent] || { name: report.agent, color: 'default' };

  return (
    <Card className="bg-white/5 border border-white/5">
      <CardBody className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Chip size="sm" variant="flat" color={agentInfo.color as any}>{agentInfo.name}</Chip>
              <span className="text-[10px] text-white/25">{formatTimestamp(report.timestamp)}</span>
            </div>
            <p className="text-sm text-white/70">{report.summary}</p>
          </div>
          <Chip size="sm" variant="flat" className="flex-shrink-0">{report.type}</Chip>
        </div>

        {/* Strategy — the key actionable section */}
        {report.strategy && (
          <div className="mb-3 px-3 py-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
            <div className="text-[10px] text-blue-400/60 uppercase tracking-wider mb-1 font-semibold">Strategy</div>
            <p className="text-sm text-white/80 mb-1">{report.strategy.action}</p>
            <p className="text-xs text-white/40">{report.strategy.rationale}</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-amber-400/60">Risk:</span>
              <span className="text-[10px] text-white/40">{report.strategy.risk}</span>
            </div>
            {report.strategy.result && (
              <div className="mt-1.5 pt-1.5 border-t border-blue-500/10">
                <span className="text-[10px] text-green-400/60">Result:</span>
                <span className="text-[10px] text-white/50 ml-1">{report.strategy.result}</span>
              </div>
            )}
          </div>
        )}

        {/* Signals preview */}
        {report.signals.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {report.signals.slice(0, expanded ? 20 : 5).map((s, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.03]">
                <span className="text-[10px] font-mono text-white/50">{s.symbol}</span>
                <SignalBadge signal={s.signal} />
              </div>
            ))}
            {!expanded && report.signals.length > 5 && (
              <span className="text-[10px] text-white/25 self-center">+{report.signals.length - 5} more</span>
            )}
          </div>
        )}

        {/* Expanded findings */}
        {expanded && (
          <div className="mt-3 space-y-3">
            {report.signals.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5">Signals</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {report.signals.map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-2 py-1 rounded bg-white/[0.02] text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-white/60">{s.symbol}</span>
                        <SignalBadge signal={s.signal} />
                        <span className="text-white/30">{s.direction}</span>
                      </div>
                      <span className="text-white/25 font-mono text-[10px] truncate ml-2 max-w-[200px]">{s.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.findings.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5">Findings</h4>
                <div className="space-y-0.5">
                  {report.findings.map((f, i) => (
                    <div key={i} className="text-xs text-white/50 font-mono px-2 py-1 rounded bg-white/[0.02]">
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Object.keys(report.meta).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5">Metadata</h4>
                <div className="text-[10px] font-mono text-white/30 bg-white/[0.02] rounded p-2">
                  {JSON.stringify(report.meta, null, 2)}
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-blue-400/70 hover:text-blue-400 transition-colors"
        >
          {expanded ? 'Collapse' : 'Expand Full Report'}
        </button>
      </CardBody>
    </Card>
  );
}

function ResearchPageInner() {
  const searchParams = useSearchParams();
  const agentFilter = searchParams.get('agent') || '';
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState(agentFilter);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const url = filter
          ? `/api/research/reports?agent=${filter}&limit=50`
          : '/api/research/reports?limit=50';
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setReports(data.reports || []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
  }, [filter]);

  const agents = ['', 'crypto-researcher', 'forex-researcher', 'news-desk', 'research-agent'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Research Reports</h1>
        <span className="text-xs text-white/30">{reports.length} reports</span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {agents.map((a) => (
          <button
            key={a}
            onClick={() => setFilter(a)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              filter === a
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-white/5 text-white/40 hover:text-white/60 border border-white/5'
            }`}
          >
            {a ? (AGENT_LABELS[a]?.name || a) : 'All Reports'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-white/30 py-12">Loading reports...</div>
      ) : reports.length === 0 ? (
        <div className="text-center text-white/30 py-12">No reports available yet. Researchers produce reports each heartbeat cycle.</div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense fallback={<div className="text-center text-white/30 py-12">Loading...</div>}>
      <ResearchPageInner />
    </Suspense>
  );
}

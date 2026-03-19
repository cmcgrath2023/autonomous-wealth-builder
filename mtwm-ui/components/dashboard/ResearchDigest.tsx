'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, Modal, ModalContent, ModalHeader, ModalBody, useDisclosure } from '@heroui/react';

interface Signal {
  symbol: string;
  direction: string;
  signal: string;
  detail: string;
}

interface Performer {
  ticker: string;
  winRate: number;
  observations: number;
  avgReturn: number;
}

interface DigestSection {
  summary: string;
  findings: string[];
  signals: Signal[];
  topPerformers: Performer[];
  worstPerformers: Performer[];
  lastUpdated: string | null;
}

interface DigestData {
  timestamp: string;
  usMarkets: DigestSection;
  crypto: DigestSection;
  forex: DigestSection;
  intelligence: { totalBeliefs: number; totalObservations: number };
}

type SectionKey = 'usMarkets' | 'crypto' | 'forex';

const SECTION_LABELS: Record<SectionKey, { title: string; icon: string }> = {
  usMarkets: { title: 'US Markets', icon: '\u25B2' },
  crypto: { title: 'Crypto', icon: '\u26A1' },
  forex: { title: 'Forex', icon: '\u21C4' },
};

function SignalBadge({ signal }: { signal: string }) {
  const color = signal === 'BUY' || signal === 'STRONG'
    ? 'bg-green-500/20 text-green-400 border border-green-500/20'
    : signal === 'SELL'
      ? 'bg-red-500/20 text-red-400 border border-red-500/20'
      : signal === 'MODERATE'
        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20'
        : 'bg-white/10 text-white/40';
  return <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${color}`}>{signal}</span>;
}

function timeAgo(ts: string | null): string {
  if (!ts) return '';
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function DigestSnippet({ sectionKey, section, onViewAll }: { sectionKey: SectionKey; section: DigestSection; onViewAll: () => void }) {
  const label = SECTION_LABELS[sectionKey];
  // Show ALL actionable signals: BUY, SELL, STRONG, MODERATE
  const topSignals = section.signals.filter(s => !['WAIT', 'WEAK', 'allocation'].includes(s.signal)).slice(0, 4);
  const hasContent = section.findings.length > 0 || section.signals.length > 0;
  const actionableCount = topSignals.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white/60">{label.icon} {label.title}</span>
        {section.lastUpdated && (
          <span className="text-[10px] text-white/20">{timeAgo(section.lastUpdated)}</span>
        )}
      </div>

      {hasContent ? (
        <>
          <p className="text-sm text-white/60 line-clamp-2">{section.summary}</p>
          {topSignals.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {topSignals.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.03]">
                  <span className="text-xs font-mono text-white/70">{s.symbol}</span>
                  <SignalBadge signal={s.signal} />
                </div>
              ))}
              {actionableCount > 0 && (
                <span className="text-xs text-white/30 self-center">{actionableCount} actionable</span>
              )}
            </div>
          )}
          {section.topPerformers.length > 0 && (
            <div className="flex gap-3 mt-1">
              {section.topPerformers.slice(0, 2).map((p, i) => (
                <span key={i} className="text-xs font-mono text-green-400/60">
                  {p.ticker} {p.winRate}%W
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-white/30 italic">No research data yet</p>
      )}

      <button
        onClick={onViewAll}
        className="text-[10px] text-blue-400/70 hover:text-blue-400 transition-colors"
      >
        View All
      </button>
    </div>
  );
}

const SECTION_AGENTS: Record<SectionKey, string> = {
  usMarkets: 'news-desk',
  crypto: 'crypto-researcher',
  forex: 'forex-researcher',
};

function DigestModal({ sectionKey, section, isOpen, onClose }: { sectionKey: SectionKey; section: DigestSection; isOpen: boolean; onClose: () => void }) {
  const label = SECTION_LABELS[sectionKey];
  const agentFilter = SECTION_AGENTS[sectionKey];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside" classNames={{ base: 'bg-[#111] border border-white/10', header: 'border-b border-white/5', body: 'py-4' }}>
      <ModalContent>
        <ModalHeader className="text-white/90">{label.icon} {label.title} Research Digest</ModalHeader>
        <ModalBody>
          {/* Summary */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1">Summary</h4>
            <p className="text-sm text-white/70">{section.summary}</p>
            {section.lastUpdated && (
              <p className="text-[10px] text-white/20 mt-1">Updated {timeAgo(section.lastUpdated)}</p>
            )}
          </div>

          {/* Signals */}
          {section.signals.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Signals</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {section.signals.map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded bg-white/[0.03] text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-white/70">{s.symbol}</span>
                      <SignalBadge signal={s.signal} />
                    </div>
                    <span className="text-white/30 font-mono text-[10px] truncate ml-2">{s.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Findings */}
          {section.findings.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Findings</h4>
              <div className="space-y-1">
                {section.findings.map((f, i) => (
                  <div key={i} className="text-xs text-white/50 font-mono px-2 py-1 rounded bg-white/[0.02]">
                    {f}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Performers */}
          <div className="grid grid-cols-2 gap-4">
            {section.topPerformers.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-green-400/60 uppercase tracking-wider mb-2">Top Performers</h4>
                {section.topPerformers.map((p, i) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-white/5">
                    <span className="font-mono text-white/60">{p.ticker}</span>
                    <span className="font-mono text-green-400">{p.winRate}% WR <span className="text-white/25">({p.observations} obs)</span></span>
                  </div>
                ))}
              </div>
            )}
            {section.worstPerformers.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-red-400/60 uppercase tracking-wider mb-2">Worst Performers</h4>
                {section.worstPerformers.map((p, i) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-white/5">
                    <span className="font-mono text-white/60">{p.ticker}</span>
                    <span className="font-mono text-red-400">{p.winRate}% WR <span className="text-white/25">({p.observations} obs)</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* View Full Report CTA */}
          <div className="mt-4 pt-4 border-t border-white/5">
            <a
              href={`/research?agent=${agentFilter}`}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-400 hover:bg-blue-500/20 transition-colors"
              onClick={onClose}
            >
              View Full Report History
              <span className="text-xs text-blue-400/50">{'\u2192'}</span>
            </a>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export function ResearchDigest() {
  const [data, setData] = useState<DigestData | null>(null);
  const [activeModal, setActiveModal] = useState<SectionKey | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const openModal = useCallback((key: SectionKey) => {
    setActiveModal(key);
    onOpen();
  }, [onOpen]);

  const handleClose = useCallback(() => {
    setActiveModal(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/research/digest');
        if (res.ok) setData(await res.json());
      } catch { /* ignore */ }
    }
    load();
    const interval = setInterval(load, 120000); // refresh every 2 min
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  return (
    <>
      <Card className="bg-white/5 border border-white/5">
        <CardBody className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white/60">Research Digest</h3>
            <span className="text-[10px] text-white/20">
              {data.intelligence.totalObservations} observations
            </span>
          </div>
          <div className="space-y-3 divide-y divide-white/5">
            {(['usMarkets', 'crypto', 'forex'] as SectionKey[]).map((key) => (
              <div key={key} className={key !== 'usMarkets' ? 'pt-3' : ''}>
                <DigestSnippet
                  sectionKey={key}
                  section={data[key]}
                  onViewAll={() => openModal(key)}
                />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {activeModal && (
        <DigestModal
          sectionKey={activeModal}
          section={data[activeModal]}
          isOpen={isOpen}
          onClose={handleClose}
        />
      )}
    </>
  );
}

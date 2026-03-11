'use client';

import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Accordion, AccordionItem, Divider, Input } from '@heroui/react';

interface KnowledgeEntry {
  id: string;
  name: string;
  version: number;
  payload: any;
  witnessHash: string;
  createdAt: string;
  updatedAt: string;
}

export default function StrategyPage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeEntry[] | null>(null);

  useEffect(() => {
    fetch('/api/knowledge')
      .then(r => r.json())
      .then(d => setEntries(d.entries || []))
      .catch(() => {});
  }, []);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults(null); return; }
    try {
      const res = await fetch(`/api/knowledge?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results || data.entries || []);
    } catch { setSearchResults([]); }
  };

  const framework = entries.find(e => e.name === 'robert-allen-master-framework');
  const tenStreams = entries.find(e => e.name === 'robert-allen-ten-streams');
  const techniques = entries.find(e => e.name === 'robert-allen-nothing-down-techniques');
  const reinvestment = entries.find(e => e.name === 'robert-allen-reinvestment-strategy');
  const evaluation = entries.find(e => e.name === 'robert-allen-deal-evaluation');

  const mountainColors: Record<string, string> = {
    'Real Estate': 'success',
    'Investment': 'primary',
    'Marketing': 'warning',
  };

  const riskColors: Record<string, 'success' | 'warning' | 'danger'> = {
    low: 'success',
    moderate: 'warning',
    high: 'danger',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Strategy Guide</h1>
          <p className="text-sm text-white/40 mt-1">Robert Allen — Multiple Streams of Income + Nothing Down</p>
        </div>
        <div className="flex items-center gap-2">
          <Chip size="sm" variant="flat" color="success">{entries.length} RVF containers</Chip>
          <Chip size="sm" variant="flat" color="default">Witness-chain attested</Chip>
        </div>
      </div>

      {/* Search */}
      <Input
        value={searchQuery}
        onValueChange={handleSearch}
        placeholder="Search strategies... (e.g. lease option, foreclosure, pyramiding)"
        variant="bordered"
        classNames={{ inputWrapper: 'bg-white/5 border-white/10' }}
      />

      {searchResults && (
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40 mb-2">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;</div>
            {searchResults.length === 0 ? (
              <div className="text-sm text-white/30">No matching strategies found.</div>
            ) : (
              <div className="space-y-2">
                {searchResults.map(r => (
                  <div key={r.id} className="p-2 rounded bg-white/5 text-sm">
                    <span className="font-medium text-blue-400">{r.name}</span>
                    <span className="text-white/30 ml-2 text-xs">v{r.version} — {r.payload?.category || r.payload?.content?.category}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Three Money Mountains */}
      {framework && (
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <h2 className="font-semibold text-white/90">The Three Money Mountains</h2>
          </CardHeader>
          <CardBody className="px-4 pb-4 pt-3">
            <p className="text-sm text-white/50 mb-4">{framework.payload.content.threeMoneyMountains.description}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {framework.payload.content.threeMoneyMountains.mountains.map((m: any) => (
                <Card key={m.name} className="bg-white/5 border border-white/5">
                  <CardBody className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Chip size="sm" variant="flat" color={mountainColors[m.name.replace(' Mountain', '')] as any}>{m.name}</Chip>
                    </div>
                    <p className="text-xs text-white/50 mb-3">{m.description}</p>
                    <div className="text-xs text-white/30">MTWM Module: <span className="text-white/60">{m.mtwmModule}</span></div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {m.streams.map((s: string) => (
                        <Chip key={s} size="sm" variant="dot" color="default" className="text-xs">{s}</Chip>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>

            <Divider className="my-4 bg-white/5" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-white/70 mb-1">Money Tree Formula</h3>
                <p className="text-xs text-white/40">{framework.payload.content.moneyTreeFormula.principle}</p>
                <p className="text-xs text-blue-400/60 mt-1">{framework.payload.content.moneyTreeFormula.mtwmApplication}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-white/70 mb-1">80/20 Principle</h3>
                <p className="text-xs text-white/40">{framework.payload.content.eightyTwentyPrinciple}</p>
                <h3 className="text-sm font-medium text-white/70 mb-1 mt-3">Financial Fortress</h3>
                <p className="text-xs text-white/40">{framework.payload.content.financialFortress}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Ten Income Streams */}
      {tenStreams && (
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <h2 className="font-semibold text-white/90">The 10 Income Streams</h2>
          </CardHeader>
          <CardBody className="px-4 pb-4 pt-3">
            <div className="space-y-2">
              {tenStreams.payload.content.streams.map((s: any) => (
                <div key={s.number} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-white/60">{s.number}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white/90">{s.name}</span>
                      <Chip size="sm" variant="flat" color={mountainColors[s.mountain] as any}>{s.mountain}</Chip>
                      {s.automatable && <Chip size="sm" variant="flat" color="success">Automatable</Chip>}
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">{s.description}</p>
                    <p className="text-xs text-blue-400/50 mt-0.5">MTWM: {s.mtwmStrategy}</p>
                  </div>
                  <Chip size="sm" variant="bordered" color="default">{s.mtwmModule}</Chip>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Nothing Down Techniques */}
      {techniques && (
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <div>
              <h2 className="font-semibold text-white/90">Nothing Down — Creative Financing Techniques</h2>
              <p className="text-xs text-white/40 mt-1">{techniques.payload.content.corePrinciple}</p>
            </div>
          </CardHeader>
          <CardBody className="px-4 pb-4 pt-3">
            {/* Find, Fund, Farm */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {Object.entries(techniques.payload.content.findFundFarm).map(([key, val]) => (
                <div key={key} className="p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-sm font-bold text-blue-400 uppercase mb-1">{key}</div>
                  <p className="text-xs text-white/50">{val as string}</p>
                </div>
              ))}
            </div>

            <Accordion variant="splitted" className="gap-2">
              {techniques.payload.content.techniques.map((t: any, i: number) => (
                <AccordionItem
                  key={i}
                  title={
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t.name}</span>
                      <Chip size="sm" variant="flat" color={riskColors[t.riskLevel]}>{t.riskLevel} risk</Chip>
                    </div>
                  }
                  classNames={{ base: 'bg-white/5 border border-white/5', title: 'text-white/90', content: 'text-white/60' }}
                >
                  <div className="space-y-2 pb-2">
                    <p className="text-sm">{t.description}</p>
                    {t.whenToUse && <p className="text-xs text-white/40"><strong>When to use:</strong> {t.whenToUse}</p>}
                    {t.process && <p className="text-xs text-white/40"><strong>Process:</strong> {t.process}</p>}
                    {t.example && <p className="text-xs text-green-400/60"><strong>Example:</strong> {t.example}</p>}
                    {t.principle && <p className="text-xs text-blue-400/60"><strong>Principle:</strong> {t.principle}</p>}
                    {t.risks && (
                      <div className="flex gap-1 flex-wrap">
                        {t.risks.map((r: string) => <Chip key={r} size="sm" variant="flat" color="danger">{r}</Chip>)}
                      </div>
                    )}
                    <div className="flex gap-1 flex-wrap mt-1">
                      {t.mtwmEvaluation?.map((e: string) => <Chip key={e} size="sm" variant="dot" color="primary">{e}</Chip>)}
                    </div>
                  </div>
                </AccordionItem>
              ))}
            </Accordion>

            <Divider className="my-4 bg-white/5" />
            <h3 className="text-sm font-medium text-white/70 mb-2">Negotiation Principles</h3>
            <div className="space-y-1">
              {techniques.payload.content.negotiationPrinciples.map((p: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-white/50">
                  <span className="text-blue-400 mt-0.5">&#x2022;</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Reinvestment Strategy (Phases) */}
      {reinvestment && (
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <h2 className="font-semibold text-white/90">MTWM Reinvestment Strategy — 5 Phases</h2>
          </CardHeader>
          <CardBody className="px-4 pb-4 pt-3">
            <div className="space-y-4">
              {reinvestment.payload.content.phases.map((p: any) => (
                <div key={p.phase} className="flex gap-4 p-4 rounded-lg bg-white/5 border border-white/5">
                  <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-lg font-bold text-blue-400 shrink-0">{p.phase}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-white/90">{p.name}</span>
                      {p.phase === 1 && <Chip size="sm" variant="flat" color="warning">Current Phase</Chip>}
                    </div>
                    <p className="text-xs text-blue-400/60 mb-2">Allen: {p.allenPrinciple}</p>
                    <div className="space-y-1">
                      {p.mtwmActions.map((a: string, i: number) => (
                        <div key={i} className="text-xs text-white/50 flex items-start gap-1">
                          <span className="text-white/30">&#x25B8;</span> {a}
                        </div>
                      ))}
                    </div>
                    {p.streams && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {p.streams.map((s: string) => <Chip key={s} size="sm" variant="dot" color="success">{s}</Chip>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Divider className="my-4 bg-white/5" />
            <h3 className="text-sm font-medium text-white/70 mb-2">Reinvestment Rules</h3>
            <div className="space-y-1">
              {reinvestment.payload.content.reinvestmentRules.map((r: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-white/50">
                  <span className="text-green-400 mt-0.5">&#x2022;</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Deal Evaluation Criteria */}
      {evaluation && (
        <Card className="bg-white/5 border border-white/5">
          <CardHeader className="px-4 pt-4 pb-0">
            <h2 className="font-semibold text-white/90">Deal Evaluation Criteria</h2>
          </CardHeader>
          <CardBody className="px-4 pb-4 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <h3 className="text-sm font-medium text-green-400/80 mb-2">Must Have</h3>
                {evaluation.payload.content.mustHave.map((m: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-white/50 mb-1">
                    <span className="text-green-400">&#x2713;</span> {m}
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-medium text-red-400/80 mb-2">Red Flags</h3>
                {evaluation.payload.content.redFlags.map((r: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-white/50 mb-1">
                    <span className="text-red-400">&#x2717;</span> {r}
                  </div>
                ))}
              </div>
            </div>

            <h3 className="text-sm font-medium text-white/70 mb-2">Scoring Metrics</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Object.entries(evaluation.payload.content.scoringMetrics).map(([key, val]: [string, any]) => (
                <div key={key} className="p-2 rounded bg-white/5 border border-white/5 text-center">
                  <div className="text-xs text-white/40 mb-1">{key}</div>
                  {val.minimum && <div className="text-xs text-white/60">Min: {val.minimum}</div>}
                  {val.target && <div className="text-xs text-green-400/60">Target: {val.target}</div>}
                  {val.maximum && <div className="text-xs text-white/60">Max: {val.maximum}</div>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* RVF Attestation */}
      <div className="text-xs text-white/20 text-center py-2">
        All strategy data stored in RVF containers with SHA-256 witness chain attestation — {entries.length} containers, {entries.reduce((s, e) => s + (e.version || 1), 0)} total versions
      </div>
    </div>
  );
}

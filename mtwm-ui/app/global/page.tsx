'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, CardHeader, Chip, Button, Divider, Progress } from '@heroui/react';

interface Session {
  name: string;
  open?: boolean;
  openUTC?: string;
  closeUTC?: string;
  openTime?: string;
  closeTime?: string;
  timezone?: string;
}

interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  session: string;
  volume: number;
}

const SESSION_ORDER = ['Sydney', 'Tokyo', 'HK', 'London', 'Frankfurt', 'NY', 'Crypto'];

export default function GlobalMarketsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchQuotes = useCallback(async () => {
    try {
      const res = await fetch('/api/expansion/global/quotes');
      const data = await res.json();
      setQuotes(data.quotes || []);
      setLastUpdated(new Date());
    } catch {
      /* keep stale data */
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [sessRes] = await Promise.all([
          fetch('/api/expansion/global/sessions'),
          fetchQuotes(),
        ]);
        const sessData = await sessRes.json();
        setSessions(sessData.sessions || []);
      } catch {
        /* keep defaults */
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [fetchQuotes]);

  // Auto-refresh quotes every 60s
  useEffect(() => {
    const interval = setInterval(fetchQuotes, 60_000);
    return () => clearInterval(interval);
  }, [fetchQuotes]);

  // Compute open status from UTC open/close times if not provided
  function isSessionOpen(s: Session): boolean {
    if (typeof s.open === 'boolean') return s.open;
    if (!s.openUTC || !s.closeUTC) return false;
    const now = new Date();
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const [oh, om] = s.openUTC.split(':').map(Number);
    const [ch, cm] = s.closeUTC.split(':').map(Number);
    const openMin = oh * 60 + (om || 0);
    const closeMin = ch * 60 + (cm || 0);
    if (closeMin > openMin) return nowMinutes >= openMin && nowMinutes < closeMin;
    // Wraps midnight (e.g. 23:59)
    return nowMinutes >= openMin || nowMinutes < closeMin;
  }

  const sessionMap = new Map(sessions.map(s => [s.name, s]));
  const activeSessions = sessions.filter(s => isSessionOpen(s)).length;
  const coverageHours = activeSessions > 0 ? Math.round((activeSessions / 7) * 24) : 0;

  const formatChange = (val: number) => (val >= 0 ? `+${val.toFixed(2)}` : val.toFixed(2));
  const formatPercent = (val: number) => (val >= 0 ? `+${val.toFixed(2)}%` : `${val.toFixed(2)}%`);
  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
    return vol.toString();
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-white/40">Loading global markets...</div>
        <Progress isIndeterminate size="sm" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Global Markets</h1>
          <p className="text-sm text-white/40 mt-1">24/7 Market Coverage — Money Never Sleeps</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-white/40">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button size="sm" variant="flat" onPress={fetchQuotes}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Session Timeline Bar */}
      <Card className="bg-white/5 border border-white/5">
        <CardHeader className="px-4 pt-4 pb-0">
          <h3 className="font-semibold text-white/80">Session Timeline</h3>
        </CardHeader>
        <CardBody className="p-4">
          <div className="flex flex-wrap gap-2">
            {SESSION_ORDER.map(name => {
              const session = sessionMap.get(name);
              const isOpen = session ? isSessionOpen(session) : false;
              return (
                <div
                  key={name}
                  className="flex-1 min-w-[60px] flex flex-col items-center gap-2"
                >
                  <div
                    className={`w-full h-3 rounded-full ${
                      isOpen ? 'bg-green-500/80' : 'bg-white/10'
                    }`}
                  />
                  <span className={`text-xs ${isOpen ? 'text-green-400' : 'text-white/40'}`}>
                    {name}
                  </span>
                  <Chip
                    size="sm"
                    variant="flat"
                    color={isOpen ? 'success' : 'default'}
                  >
                    {isOpen ? 'Open' : 'Closed'}
                  </Chip>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Active Sessions</div>
            <div className="text-2xl font-bold">{activeSessions}</div>
            <div className="text-xs text-white/40 mt-1">of {SESSION_ORDER.length} total</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Total Quotes</div>
            <div className="text-2xl font-bold">{quotes.length}</div>
            <div className="text-xs text-white/40 mt-1">instruments tracked</div>
          </CardBody>
        </Card>
        <Card className="bg-white/5 border border-white/5">
          <CardBody className="p-4">
            <div className="text-xs text-white/40">Coverage Hours</div>
            <div className="text-2xl font-bold">{coverageHours}h</div>
            <div className="text-xs text-white/40 mt-1">of 24h cycle</div>
          </CardBody>
        </Card>
      </div>

      <Divider className="bg-white/5" />

      {/* Quotes Grid */}
      <div>
        <h3 className="font-semibold text-white/80 mb-4">Live Quotes</h3>
        {quotes.length === 0 ? (
          <div className="text-white/40 text-sm">No quotes available. Markets may be loading.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {quotes.map(q => {
              const isPositive = q.change >= 0;
              return (
                <Card key={q.symbol} className="bg-white/5 border border-white/5">
                  <CardBody className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white/80">{q.symbol}</span>
                      <Chip size="sm" variant="flat">
                        {q.session}
                      </Chip>
                    </div>
                    <div className="text-xl font-bold">
                      ${q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {formatChange(q.change)} ({formatPercent(q.changePercent)})
                      </span>
                    </div>
                    <div className="text-xs text-white/40">
                      Vol: {formatVolume(q.volume)}
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

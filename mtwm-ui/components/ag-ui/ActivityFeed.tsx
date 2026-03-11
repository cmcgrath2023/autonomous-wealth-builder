'use client';

import { useEffect, useRef } from 'react';
import { Card, CardBody, CardHeader, Chip, Divider } from '@heroui/react';
import { useAGUI } from '../../hooks/useAGUI';

function eventTypeColor(event: { type: string; name?: string }): {
  color: 'primary' | 'warning' | 'success' | 'secondary' | 'default' | 'danger';
  label: string;
} {
  if (event.type === 'RUN_ERROR') return { color: 'danger', label: 'ERROR' };
  if (event.type.startsWith('STEP')) return { color: 'primary', label: 'STEP' };
  if (event.type.startsWith('TOOL_CALL')) return { color: 'warning', label: 'TOOL' };
  if (event.type === 'TEXT_MESSAGE_CONTENT') return { color: 'success', label: 'MESSAGE' };
  if (event.type.startsWith('STATE')) return { color: 'secondary', label: 'STATE' };
  return { color: 'default', label: event.name === 'agent_heartbeat' ? 'HEARTBEAT' : 'CUSTOM' };
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function eventSummary(event: Record<string, unknown>): string {
  if (event.stepName) return String(event.stepName);
  if (event.toolCallName) return String(event.toolCallName);
  if (event.delta) return String(event.delta).slice(0, 120);
  if (event.message) return String(event.message).slice(0, 120);
  return event.type as string;
}

export default function ActivityFeed() {
  const { connected, events, agents, connect, disconnect } = useAGUI(200);
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events.length]);

  const recentAgents = Array.from(agents.entries()).filter(
    ([, info]) => Date.now() - info.lastSeen.getTime() < 60_000
  );

  const visibleEvents = events.slice(-50).reverse();

  return (
    <div className="flex gap-4 w-full h-full">
      {/* Main feed */}
      <Card className="flex-1 bg-white/5 border border-white/5">
        <CardHeader className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div
              className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'}`}
            />
            <span className="text-white/80 font-medium text-sm">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={connected ? disconnect : connect}
              className="text-xs px-3 py-1 rounded bg-white/10 text-white/60 hover:text-white/80 hover:bg-white/15 transition-colors"
            >
              {connected ? 'Disconnect' : 'Connect'}
            </button>
            <Chip size="sm" variant="flat" className="text-white/40">
              {events.length} events
            </Chip>
          </div>
        </CardHeader>
        <Divider className="bg-white/5" />
        <CardBody className="p-0">
          <div ref={feedRef} className="overflow-y-auto max-h-[calc(100vh-220px)] p-3 space-y-1.5">
            {visibleEvents.length === 0 && (
              <div className="text-center text-white/30 py-12 text-sm">
                Waiting for agent events...
              </div>
            )}
            {visibleEvents.map((event, i) => {
              const { color, label } = eventTypeColor(event);
              const agentName = event.agentId || event.name || '';
              return (
                <div
                  key={`${event.timestamp}-${i}`}
                  className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group"
                >
                  <span className="text-white/30 text-xs font-mono mt-0.5 shrink-0 w-16">
                    {formatTimestamp(event.timestamp)}
                  </span>
                  {agentName && (
                    <span className="text-white/50 text-xs font-medium mt-0.5 shrink-0 w-28 truncate">
                      {agentName}
                    </span>
                  )}
                  <Chip size="sm" color={color} variant="flat" className="shrink-0">
                    {label}
                  </Chip>
                  <span className="text-white/80 text-sm truncate">
                    {eventSummary(event)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Active agents sidebar */}
      <Card className="w-64 shrink-0 bg-white/5 border border-white/5">
        <CardHeader>
          <span className="text-white/80 font-medium text-sm">Active Agents</span>
        </CardHeader>
        <Divider className="bg-white/5" />
        <CardBody className="space-y-2">
          {recentAgents.length === 0 && (
            <div className="text-white/30 text-xs text-center py-4">
              No active agents
            </div>
          )}
          {recentAgents.map(([id, info]) => {
            const secsAgo = Math.round((Date.now() - info.lastSeen.getTime()) / 1000);
            return (
              <div key={id} className="flex flex-col gap-1 p-2 rounded-lg bg-white/5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  <span className="text-white/80 text-xs font-medium truncate">{id}</span>
                </div>
                <span className="text-white/40 text-[10px] pl-3.5">
                  {info.lastStep} &middot; {secsAgo}s ago
                </span>
              </div>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}

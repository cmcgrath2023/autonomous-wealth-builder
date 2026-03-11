'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface AGUIEvent {
  type: string;
  timestamp: string;
  runId?: string;
  messageId?: string;
  agentId?: string;
  stepId?: string;
  stepName?: string;
  toolCallId?: string;
  toolCallName?: string;
  delta?: string;
  data?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  name?: string;
  message?: string;
  role?: string;
  [key: string]: unknown;
}

interface AGUIState {
  connected: boolean;
  events: AGUIEvent[];
  agents: Map<string, { lastSeen: Date; lastStep: string }>;
  clientCount: number;
}

export function useAGUI(maxEvents = 200) {
  const [state, setState] = useState<AGUIState>({
    connected: false,
    events: [],
    agents: new Map(),
    clientCount: 0,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;

    const es = new EventSource('/api/ag-ui/stream');
    eventSourceRef.current = es;

    es.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
    };

    es.onmessage = (event) => {
      try {
        const parsed: AGUIEvent = JSON.parse(event.data);
        setState(prev => {
          const events = [...prev.events, parsed].slice(-maxEvents);
          const agents = new Map(prev.agents);

          // Track agent activity
          const agentId = parsed.agentId || parsed.name || '';
          if (agentId) {
            agents.set(agentId, {
              lastSeen: new Date(),
              lastStep: parsed.stepName || parsed.toolCallName || parsed.type,
            });
          }

          return { ...prev, events, agents };
        });
      } catch {}
    };

    es.onerror = () => {
      setState(prev => ({ ...prev, connected: false }));
      es.close();
      eventSourceRef.current = null;
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };
  }, [maxEvents]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setState(prev => ({ ...prev, connected: false }));
    }
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    // Filtered views
    signals: state.events.filter(e => e.stepName === 'signal_generated' || e.stepName === 'supply_chain_signal'),
    trades: state.events.filter(e => e.type === 'TOOL_CALL_START' && (e.toolCallName === 'execute_trade' || e.toolCallName === 'auto_execute')),
    heartbeats: state.events.filter(e => e.name === 'agent_heartbeat'),
    approvals: state.events.filter(e => e.stepName === 'pending_approval'),
    errors: state.events.filter(e => e.type === 'RUN_ERROR'),
    messages: state.events.filter(e => e.type === 'TEXT_MESSAGE_CONTENT'),
  };
}

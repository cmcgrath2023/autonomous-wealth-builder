'use client';

import { useEffect } from 'react';
import { Card, CardBody, CardHeader, Button, Chip } from '@heroui/react';
import { useDecisionsStore } from '@/stores/decisions';
import { formatCurrency, formatRelativeTime } from '@/lib/utils/formatters';
import { REFRESH_INTERVALS } from '@/lib/utils/constants';

export function DecisionQueue() {
  const { decisions, fetchDecisions, approveDecision, rejectDecision } = useDecisionsStore();

  useEffect(() => {
    fetchDecisions();
    const interval = setInterval(fetchDecisions, REFRESH_INTERVALS.decisions);
    return () => clearInterval(interval);
  }, [fetchDecisions]);

  const pending = decisions.filter((d) => d.status === 'pending');

  const priorityColor = (p: string) => {
    switch (p) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'normal': return 'primary';
      default: return 'default';
    }
  };

  return (
    <Card className="bg-white/5 border border-white/5">
      <CardHeader className="flex justify-between items-center px-4 pt-4 pb-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-white/90">Pending Decisions</h3>
          {pending.length > 0 && (
            <Chip size="sm" color="warning" variant="flat">{pending.length}</Chip>
          )}
        </div>
      </CardHeader>
      <CardBody className="px-4 pb-4 pt-3">
        {pending.length === 0 ? (
          <div className="text-sm text-white/30 py-4 text-center">No pending decisions — system operating autonomously</div>
        ) : (
          <div className="space-y-3">
            {pending.map((decision) => (
              <div key={decision.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Chip size="sm" variant="flat" color={priorityColor(decision.priority)}>{decision.priority}</Chip>
                    <span className="text-sm font-medium text-white/80">{decision.title}</span>
                  </div>
                  <p className="text-xs text-white/40 mt-1">{decision.description}</p>
                  {decision.amount && (
                    <p className="text-xs text-white/50 mt-1 font-medium">{formatCurrency(decision.amount)}</p>
                  )}
                  <p className="text-xs text-white/20 mt-1">{decision.module} — {formatRelativeTime(decision.createdAt)}</p>
                </div>
                <div className="flex gap-2 ml-4">
                  <Button size="sm" color="success" variant="flat" isIconOnly aria-label="Approve" onPress={() => approveDecision(decision.id)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>
                  </Button>
                  <Button size="sm" color="danger" variant="flat" isIconOnly aria-label="Reject" onPress={() => rejectDecision(decision.id)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

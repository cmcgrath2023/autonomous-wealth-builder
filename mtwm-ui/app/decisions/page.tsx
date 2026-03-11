'use client';

import { DecisionQueue } from '@/components/dashboard/DecisionQueue';

export default function DecisionsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Decision Queue</h1>
      <DecisionQueue />
    </div>
  );
}

'use client';

import { Card, CardBody, Progress } from '@heroui/react';
import { useSystemStore } from '@/stores/system';

export function SystemStatus() {
  const { swarmStatus } = useSystemStore();

  if (!swarmStatus) return null;

  return (
    <Card className="bg-white/5 border border-white/5">
      <CardBody className="p-4">
        <h3 className="text-sm font-semibold text-white/60 mb-3">Swarm Status</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-white/50">Active Agents</span>
            <span className="font-medium">{swarmStatus.activeAgents}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Queued Tasks</span>
            <span className="font-medium">{swarmStatus.queuedTasks}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Completed Today</span>
            <span className="font-medium">{swarmStatus.completedToday}</span>
          </div>
          <Progress
            size="sm"
            value={(swarmStatus.activeAgents / 8) * 100}
            color="primary"
            className="mt-2"
            label="Agent Utilization"
          />
        </div>
      </CardBody>
    </Card>
  );
}

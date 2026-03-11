'use client';

import { Card, CardBody } from '@heroui/react';

interface MetricTileProps {
  label: string;
  value: string;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

export function MetricTile({ label, value, subValue, trend, color }: MetricTileProps) {
  const trendColor = trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-white/60';

  return (
    <Card className="bg-white/5 border border-white/5">
      <CardBody className="p-4">
        <div className="text-xs text-white/40 mb-1">{label}</div>
        <div className={`text-xl font-bold ${trendColor}`} style={color ? { color } : undefined}>
          {value}
        </div>
        {subValue && <div className="text-xs text-white/30 mt-1">{subValue}</div>}
      </CardBody>
    </Card>
  );
}

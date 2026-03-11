'use client';

import { Divider } from '@heroui/react';

interface QueryEntry {
  id: string;
  query: string;
  response: string;
  timestamp: Date;
}

interface QueryHistoryProps {
  entries: QueryEntry[];
}

export function QueryHistory({ entries }: QueryHistoryProps) {
  return (
    <div>
      <h3 className="font-semibold text-white/60 text-sm mb-3">Query History</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-white/30">No queries yet</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id}>
              <div className="text-xs text-blue-400/70 font-medium">{entry.query}</div>
              <div className="text-xs text-white/40 mt-1 line-clamp-3">{entry.response}</div>
              <div className="text-xs text-white/20 mt-1">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </div>
              <Divider className="mt-3 bg-white/5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

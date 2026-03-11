'use client';

import { useState } from 'react';
import { QueryInput } from '@/components/query/QueryInput';
import { QueryResponse } from '@/components/query/QueryResponse';
import { QueryHistory } from '@/components/query/QueryHistory';

interface QueryEntry {
  id: string;
  query: string;
  response: string;
  timestamp: Date;
}

export default function QueryPage() {
  const [history, setHistory] = useState<QueryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState<string | null>(null);

  const handleQuery = async (query: string) => {
    setLoading(true);
    setCurrentResponse(null);
    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await response.json();
      const entry: QueryEntry = { id: Date.now().toString(), query, response: data.response, timestamp: new Date() };
      setCurrentResponse(data.response);
      setHistory((prev) => [entry, ...prev]);
    } catch {
      setCurrentResponse('Error processing query. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Query System</h1>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <QueryInput onSubmit={handleQuery} loading={loading} />
          {currentResponse && <QueryResponse response={currentResponse} />}
        </div>
        <div className="bg-white/5 rounded-2xl border border-white/5 p-4">
          <QueryHistory entries={history} />
        </div>
      </div>
    </div>
  );
}

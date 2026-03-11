'use client';

import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Button, Spinner } from '@heroui/react';

interface BriefingSection {
  title: string;
  content: string;
  priority: 'info' | 'action' | 'alert';
}

export function BriefingPanel() {
  const [briefing, setBriefing] = useState<BriefingSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  useEffect(() => {
    fetchBriefing();
  }, []);

  const fetchBriefing = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/briefing');
      const data = await response.json();
      setBriefing(data.sections);
      setLastGenerated(data.generatedAt);
    } catch {
      setBriefing([{ title: 'System', content: 'Unable to load briefing. Check system connections.', priority: 'alert' }]);
    } finally {
      setLoading(false);
    }
  };

  const priorityStyles = {
    info: 'border-l-blue-500/50',
    action: 'border-l-amber-500/50',
    alert: 'border-l-red-500/50',
  };

  return (
    <Card className="bg-white/5 border border-white/5 h-full">
      <CardHeader className="flex justify-between items-center px-4 pt-4 pb-0">
        <div>
          <h3 className="font-semibold text-white/90">Daily Briefing</h3>
          {lastGenerated && <p className="text-xs text-white/30 mt-0.5">{lastGenerated}</p>}
        </div>
        <Button size="sm" variant="ghost" onPress={fetchBriefing} isLoading={loading}>
          Refresh
        </Button>
      </CardHeader>
      <CardBody className="px-4 pb-4 pt-3 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner size="sm" /></div>
        ) : (
          <div className="space-y-3">
            {briefing.map((section, i) => (
              <div key={i} className={`border-l-2 ${priorityStyles[section.priority]} pl-3 py-1`}>
                <div className="text-sm font-medium text-white/80">{section.title}</div>
                <div className="text-xs text-white/50 mt-1 leading-relaxed">{section.content}</div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

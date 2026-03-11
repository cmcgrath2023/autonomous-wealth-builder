'use client';

import { Card, CardBody } from '@heroui/react';

interface QueryResponseProps {
  response: string;
}

export function QueryResponse({ response }: QueryResponseProps) {
  return (
    <Card className="bg-white/5 border border-white/5">
      <CardBody className="p-4">
        <div className="text-xs text-blue-400/60 mb-2 font-medium">MTWM Response</div>
        <div className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{response}</div>
      </CardBody>
    </Card>
  );
}

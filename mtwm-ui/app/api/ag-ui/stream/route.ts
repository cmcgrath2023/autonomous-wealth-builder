import { NextRequest } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const upstream = await fetch(`${GATEWAY}/api/ag-ui/stream`, {
    headers: { 'Accept': 'text/event-stream' },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response('Gateway unavailable', { status: 503 });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

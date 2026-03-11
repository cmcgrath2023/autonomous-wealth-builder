import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${GATEWAY}/api/expansion/infra/capex-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Gateway unavailable');
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Failed to register capex event' }, { status: 500 });
  }
}

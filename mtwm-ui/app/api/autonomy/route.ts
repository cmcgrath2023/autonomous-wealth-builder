import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint') || 'status';

  try {
    const res = await fetch(`${GATEWAY}/api/autonomy/${endpoint}`);
    if (!res.ok) throw new Error('Gateway unavailable');
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Gateway unavailable' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'toggle';

  try {
    const body = action === 'toggle' ? undefined : await request.json();
    const res = await fetch(`${GATEWAY}/api/autonomy/${action}`, {
      method: action === 'config' ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error('Gateway unavailable');
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Gateway unavailable' }, { status: 503 });
  }
}

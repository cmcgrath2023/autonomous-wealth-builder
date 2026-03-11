import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/api/realestate/tasks`);
    if (!res.ok) throw new Error('Gateway unavailable');
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ tasks: [], summary: { total: 0, pending: 0, inProgress: 0, done: 0 } });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${GATEWAY}/api/realestate/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Gateway unavailable' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    const res = await fetch(`${GATEWAY}/api/realestate/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Gateway unavailable' }, { status: 503 });
  }
}

import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const res = await fetch(`${GATEWAY}/api/realestate/tasks/${id}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Gateway unavailable');
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Task execution failed' }, { status: 503 });
  }
}

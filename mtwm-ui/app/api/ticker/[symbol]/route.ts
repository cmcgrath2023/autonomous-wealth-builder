import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const res = await fetch(`${GATEWAY}/api/ticker/${symbol}`);
    if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Gateway unavailable' }, { status: 502 });
  }
}

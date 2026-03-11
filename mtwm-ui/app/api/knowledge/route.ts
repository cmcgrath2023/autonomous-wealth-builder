import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');

  try {
    const url = q
      ? `${GATEWAY}/api/knowledge/search?q=${encodeURIComponent(q)}`
      : `${GATEWAY}/api/knowledge`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Gateway unavailable');
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ entries: [], count: 0 });
  }
}

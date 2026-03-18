import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get('agent') || '';
  const limit = request.nextUrl.searchParams.get('limit') || '50';

  try {
    const url = agent
      ? `${GATEWAY}/api/research/reports?agent=${agent}&limit=${limit}`
      : `${GATEWAY}/api/research/reports?limit=${limit}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return NextResponse.json({ reports: [] });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ reports: [] });
  }
}

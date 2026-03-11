import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category') || '';
  const limit = request.nextUrl.searchParams.get('limit') || '50';

  try {
    const url = `${GATEWAY}/api/learnings?limit=${limit}${category ? `&category=${category}` : ''}`;
    const res = await fetch(url);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ entries: [], summary: {} });
  }
}

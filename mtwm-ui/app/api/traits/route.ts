import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category') || '';
  try {
    const url = `${GATEWAY}/api/traits${category ? `?category=${category}` : ''}`;
    const res = await fetch(url);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ traits: [], metrics: {} });
  }
}

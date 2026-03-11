import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/api/expansion/options/strategies`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ strategies: [] }, { status: 502 });
  }
}

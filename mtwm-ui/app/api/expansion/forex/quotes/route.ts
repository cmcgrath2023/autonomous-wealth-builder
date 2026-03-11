import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/api/expansion/forex/quotes`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ quotes: [], session: 'unknown', connected: false }, { status: 502 });
  }
}

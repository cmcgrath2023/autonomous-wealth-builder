import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/api/roadmap`);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ roadmap: null });
  }
}

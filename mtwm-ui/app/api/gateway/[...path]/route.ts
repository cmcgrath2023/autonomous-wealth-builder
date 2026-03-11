import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const gatewayPath = path.join('/');
  const search = req.nextUrl.search || '';
  try {
    const res = await fetch(`${GATEWAY}/api/${gatewayPath}${search}`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Gateway unavailable' }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const gatewayPath = path.join('/');
  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(`${GATEWAY}/api/${gatewayPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Gateway unavailable' }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const gatewayPath = path.join('/');
  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(`${GATEWAY}/api/${gatewayPath}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Gateway unavailable' }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

// Credentials — set via env vars or defaults
const AUTH_USERNAME = process.env.MTWM_AUTH_USERNAME || 'mcgrath';
const AUTH_PASSWORD = process.env.MTWM_AUTH_PASSWORD || 'mcgrath-trust-2026';
const AUTH_COOKIE = 'mtwm-auth';
// Simple hash of username:password for the cookie value
const AUTH_TOKEN = Buffer.from(`${AUTH_USERNAME}:${AUTH_PASSWORD}`).toString('base64');

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, AUTH_TOKEN, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });

  return response;
}

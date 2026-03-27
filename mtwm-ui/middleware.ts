import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE = 'mtwm-auth';
const AUTH_USERNAME = process.env.MTWM_AUTH_USERNAME || 'mcgrath';
const AUTH_PASSWORD = process.env.MTWM_AUTH_PASSWORD || 'mcgrath-trust-2026';
const AUTH_TOKEN = Buffer.from(`${AUTH_USERNAME}:${AUTH_PASSWORD}`).toString('base64');

export function middleware(request: NextRequest) {
  // Skip auth for login routes and static assets
  if (
    request.nextUrl.pathname === '/api/auth/login' ||
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname.startsWith('/api/') ||
    request.nextUrl.pathname.startsWith('/_next/') ||
    request.nextUrl.pathname.startsWith('/favicon') ||
    request.nextUrl.pathname.endsWith('.svg') ||
    request.nextUrl.pathname.endsWith('.png') ||
    request.nextUrl.pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get(AUTH_COOKIE);
  if (authCookie?.value === AUTH_TOKEN) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};

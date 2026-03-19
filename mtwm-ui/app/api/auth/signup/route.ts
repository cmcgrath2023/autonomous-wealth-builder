import { NextRequest, NextResponse } from 'next/server';
import { getTenantAuth, AUTH_COOKIE_OPTIONS } from '@/src/lib/tenant';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { message: 'Email and password are required' },
        { status: 400 },
      );
    }

    const auth = getTenantAuth();
    const result = await auth.signup(email, password, name || email.split('@')[0]);

    const response = NextResponse.json({
      ok: true,
      tenantId: result.tenantId,
      email: result.email,
      tier: result.tier,
    });

    response.cookies.set(AUTH_COOKIE_OPTIONS.name, result.token, {
      httpOnly: AUTH_COOKIE_OPTIONS.httpOnly,
      secure: AUTH_COOKIE_OPTIONS.secure,
      sameSite: AUTH_COOKIE_OPTIONS.sameSite,
      maxAge: AUTH_COOKIE_OPTIONS.maxAge,
      path: AUTH_COOKIE_OPTIONS.path,
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signup failed';
    const status = message.includes('already exists') ? 409 : 500;
    return NextResponse.json({ message }, { status });
  }
}

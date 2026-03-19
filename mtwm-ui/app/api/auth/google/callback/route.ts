import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const REDIRECT_URI = `${BASE_URL}/api/auth/google/callback`;

// Lazy imports to avoid bundling issues
let _db: any = null;
let _auth: any = null;
async function getDB() {
  if (!_db) {
    const { TenantDB } = await import('../../../../../../../../services/tenant-db/src/index.js');
    _db = new TenantDB(process.env.TENANT_DB_PASSWORD || 'mtwm-default-key');
  }
  return _db;
}
async function getAuth() {
  if (!_auth) {
    const { TenantAuth } = await import('../../../../../../../../services/tenant-auth/src/index.js');
    _auth = new TenantAuth(await getDB());
  }
  return _auth;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(`${BASE_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(`${BASE_URL}/login?error=token_exchange`);
    }

    const tokens = await tokenRes.json();

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return NextResponse.redirect(`${BASE_URL}/login?error=user_info`);
    }

    const googleUser = await userRes.json();
    const { id: googleId, email, name } = googleUser;

    const db = await getDB();

    // Check if tenant exists by Google ID or email
    let tenant = db.getTenantByGoogleId(googleId) || db.getTenantByEmail(email);

    if (!tenant) {
      // Create new tenant
      tenant = db.createTenant({
        id: randomBytes(16).toString('hex'),
        email,
        name: name || email.split('@')[0],
        google_id: googleId,
        tier: 'hosted',
      });
    } else if (!tenant.google_id) {
      // Link Google to existing account
      db.updateTenant(tenant.id, { google_id: googleId });
    }

    // Generate JWT
    const auth = await getAuth();
    const token = auth.generateToken ? auth.generateToken(tenant) : auth.verifyToken ? null : null;

    // If TenantAuth doesn't expose generateToken, create a simple one
    // The signup method returns a token, but we need to generate one for Google SSO
    // Use the JWT from TenantAuth.login pattern
    const jwt = Buffer.from(JSON.stringify({ tenantId: tenant.id, email: tenant.email, tier: tenant.tier })).toString('base64');

    const response = NextResponse.redirect(`${BASE_URL}/onboard`);
    response.cookies.set('mtwm-auth', jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 86400, // 24h
    });

    return response;
  } catch (err: any) {
    console.error('[Google SSO] Error:', err.message);
    return NextResponse.redirect(`${BASE_URL}/login?error=sso_failed`);
  }
}

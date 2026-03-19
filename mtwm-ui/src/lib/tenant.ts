/**
 * Shared tenant helpers for Next.js API routes.
 *
 * - getTenantDB()            — singleton TenantDB instance
 * - getTenantAuth()          — singleton TenantAuth instance
 * - getTenantFromRequest(r)  — extract tenantId from JWT cookie/header
 */

import { NextRequest } from 'next/server';
import { TenantDB } from '../../../services/tenant-db/src/index.js';
import TenantAuth from '../../../services/tenant-auth/src/index.js';

// ---------------------------------------------------------------------------
// Singletons (one per server process)
// ---------------------------------------------------------------------------

let _db: TenantDB | undefined;
let _auth: TenantAuth | undefined;

const MASTER_PASSWORD = process.env.TENANT_VAULT_PASSWORD || 'mtwm-dev-vault-2026';
const AUTH_COOKIE = 'mtwm-auth';

export function getTenantDB(): TenantDB {
  if (!_db) {
    _db = new TenantDB(MASTER_PASSWORD);
  }
  return _db;
}

export function getTenantAuth(): TenantAuth {
  if (!_auth) {
    _auth = new TenantAuth(getTenantDB());
  }
  return _auth;
}

// ---------------------------------------------------------------------------
// Extract tenant from request (cookie or Authorization header)
// ---------------------------------------------------------------------------

export interface TenantInfo {
  tenantId: string;
  email: string;
  tier: string;
}

/**
 * Read JWT from the `mtwm-auth` cookie or the `Authorization: Bearer <token>` header.
 * Returns null if no valid token is found.
 */
export function getTenantFromRequest(request: NextRequest): TenantInfo | null {
  const auth = getTenantAuth();

  // Try cookie first
  const cookieToken = request.cookies.get(AUTH_COOKIE)?.value;
  if (cookieToken) {
    try {
      const payload = auth.verifyToken(cookieToken);
      return { tenantId: payload.tenantId, email: payload.email, tier: payload.tier };
    } catch {
      // Cookie token invalid — fall through to header
    }
  }

  // Try Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = auth.verifyToken(token);
      return { tenantId: payload.tenantId, email: payload.email, tier: payload.tier };
    } catch {
      // Header token invalid
    }
  }

  return null;
}

/**
 * Cookie options matching the login route pattern.
 */
export const AUTH_COOKIE_OPTIONS = {
  name: AUTH_COOKIE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 30, // 30 days
  path: '/',
};

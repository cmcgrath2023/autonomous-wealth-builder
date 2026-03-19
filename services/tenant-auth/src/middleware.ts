import type { Request, Response, NextFunction } from 'express';
import type { TenantAuth, JwtPayload, Tenant } from './index.js';
import type { TenantDB } from '../../tenant-db/src/index.js';

// ---------------------------------------------------------------------------
// Extend Express Request with tenant fields
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      tenantPayload?: JwtPayload;
      tenant?: Tenant;
    }
  }
}

// ---------------------------------------------------------------------------
// canTrade — matches spec trial logic
// ---------------------------------------------------------------------------

function canTrade(tenant: Tenant): boolean {
  if (tenant.tier === 'free') return false;
  if (tenant.subscription_status === 'active') return true;
  if (tenant.trial_ends_at && new Date() < new Date(tenant.trial_ends_at)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Middleware factory — pass in the TenantAuth + TenantDB instances
// ---------------------------------------------------------------------------

export function createTenantMiddleware(auth: TenantAuth, db: TenantDB) {

  /**
   * extractTenant — reads JWT from Authorization header (Bearer) or cookie,
   * verifies it, and sets req.tenantId + req.tenantPayload.
   * Does NOT reject unauthenticated requests (use requireTenant for that).
   */
  function extractTenant(req: Request, _res: Response, next: NextFunction): void {
    let token: string | undefined;

    // 1. Authorization: Bearer <token>
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // 2. Fallback to cookie
    if (!token && req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      next();
      return;
    }

    try {
      const payload = auth.verifyToken(token);
      req.tenantId = payload.tenantId;
      req.tenantPayload = payload;
    } catch {
      // Token invalid or expired — continue without tenant context
    }

    next();
  }

  /**
   * requireTenant — 401 if no valid tenant on the request.
   * Should be used after extractTenant.
   */
  function requireTenant(req: Request, res: Response, next: NextFunction): void {
    if (!req.tenantId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    next();
  }

  /**
   * requireActiveTenant — checks canTrade (active subscription or within trial).
   * 401 if not authenticated, 403 if tenant cannot trade.
   */
  async function requireActiveTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.tenantId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const tenant = await db.getTenant(req.tenantId);
      if (!tenant) {
        res.status(401).json({ error: 'Tenant not found' });
        return;
      }

      if (!canTrade(tenant)) {
        res.status(403).json({ error: 'Subscription inactive — upgrade or start a trial to trade' });
        return;
      }

      req.tenant = tenant;
      next();
    } catch {
      res.status(500).json({ error: 'Failed to verify tenant status' });
    }
  }

  return { extractTenant, requireTenant, requireActiveTenant };
}

export default createTenantMiddleware;

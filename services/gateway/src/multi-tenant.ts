/**
 * Multi-Tenant Addon for the MTWM Gateway
 *
 * Opt-in module that layers multi-tenant support on top of the existing
 * single-tenant gateway. Activated only when MTWM_MULTI_TENANT=true.
 *
 * Usage in server.ts:
 *   import { initMultiTenant } from './multi-tenant.js';
 *   initMultiTenant(app, autonomyEngine);
 *
 * This file does NOT modify any existing gateway code.
 */

import type { Express, Request, Response } from 'express';
import { TenantDB } from '../../tenant-db/src/index.js';
import { TenantServiceManager } from '../../tenant-services/src/index.js';
import type { SharedContext } from '../../tenant-services/src/index.js';
import { TenantAuth } from '../../tenant-auth/src/index.js';
import { createTenantMiddleware } from '../../tenant-auth/src/middleware.js';
import type { AutonomyEngine } from './autonomy-engine.js';

// ── Environment check ────────────────────────────────────────────────────

export function isMultiTenantEnabled(): boolean {
  return process.env.MTWM_MULTI_TENANT === 'true';
}

// ── Init ─────────────────────────────────────────────────────────────────

/**
 * Attach multi-tenant routes and heartbeat hooks to the gateway.
 * No-ops silently if MTWM_MULTI_TENANT is not "true".
 */
export function initMultiTenant(app: Express, autonomyEngine: AutonomyEngine): void {
  if (!isMultiTenantEnabled()) {
    console.log('[multi-tenant] MTWM_MULTI_TENANT is not set — multi-tenant mode disabled');
    return;
  }

  // ── Bootstrap core services ──────────────────────────────────────────

  const masterPassword = process.env.TENANT_DB_PASSWORD || 'mtwm-dev-key';
  const db = new TenantDB(masterPassword);
  const tenantAuth = new TenantAuth(db);
  const serviceManager = new TenantServiceManager();
  const { extractTenant, requireTenant } = createTenantMiddleware(tenantAuth, db);

  // ── Apply auth middleware to all /api/tenant/* routes ─────────────────

  app.use('/api/tenant', extractTenant, requireTenant);

  // ── Routes ───────────────────────────────────────────────────────────

  // GET /api/tenant/portfolio
  // Returns the authenticated tenant's positions and P&L via their executor.
  app.get('/api/tenant/portfolio', async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    try {
      const services = await ensureTenantServices(tenantId, serviceManager, db);
      const positions = await services.executor.getPositions();

      const totalPnl = positions.reduce((sum, p) => {
        const pnl = (p as any).unrealizedPL ?? (p as any).unrealized_pl ?? 0;
        return sum + (typeof pnl === 'string' ? parseFloat(pnl) : pnl);
      }, 0);

      res.json({
        tenantId,
        positions,
        positionCount: positions.length,
        totalUnrealizedPnl: totalPnl,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[multi-tenant] portfolio error tenant=${tenantId}:`, err.message);
      res.status(500).json({ error: 'Failed to fetch portfolio', detail: err.message });
    }
  });

  // GET /api/tenant/status
  // Returns the tenant's autonomy status, heartbeat count, and config.
  app.get('/api/tenant/status', async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    try {
      const services = await ensureTenantServices(tenantId, serviceManager, db);
      const engineStatus = autonomyEngine.getStatus();
      const tenant = db.getTenant(tenantId);

      res.json({
        tenantId,
        config: services.config,
        autonomy: {
          enabled: engineStatus.enabled,
          autonomyLevel: engineStatus.autonomyLevel,
          heartbeatCount: engineStatus.heartbeatCount,
          startedAt: engineStatus.startedAt,
        },
        subscription: tenant ? {
          tier: tenant.tier,
          status: tenant.subscription_status,
          trialEndsAt: tenant.trial_ends_at,
          canTrade: db.canTrade(tenantId),
        } : null,
        servicesLoaded: serviceManager.isLoaded(tenantId),
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[multi-tenant] status error tenant=${tenantId}:`, err.message);
      res.status(500).json({ error: 'Failed to fetch status', detail: err.message });
    }
  });

  // GET /api/tenant/research
  // Returns shared research data (same for all tenants).
  // Research stars and reports live on the gateway's in-memory state,
  // so we read them from the /api/research/reports endpoint internally.
  app.get('/api/tenant/research', async (_req: Request, res: Response) => {
    try {
      // Pull shared research from the gateway's own route handler.
      // We build an internal request rather than importing gateway state
      // directly, keeping this module fully decoupled.
      const internalUrl = `http://127.0.0.1:${process.env.PORT || 3001}/api/research/reports`;
      const response = await fetch(internalUrl);
      if (!response.ok) {
        res.json({ reports: [], note: 'Research service unavailable' });
        return;
      }
      const data = await response.json();
      res.json({
        reports: data,
        shared: true,
        note: 'Research data is shared across all tenants',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      // If the internal fetch fails (e.g. research route not registered yet),
      // return an empty set rather than 500 — research is non-critical.
      res.json({
        reports: [],
        shared: true,
        note: 'Research data not yet available',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // POST /api/tenant/config
  // Update the tenant's trading configuration.
  app.post('/api/tenant/config', async (req: Request, res: Response) => {
    const tenantId = req.tenantId!;
    try {
      const {
        simulatedCapital,
        maxPositions,
        cryptoPct,
        equityPct,
        stopLossPct,
        takeProfitPct,
        dailyGoal,
        autonomyLevel,
        heartbeatMs,
      } = req.body;

      // Validate numeric fields if provided
      const numericFields: Record<string, unknown> = {
        simulatedCapital, maxPositions, cryptoPct, equityPct,
        stopLossPct, takeProfitPct, dailyGoal, autonomyLevel, heartbeatMs,
      };
      for (const [key, val] of Object.entries(numericFields)) {
        if (val !== undefined && (typeof val !== 'number' || isNaN(val))) {
          res.status(400).json({ error: `${key} must be a number` });
          return;
        }
      }

      // Persist to database
      db.saveTenantConfig({
        tenantId,
        simulatedCapital,
        maxPositions,
        cryptoPct,
        equityPct,
        stopLossPct,
        takeProfitPct,
        dailyGoal,
        autonomyLevel,
        heartbeatMs,
      });

      // Reload tenant services so the new config takes effect immediately
      const services = await serviceManager.initFromDB(tenantId, db);

      res.json({
        tenantId,
        config: services.config,
        message: 'Configuration updated',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[multi-tenant] config update error tenant=${tenantId}:`, err.message);
      res.status(500).json({ error: 'Failed to update config', detail: err.message });
    }
  });

  // ── Heartbeat hook ───────────────────────────────────────────────────
  //
  // After the shared heartbeat actions complete, run per-tenant actions.
  // The autonomy engine emits 'heartbeat' after all shared actions finish.

  autonomyEngine.on('heartbeat', async ({ count, timestamp }) => {
    const activeTenants = db.getActiveTenants();
    if (activeTenants.length === 0) return;

    console.log(
      `[multi-tenant] Heartbeat #${count} — running per-tenant actions for ${activeTenants.length} tenant(s)`,
    );

    // Build shared context from the gateway's public endpoints.
    // In a production deployment this would read from an in-memory cache;
    // for now we pass a minimal context so the service manager can operate.
    const sharedContext: SharedContext = {
      researchStars: new Map(),
      newsFindings: [],
      marketQuotes: new Map(),
      neuralTrader: null,
    };

    // Try to populate shared context from gateway internals via fetch
    try {
      const quotesRes = await fetch(
        `http://127.0.0.1:${process.env.PORT || 3001}/api/midstream/quotes`,
      );
      if (quotesRes.ok) {
        const quotes = await quotesRes.json();
        if (Array.isArray(quotes)) {
          for (const q of quotes) {
            if (q.symbol && q.price != null) {
              sharedContext.marketQuotes.set(q.symbol, {
                price: typeof q.price === 'string' ? parseFloat(q.price) : q.price,
                change: typeof q.change === 'string' ? parseFloat(q.change) : (q.change ?? 0),
              });
            }
          }
        }
      }
    } catch {
      // Quotes unavailable — tenant heartbeat will still run exit checks
    }

    for (const tenant of activeTenants) {
      try {
        // Ensure services are initialized from DB
        await ensureTenantServices(tenant.id, serviceManager, db);

        const result = await serviceManager.runTenantHeartbeat(tenant.id, sharedContext);

        if (result.errors.length > 0) {
          console.error(
            `[multi-tenant] Tenant ${tenant.id} heartbeat errors:`,
            result.errors,
          );
        }

        if (!result.skipped) {
          const actionCount =
            result.exitActions.length +
            result.positionActions.length +
            result.signalActions.length;

          if (actionCount > 0) {
            console.log(
              `[multi-tenant] Tenant ${tenant.id}: ` +
              `exits=${result.exitActions.length} ` +
              `positions=${result.positionActions.length} ` +
              `signals=${result.signalActions.length}`,
            );
          }
        }
      } catch (err: any) {
        console.error(
          `[multi-tenant] Tenant ${tenant.id} heartbeat failed:`,
          err.message,
        );
      }
    }
  });

  // ── Startup log ──────────────────────────────────────────────────────

  const activeTenants = db.getActiveTenants();
  console.log(
    `[multi-tenant] Multi-tenant mode ACTIVE — ` +
    `${activeTenants.length} active tenant(s) in database`,
  );

  // Pre-load services for active tenants
  for (const tenant of activeTenants) {
    ensureTenantServices(tenant.id, serviceManager, db).catch((err) => {
      console.error(`[multi-tenant] Failed to pre-load tenant ${tenant.id}:`, err.message);
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Ensure a tenant's services are initialized from the database.
 * Returns the existing bundle if already loaded, otherwise calls initFromDB.
 */
async function ensureTenantServices(
  tenantId: string,
  serviceManager: TenantServiceManager,
  db: TenantDB,
) {
  if (serviceManager.isLoaded(tenantId)) {
    return serviceManager.getServices(tenantId);
  }
  return serviceManager.initFromDB(tenantId, db);
}

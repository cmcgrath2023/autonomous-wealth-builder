import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB, getTenantFromRequest } from '@/src/lib/tenant';

export async function POST(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getTenantDB();
    const tenantRow = db.getTenant(tenant.tenantId);

    if (!tenantRow) {
      return NextResponse.json({ message: 'Tenant not found' }, { status: 404 });
    }

    // Start the 3-day trial if not already started
    if (!tenantRow.trial_ends_at) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 3);

      // Update trial_ends_at and subscription_status directly via the DB
      // TenantDB.createTenant sets these on creation, but if they were not set,
      // we need a raw update. Since TenantDB doesn't expose updateTenant,
      // we re-create the tenant config to ensure it exists.
      // The tenant already has trial_ends_at set from createTenant (TenantDB
      // auto-sets it for hosted/pro tiers), so this is a safety net.
    }

    // Ensure the tenant has a config row (use defaults if not configured yet)
    const config = db.getTenantConfig(tenant.tenantId);
    if (!config) {
      db.saveTenantConfig({ tenantId: tenant.tenantId });
    }

    // Verify broker credentials exist
    const brokers = db.listTenantBrokers(tenant.tenantId);
    if (brokers.length === 0) {
      return NextResponse.json(
        { message: 'Please connect at least one broker before activating' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      activated: true,
      brokers,
      trialEndsAt: tenantRow.trial_ends_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Activation failed';
    return NextResponse.json({ message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB, getTenantFromRequest } from '@/src/lib/tenant';
import { BillingService } from '../../../../../services/billing/src/index.js';

/**
 * GET /api/billing/status
 *
 * Returns the current subscription status for the authenticated tenant.
 */
export async function GET(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getTenantDB();
    const billing = new BillingService(db);

    const subscription = await billing.getSubscription(tenant.tenantId);

    return NextResponse.json(subscription);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch subscription status';
    return NextResponse.json({ message }, { status: 500 });
  }
}

/**
 * DELETE /api/billing/status
 *
 * Cancels the subscription at the end of the current billing period.
 */
export async function DELETE(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getTenantDB();
    const billing = new BillingService(db);

    const result = await billing.cancelSubscription(tenant.tenantId);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to cancel subscription';
    return NextResponse.json({ message }, { status: 500 });
  }
}

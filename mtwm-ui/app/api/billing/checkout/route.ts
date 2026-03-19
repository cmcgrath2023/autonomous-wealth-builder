import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB, getTenantFromRequest } from '@/src/lib/tenant';
import { BillingService } from '../../../../../services/billing/src/index.js';
import type { BillingTier } from '../../../../../services/billing/src/index.js';

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout session for the authenticated tenant.
 * Body: { tier: 'hosted' | 'pro' }
 * Returns: { url: string, sessionId: string }
 */
export async function POST(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const tier = body.tier as BillingTier;

    if (!tier || !['hosted', 'pro'].includes(tier)) {
      return NextResponse.json(
        { message: 'Invalid tier. Must be "hosted" or "pro".' },
        { status: 400 },
      );
    }

    const db = getTenantDB();
    const billing = new BillingService(db);

    const result = await billing.createCheckoutSession(
      tenant.tenantId,
      tenant.email,
      tier,
    );

    return NextResponse.json({
      url: result.url,
      sessionId: result.sessionId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create checkout session';
    return NextResponse.json({ message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB } from '@/src/lib/tenant';
import { BillingService } from '../../../../../services/billing/src/index.js';

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook endpoint. Requires raw body for signature verification.
 * Processes: checkout.session.completed, invoice.paid,
 *            invoice.payment_failed, customer.subscription.deleted
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { message: 'Missing stripe-signature header' },
      { status: 400 },
    );
  }

  try {
    // Read raw body for Stripe signature verification
    const rawBody = await request.text();

    const db = getTenantDB();
    const billing = new BillingService(db);

    const result = await billing.handleWebhook(rawBody, signature);

    return NextResponse.json({
      received: true,
      handled: result.handled,
      event: result.event,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook processing failed';
    console.error('[billing/webhook] Error:', message);
    return NextResponse.json({ message }, { status: 400 });
  }
}

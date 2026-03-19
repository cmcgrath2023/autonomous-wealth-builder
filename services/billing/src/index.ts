/**
 * BillingService — Stripe billing integration for multi-tenant subscriptions.
 *
 * Handles checkout sessions, webhook processing, subscription queries,
 * and cancellations. Updates TenantDB subscription_status based on
 * Stripe webhook events.
 */

import Stripe from 'stripe';
import type { TenantDB } from '../../tenant-db/src/index.js';

// ── Types ──────────────────────────────────────────────────────────────

export type BillingTier = 'hosted' | 'pro';

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

export interface SubscriptionInfo {
  tenantId: string;
  tier: string;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
}

export interface WebhookResult {
  handled: boolean;
  event: string;
  tenantId?: string;
}

// ── Price map ──────────────────────────────────────────────────────────

const TIER_PRICES: Record<BillingTier, { monthly: number }> = {
  hosted: { monthly: 2900 }, // $29/mo in cents
  pro: { monthly: 9900 },    // $99/mo in cents
};

// ── BillingService ─────────────────────────────────────────────────────

export class BillingService {
  private stripe: Stripe;
  private db: TenantDB;
  private webhookSecret: string;
  private hostedPriceId: string;
  private proPriceId: string;

  constructor(db: TenantDB) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }

    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    this.hostedPriceId = process.env.STRIPE_HOSTED_PRICE_ID || '';
    this.proPriceId = process.env.STRIPE_PRO_PRICE_ID || '';
    this.db = db;

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia',
    });
  }

  // ── Checkout ────────────────────────────────────────────────────────

  /**
   * Create a Stripe Checkout session for a subscription.
   *
   * @param tenantId  The tenant initiating the checkout
   * @param email     Tenant's email (pre-fills Checkout)
   * @param tier      'hosted' ($29/mo) or 'pro' ($99/mo)
   * @returns         Session ID and redirect URL
   */
  async createCheckoutSession(
    tenantId: string,
    email: string,
    tier: BillingTier,
  ): Promise<CheckoutResult> {
    const priceId = tier === 'pro' ? this.proPriceId : this.hostedPriceId;

    if (!priceId) {
      throw new Error(`No Stripe price ID configured for tier: ${tier}`);
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        tenantId,
        tier,
      },
      subscription_data: {
        metadata: {
          tenantId,
          tier,
        },
        trial_period_days: 3,
      },
      success_url: `${baseUrl}/billing?session_id={CHECKOUT_SESSION_ID}&status=success`,
      cancel_url: `${baseUrl}/billing?status=canceled`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  // ── Webhooks ────────────────────────────────────────────────────────

  /**
   * Verify and process a Stripe webhook event.
   *
   * Handles:
   *   - checkout.session.completed  -> activate subscription
   *   - invoice.paid               -> confirm active
   *   - invoice.payment_failed     -> mark past_due
   *   - customer.subscription.deleted -> mark canceled
   */
  async handleWebhook(
    payload: string | Buffer,
    signature: string,
  ): Promise<WebhookResult> {
    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid signature';
      throw new Error(`Webhook signature verification failed: ${message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event);

      case 'invoice.paid':
        return this.handleInvoicePaid(event);

      case 'invoice.payment_failed':
        return this.handleInvoicePaymentFailed(event);

      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event);

      default:
        return { handled: false, event: event.type };
    }
  }

  private async handleCheckoutCompleted(
    event: Stripe.Event,
  ): Promise<WebhookResult> {
    const session = event.data.object as Stripe.Checkout.Session;
    const tenantId = session.metadata?.tenantId;
    const tier = (session.metadata?.tier as BillingTier) || 'hosted';

    if (!tenantId) {
      return { handled: false, event: event.type };
    }

    // Retrieve subscription details
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

    // Update tenant in DB
    this.db.updateTenant(tenantId, {
      tier: tier as 'hosted' | 'pro',
      subscription_status: 'active',
    });

    // Store Stripe IDs in metadata for later lookups
    // The tenant table doesn't have stripe columns, so we store via
    // a convention: use the reports table as a lightweight KV store
    if (subscriptionId) {
      this.db.saveReport({
        tenantId,
        agent: 'billing',
        type: 'stripe_metadata',
        summary: JSON.stringify({
          stripeCustomerId: customerId || null,
          stripeSubscriptionId: subscriptionId,
          tier,
          activatedAt: new Date().toISOString(),
        }),
      });
    }

    return { handled: true, event: event.type, tenantId };
  }

  private async handleInvoicePaid(
    event: Stripe.Event,
  ): Promise<WebhookResult> {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    if (!subscriptionId) {
      return { handled: false, event: event.type };
    }

    // Look up tenant from subscription metadata
    const tenantId = await this.getTenantIdFromSubscription(subscriptionId);
    if (!tenantId) {
      return { handled: false, event: event.type };
    }

    this.db.updateTenant(tenantId, {
      subscription_status: 'active',
    });

    return { handled: true, event: event.type, tenantId };
  }

  private async handleInvoicePaymentFailed(
    event: Stripe.Event,
  ): Promise<WebhookResult> {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    if (!subscriptionId) {
      return { handled: false, event: event.type };
    }

    const tenantId = await this.getTenantIdFromSubscription(subscriptionId);
    if (!tenantId) {
      return { handled: false, event: event.type };
    }

    this.db.updateTenant(tenantId, {
      subscription_status: 'past_due',
    });

    return { handled: true, event: event.type, tenantId };
  }

  private async handleSubscriptionDeleted(
    event: Stripe.Event,
  ): Promise<WebhookResult> {
    const subscription = event.data.object as Stripe.Subscription;
    const tenantId = subscription.metadata?.tenantId;

    if (!tenantId) {
      return { handled: false, event: event.type };
    }

    this.db.updateTenant(tenantId, {
      subscription_status: 'canceled',
    });

    return { handled: true, event: event.type, tenantId };
  }

  // ── Subscription queries ────────────────────────────────────────────

  /**
   * Get current subscription status for a tenant.
   */
  async getSubscription(tenantId: string): Promise<SubscriptionInfo> {
    const tenant = this.db.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    // Retrieve stored Stripe metadata from reports
    const stripeData = this.getStripeMetadata(tenantId);

    let currentPeriodEnd: string | null = null;
    let cancelAtPeriodEnd = false;

    // If we have a Stripe subscription ID, fetch live details
    if (stripeData?.stripeSubscriptionId) {
      try {
        const sub = await this.stripe.subscriptions.retrieve(
          stripeData.stripeSubscriptionId,
        );
        currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
        cancelAtPeriodEnd = sub.cancel_at_period_end;
      } catch {
        // Subscription may have been deleted in Stripe
      }
    }

    return {
      tenantId: tenant.id,
      tier: tenant.tier,
      status: tenant.subscription_status,
      stripeSubscriptionId: stripeData?.stripeSubscriptionId || null,
      stripeCustomerId: stripeData?.stripeCustomerId || null,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      trialEndsAt: tenant.trial_ends_at,
    };
  }

  // ── Cancel ──────────────────────────────────────────────────────────

  /**
   * Cancel a subscription at the end of the current billing period.
   * Does not immediately revoke access.
   */
  async cancelSubscription(tenantId: string): Promise<{ canceled: boolean }> {
    const stripeData = this.getStripeMetadata(tenantId);

    if (!stripeData?.stripeSubscriptionId) {
      throw new Error('No active Stripe subscription found for this tenant');
    }

    await this.stripe.subscriptions.update(
      stripeData.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    return { canceled: true };
  }

  // ── Internal helpers ────────────────────────────────────────────────

  /**
   * Look up tenantId from a Stripe subscription's metadata.
   */
  private async getTenantIdFromSubscription(
    subscriptionId: string,
  ): Promise<string | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
      return sub.metadata?.tenantId || null;
    } catch {
      return null;
    }
  }

  /**
   * Retrieve stored Stripe metadata from the reports table.
   * We use the most recent stripe_metadata report for this tenant.
   */
  private getStripeMetadata(
    tenantId: string,
  ): { stripeCustomerId: string; stripeSubscriptionId: string; tier: string } | null {
    const reports = this.db.getReports(tenantId, {
      agent: 'billing',
      limit: 10,
    });

    const metaReport = reports.find((r) => r.type === 'stripe_metadata');
    if (!metaReport) return null;

    try {
      return JSON.parse(metaReport.summary);
    } catch {
      return null;
    }
  }
}

export default BillingService;

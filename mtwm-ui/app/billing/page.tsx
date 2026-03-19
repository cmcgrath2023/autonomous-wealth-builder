'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, Button, Chip } from '@heroui/react';

interface SubscriptionInfo {
  tenantId: string;
  tier: string;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#4ade80',
  trialing: '#facc15',
  past_due: '#f87171',
  canceled: '#666',
  none: '#666',
};

const TIER_LABELS: Record<string, string> = {
  free: 'Free (Self-Hosted)',
  hosted: 'Hosted',
  pro: 'Pro',
};

export default function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadSubscription = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/status');
      if (res.ok) {
        const data = await res.json();
        setSubscription(data);
      }
    } catch {
      // Will show default state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  // Check for return from Stripe Checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    if (status === 'success') {
      setMessage('Subscription activated successfully.');
      // Reload to get fresh status
      loadSubscription();
      // Clean URL
      window.history.replaceState({}, '', '/billing');
    } else if (status === 'canceled') {
      setMessage('Checkout was canceled.');
      window.history.replaceState({}, '', '/billing');
    }
  }, [loadSubscription]);

  async function handleUpgrade(tier: 'hosted' | 'pro') {
    setCheckoutLoading(tier);
    setMessage('');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setMessage(data.message || 'Failed to start checkout');
      }
    } catch {
      setMessage('Network error. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel your subscription? You will retain access until the end of your current billing period.')) {
      return;
    }
    setCancelLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/billing/status', { method: 'DELETE' });
      if (res.ok) {
        setMessage('Subscription will cancel at the end of the billing period.');
        loadSubscription();
      } else {
        const data = await res.json();
        setMessage(data.message || 'Failed to cancel subscription');
      }
    } catch {
      setMessage('Network error. Please try again.');
    } finally {
      setCancelLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#666',
        fontSize: '14px',
      }}>
        Loading billing...
      </div>
    );
  }

  const tier = subscription?.tier || 'free';
  const status = subscription?.status || 'none';
  const isActive = status === 'active';
  const isTrialing = status === 'trialing';
  const isCanceling = subscription?.cancelAtPeriodEnd || false;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      fontFamily: '-apple-system, system-ui, sans-serif',
      padding: '32px',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <h1 style={{ color: '#60a5fa', fontSize: '20px', marginBottom: '4px' }}>Billing</h1>
        <p style={{ color: '#666', fontSize: '13px', marginBottom: '28px' }}>
          Manage your subscription, upgrade your plan, or view billing details.
        </p>

        {message && (
          <div style={{
            padding: '12px 16px',
            background: message.includes('success') || message.includes('activated')
              ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
            border: `1px solid ${message.includes('success') || message.includes('activated') ? '#4ade80' : '#f87171'}`,
            borderRadius: '8px',
            color: message.includes('success') || message.includes('activated') ? '#4ade80' : '#f87171',
            fontSize: '13px',
            marginBottom: '16px',
          }}>
            {message}
          </div>
        )}

        {/* Current Plan */}
        <Card style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', marginBottom: '16px' }}>
          <CardBody style={{ padding: '24px' }}>
            <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
              Current Plan
            </h2>

            <div style={{
              background: '#1a1a1a',
              border: '1px solid #222',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#888', fontSize: '13px' }}>Plan</span>
                <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
                  {TIER_LABELS[tier] || tier}
                  {tier === 'hosted' && ' ($29/mo)'}
                  {tier === 'pro' && ' ($99/mo)'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#888', fontSize: '13px' }}>Status</span>
                <Chip
                  size="sm"
                  variant="flat"
                  style={{
                    background: `${STATUS_COLORS[status]}20`,
                    color: STATUS_COLORS[status],
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  {isCanceling ? 'Canceling' : status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                </Chip>
              </div>

              {subscription?.trialEndsAt && isTrialing && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#888', fontSize: '13px' }}>Trial Ends</span>
                  <span style={{ color: '#facc15', fontSize: '13px' }}>
                    {new Date(subscription.trialEndsAt).toLocaleDateString()}
                  </span>
                </div>
              )}

              {subscription?.currentPeriodEnd && (isActive || isCanceling) && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#888', fontSize: '13px' }}>
                    {isCanceling ? 'Access Until' : 'Next Billing'}
                  </span>
                  <span style={{ color: isCanceling ? '#f87171' : '#999', fontSize: '13px' }}>
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            {/* Cancellation action */}
            {(isActive || isTrialing) && !isCanceling && (
              <div style={{ marginTop: '12px' }}>
                <Button
                  variant="light"
                  size="sm"
                  isLoading={cancelLoading}
                  onPress={handleCancel}
                  style={{
                    color: '#666',
                    fontSize: '12px',
                  }}
                >
                  Cancel Subscription
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Upgrade Options */}
        <Card style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', marginBottom: '16px' }}>
          <CardBody style={{ padding: '24px' }}>
            <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
              Plans
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Hosted Plan */}
              <PlanCard
                name="Hosted"
                price="$29"
                period="/mo"
                description="Multi-tenant SaaS with in-app guidance and self-healing. 3-day free trial."
                features={[
                  'Autonomous trading engine',
                  'Bayesian intelligence',
                  'News desk and research',
                  'Real-time position management',
                ]}
                isCurrent={tier === 'hosted'}
                isActive={tier === 'hosted' && (isActive || isTrialing)}
                loading={checkoutLoading === 'hosted'}
                onUpgrade={() => handleUpgrade('hosted')}
              />

              {/* Pro Plan */}
              <PlanCard
                name="Pro"
                price="$99"
                period="/mo"
                description="Isolated container with dedicated instance, custom config, and SLA."
                features={[
                  'Everything in Hosted',
                  'Dedicated compute instance',
                  'Custom strategy configuration',
                  'Priority support and SLA',
                ]}
                isCurrent={tier === 'pro'}
                isActive={tier === 'pro' && (isActive || isTrialing)}
                loading={checkoutLoading === 'pro'}
                onUpgrade={() => handleUpgrade('pro')}
                highlight
              />
            </div>
          </CardBody>
        </Card>

        {/* Invoice History Placeholder */}
        <Card style={{ background: '#111', border: '1px solid #222', borderRadius: '12px' }}>
          <CardBody style={{ padding: '24px' }}>
            <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
              Invoice History
            </h2>

            <div style={{
              background: '#1a1a1a',
              border: '1px solid #222',
              borderRadius: '8px',
              padding: '24px',
              textAlign: 'center',
            }}>
              <p style={{ color: '#555', fontSize: '13px' }}>
                Invoice history will appear here once billing is active.
              </p>
              {subscription?.stripeCustomerId && (
                <p style={{ color: '#444', fontSize: '12px', marginTop: '8px' }}>
                  Invoices are managed through Stripe.
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Back link */}
        <a
          href="/settings"
          style={{
            display: 'inline-block',
            marginTop: '16px',
            color: '#60a5fa',
            fontSize: '13px',
            textDecoration: 'none',
          }}
        >
          &larr; Back to Settings
        </a>
      </div>
    </div>
  );
}

function PlanCard({
  name,
  price,
  period,
  description,
  features,
  isCurrent,
  isActive,
  loading,
  onUpgrade,
  highlight,
}: {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  isCurrent: boolean;
  isActive: boolean;
  loading: boolean;
  onUpgrade: () => void;
  highlight?: boolean;
}) {
  return (
    <div style={{
      padding: '20px',
      background: '#1a1a1a',
      border: `1px solid ${highlight ? '#2563eb' : '#222'}`,
      borderRadius: '10px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div>
          <span style={{ color: '#fff', fontSize: '15px', fontWeight: 600 }}>{name}</span>
          {isCurrent && (
            <Chip
              size="sm"
              variant="flat"
              style={{
                marginLeft: '8px',
                background: 'rgba(96, 165, 250, 0.15)',
                color: '#60a5fa',
                fontSize: '11px',
              }}
            >
              Current
            </Chip>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ color: '#fff', fontSize: '22px', fontWeight: 700 }}>{price}</span>
          <span style={{ color: '#666', fontSize: '13px' }}>{period}</span>
        </div>
      </div>

      <p style={{ color: '#888', fontSize: '12px', marginBottom: '12px', lineHeight: '1.5' }}>
        {description}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
        {features.map((feature) => (
          <li key={feature} style={{
            color: '#999',
            fontSize: '12px',
            padding: '3px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{ color: '#4ade80', fontSize: '10px' }}>&#10003;</span>
            {feature}
          </li>
        ))}
      </ul>

      {isActive ? (
        <Button
          isDisabled
          variant="bordered"
          size="sm"
          style={{
            borderColor: '#333',
            color: '#555',
            fontSize: '13px',
            width: '100%',
          }}
        >
          Current Plan
        </Button>
      ) : (
        <Button
          isLoading={loading}
          onPress={onUpgrade}
          size="sm"
          style={{
            background: highlight ? '#2563eb' : '#1e3a5f',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 600,
            width: '100%',
          }}
        >
          {isCurrent ? 'Reactivate' : `Upgrade to ${name}`}
        </Button>
      )}
    </div>
  );
}

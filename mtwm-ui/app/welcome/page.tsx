'use client';

const features = [
  {
    icon: '₿',
    title: '24/7 Crypto Trading',
    description:
      'Autonomous crypto execution powered by Bayesian intelligence. Scans markets around the clock, enters and exits positions based on real-time signals.',
  },
  {
    icon: '⇄',
    title: 'Forex Automation',
    description:
      'Session-aware forex trading across major and minor pairs. Automatic take-profit, stop-loss management, and position sizing.',
  },
  {
    icon: '⊙',
    title: 'AI Research & Intelligence',
    description:
      'Neural trader models, news-desk scanning, and deep research agents that continuously learn and adapt to market conditions.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Self-hosted, open source',
    cta: 'Self-Host on GitHub',
    ctaHref: 'https://github.com/mcgrath-trust/mtwm',
    ctaStyle: 'outline' as const,
    features: [
      'Full source code access',
      'Run on your own hardware',
      'All trading agents included',
      'Community support (Discord)',
      'Unlimited paper trading',
    ],
  },
  {
    name: 'Hosted',
    price: '$29',
    period: '/mo',
    description: '3-day free trial',
    cta: 'Start Free Trial',
    ctaHref: '/signup',
    ctaStyle: 'solid' as const,
    highlight: true,
    features: [
      'Managed cloud infrastructure',
      'No server setup required',
      'Automatic updates & patches',
      'In-app guidance & self-healing',
      'Encrypted credential vault',
      'Priority market data feeds',
    ],
  },
  {
    name: 'Pro',
    price: '$99',
    period: '/mo',
    description: 'Coming soon',
    cta: 'Join Waitlist',
    ctaHref: '/signup',
    ctaStyle: 'outline' as const,
    features: [
      'Dedicated isolated instance',
      'Custom strategy configuration',
      'Priority support & SLA',
      'Advanced neural model tuning',
      'API access for integrations',
      'White-glove onboarding',
    ],
  },
];

export default function WelcomePage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#fff',
        fontFamily: '-apple-system, system-ui, sans-serif',
      }}
    >
      {/* Nav */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 40px',
          maxWidth: '1200px',
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#60a5fa', fontSize: '22px', fontWeight: 700 }}>MTWM</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <a
            href="/login"
            style={{
              color: '#999',
              textDecoration: 'none',
              fontSize: '14px',
            }}
          >
            Sign In
          </a>
          <a
            href="/signup"
            style={{
              background: '#2563eb',
              color: '#fff',
              padding: '8px 20px',
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            Start Free Trial
          </a>
        </div>
      </header>

      {/* Hero */}
      <section
        style={{
          textAlign: 'center',
          padding: '80px 24px 60px',
          maxWidth: '800px',
          margin: '0 auto',
        }}
      >
        <h1
          style={{
            fontSize: '48px',
            fontWeight: 700,
            lineHeight: 1.1,
            marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}
        >
          <span style={{ color: '#60a5fa' }}>MTWM</span> — Autonomous{' '}
          <br />
          Wealth Engine
        </h1>
        <p
          style={{
            fontSize: '18px',
            color: '#888',
            maxWidth: '560px',
            margin: '0 auto 40px',
            lineHeight: 1.6,
          }}
        >
          AI-powered trading that runs 24/7. Crypto, forex, and equities managed
          by autonomous agents with Bayesian intelligence and neural models.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="/signup"
            style={{
              background: '#2563eb',
              color: '#fff',
              padding: '14px 32px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 600,
            }}
          >
            Start Free Trial
          </a>
          <a
            href="https://github.com/mcgrath-trust/mtwm"
            style={{
              background: 'transparent',
              color: '#ccc',
              padding: '14px 32px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              border: '1px solid #333',
            }}
          >
            Self-Host (Open Source)
          </a>
        </div>
      </section>

      {/* Features */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '24px',
          maxWidth: '1000px',
          margin: '0 auto',
          padding: '40px 24px 80px',
        }}
      >
        {features.map((f) => (
          <div
            key={f.title}
            style={{
              background: '#111',
              border: '1px solid #1a1a1a',
              borderRadius: '12px',
              padding: '28px',
            }}
          >
            <div
              style={{
                fontSize: '28px',
                marginBottom: '12px',
              }}
            >
              {f.icon}
            </div>
            <h3
              style={{
                fontSize: '17px',
                fontWeight: 600,
                marginBottom: '8px',
                color: '#e5e5e5',
              }}
            >
              {f.title}
            </h3>
            <p style={{ fontSize: '14px', color: '#777', lineHeight: 1.6 }}>
              {f.description}
            </p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section
        style={{
          maxWidth: '1100px',
          margin: '0 auto',
          padding: '0 24px 100px',
        }}
      >
        <h2
          style={{
            textAlign: 'center',
            fontSize: '32px',
            fontWeight: 700,
            marginBottom: '12px',
          }}
        >
          Pricing
        </h2>
        <p
          style={{
            textAlign: 'center',
            color: '#777',
            fontSize: '15px',
            marginBottom: '48px',
          }}
        >
          Start free, upgrade when you need managed infrastructure.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '24px',
          }}
        >
          {plans.map((plan) => (
            <div
              key={plan.name}
              style={{
                background: '#111',
                border: plan.highlight ? '1px solid #2563eb' : '1px solid #1a1a1a',
                borderRadius: '12px',
                padding: '32px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {plan.highlight && (
                <div
                  style={{
                    color: '#60a5fa',
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '8px',
                  }}
                >
                  Most Popular
                </div>
              )}
              <h3
                style={{
                  fontSize: '20px',
                  fontWeight: 600,
                  marginBottom: '4px',
                  color: '#e5e5e5',
                }}
              >
                {plan.name}
              </h3>
              <div style={{ marginBottom: '4px' }}>
                <span style={{ fontSize: '36px', fontWeight: 700 }}>{plan.price}</span>
                <span style={{ fontSize: '14px', color: '#777' }}>{plan.period}</span>
              </div>
              <p
                style={{
                  fontSize: '13px',
                  color: '#666',
                  marginBottom: '24px',
                }}
              >
                {plan.description}
              </p>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 28px',
                  flex: 1,
                }}
              >
                {plan.features.map((feat) => (
                  <li
                    key={feat}
                    style={{
                      fontSize: '14px',
                      color: '#aaa',
                      padding: '6px 0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span style={{ color: '#2563eb', fontSize: '12px' }}>&#10003;</span>
                    {feat}
                  </li>
                ))}
              </ul>
              <a
                href={plan.ctaHref}
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '12px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: 600,
                  background: plan.ctaStyle === 'solid' ? '#2563eb' : 'transparent',
                  color: plan.ctaStyle === 'solid' ? '#fff' : '#ccc',
                  border: plan.ctaStyle === 'solid' ? 'none' : '1px solid #333',
                }}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid #1a1a1a',
          padding: '32px 24px',
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <span style={{ color: '#444', fontSize: '13px' }}>
          MTWM — McGrath Trust Wealth Management
        </span>
        <div style={{ display: 'flex', gap: '20px' }}>
          <a href="/login" style={{ color: '#555', fontSize: '13px', textDecoration: 'none' }}>
            Sign In
          </a>
          <a href="/signup" style={{ color: '#555', fontSize: '13px', textDecoration: 'none' }}>
            Sign Up
          </a>
          <a
            href="https://github.com/mcgrath-trust/mtwm"
            style={{ color: '#555', fontSize: '13px', textDecoration: 'none' }}
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

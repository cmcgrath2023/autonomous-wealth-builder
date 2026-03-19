'use client';

import { Button, Card, CardBody, Chip, Divider } from '@heroui/react';
import Link from 'next/link';

const features = [
  {
    icon: '\u20BF',
    title: '24/7 Crypto Trading',
    description:
      'Autonomous crypto execution powered by Bayesian intelligence. Scans markets around the clock, enters and exits positions based on real-time signals.',
  },
  {
    icon: '\u21C4',
    title: 'Forex Automation',
    description:
      'Session-aware forex trading across major and minor pairs. Automatic take-profit, stop-loss management, and position sizing.',
  },
  {
    icon: '\u2299',
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
    variant: 'bordered' as const,
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
    variant: 'solid' as const,
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
    variant: 'bordered' as const,
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
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 lg:px-10 py-5 max-w-[1200px] mx-auto">
        <span className="text-blue-400 text-xl font-bold tracking-tight">MTWM</span>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-white/40 hover:text-white/70 transition-colors">
            Sign In
          </Link>
          <Button as={Link} href="/signup" color="primary" size="sm" radius="md">
            Start Free Trial
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="text-center px-6 pt-20 pb-16 max-w-[800px] mx-auto">
        <h1 className="text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight mb-4">
          <span className="text-blue-400">MTWM</span> — Autonomous
          <br />
          Wealth Engine
        </h1>
        <p className="text-lg text-white/40 max-w-[560px] mx-auto mb-10 leading-relaxed">
          AI-powered trading that runs 24/7. Crypto, forex, and equities managed
          by autonomous agents with Bayesian intelligence and neural models.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button as={Link} href="/signup" color="primary" size="lg" radius="md" className="font-semibold px-8">
            Start Free Trial
          </Button>
          <Button as={Link} href="https://github.com/mcgrath-trust/mtwm" variant="bordered" size="lg" radius="md" className="font-medium px-8 text-white/60 border-white/10">
            Self-Host (Open Source)
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-[1000px] mx-auto px-6 pb-20">
        {features.map((f) => (
          <Card key={f.title} className="bg-white/5 border border-white/5">
            <CardBody className="p-7">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="text-base font-semibold text-white/90 mb-2">{f.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{f.description}</p>
            </CardBody>
          </Card>
        ))}
      </section>

      <Divider className="max-w-[1100px] mx-auto bg-white/5" />

      {/* Pricing */}
      <section className="max-w-[1100px] mx-auto px-6 pt-16 pb-24">
        <h2 className="text-center text-3xl font-bold mb-3">Pricing</h2>
        <p className="text-center text-white/40 text-sm mb-12">
          Start free, upgrade when you need managed infrastructure.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`bg-white/5 ${plan.highlight ? 'border-blue-500/50 border-2' : 'border border-white/5'}`}
            >
              <CardBody className="p-8 flex flex-col">
                {plan.highlight && (
                  <Chip size="sm" color="primary" variant="flat" className="mb-2 self-start">
                    Most Popular
                  </Chip>
                )}
                <h3 className="text-xl font-semibold text-white/90 mb-1">{plan.name}</h3>
                <div className="mb-1">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-sm text-white/40">{plan.period}</span>
                </div>
                <p className="text-xs text-white/30 mb-6">{plan.description}</p>
                <ul className="space-y-2 flex-1 mb-7">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-center gap-2 text-sm text-white/50">
                      <span className="text-blue-500 text-xs">{'\u2713'}</span>
                      {feat}
                    </li>
                  ))}
                </ul>
                <Button
                  as={Link}
                  href={plan.ctaHref}
                  color={plan.variant === 'solid' ? 'primary' : 'default'}
                  variant={plan.variant === 'solid' ? 'solid' : 'bordered'}
                  fullWidth
                  radius="md"
                  className={plan.variant !== 'solid' ? 'text-white/60 border-white/10' : 'font-semibold'}
                >
                  {plan.cta}
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer */}
      <Divider className="max-w-[1200px] mx-auto bg-white/5" />
      <footer className="max-w-[1200px] mx-auto px-6 py-8 flex justify-between items-center flex-wrap gap-4">
        <span className="text-xs text-white/20">MTWM — McGrath Trust Wealth Management</span>
        <div className="flex gap-5">
          <Link href="/login" className="text-xs text-white/25 hover:text-white/50 transition-colors">Sign In</Link>
          <Link href="/signup" className="text-xs text-white/25 hover:text-white/50 transition-colors">Sign Up</Link>
          <a href="https://github.com/mcgrath-trust/mtwm" className="text-xs text-white/25 hover:text-white/50 transition-colors">GitHub</a>
        </div>
      </footer>
    </div>
  );
}

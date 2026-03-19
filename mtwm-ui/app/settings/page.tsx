'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, Button, Input, Slider } from '@heroui/react';

type RiskLevel = 'conservative' | 'moderate' | 'aggressive';

interface BrokerConnection {
  broker: string;
  connected: boolean;
  maskedKey: string;
  mode?: string;
  accountId?: string;
}

interface StrategyConfig {
  capital: number;
  dailyGoal: number;
  riskLevel: RiskLevel;
  cryptoPct: number;
}

interface Subscription {
  tier: string;
  status: string;
  trialEndsAt: string | null;
}

const sectionStyle = {
  marginBottom: '24px',
};

const sectionTitleStyle = {
  color: '#fff',
  fontSize: '16px',
  fontWeight: 600 as const,
  marginBottom: '12px',
};

const inputClassNames = {
  input: 'text-white',
  label: 'text-gray-400',
  inputWrapper: 'bg-[#1a1a1a] border-[#333] hover:border-[#555]',
};

const riskOptions: { value: RiskLevel; label: string }[] = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'aggressive', label: 'Aggressive' },
];

export default function SettingsPage() {
  const [brokers, setBrokers] = useState<BrokerConnection[]>([]);
  const [strategy, setStrategy] = useState<StrategyConfig>({
    capital: 10000,
    dailyGoal: 100,
    riskLevel: 'moderate',
    cryptoPct: 30,
  });
  const [subscription, setSubscription] = useState<Subscription>({
    tier: 'hosted',
    status: 'trial',
    trialEndsAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.brokers) setBrokers(data.brokers);
        if (data.strategy) setStrategy(data.strategy);
        if (data.subscription) setSubscription(data.subscription);
      }
    } catch {
      // Settings will use defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleSaveStrategy() {
    setSaving(true);
    setSaveMessage('');
    try {
      const res = await fetch('/api/settings/strategy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(strategy),
      });
      if (res.ok) {
        setSaveMessage('Settings saved');
        setTimeout(() => setSaveMessage(''), 3000);
      } else {
        setSaveMessage('Failed to save');
      }
    } catch {
      setSaveMessage('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(broker: string) {
    setDisconnecting(broker);
    try {
      const res = await fetch(`/api/settings/broker/${broker}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setBrokers(brokers.map((b) =>
          b.broker === broker ? { ...b, connected: false, maskedKey: '' } : b
        ));
      }
    } catch {
      // Disconnect failed silently
    } finally {
      setDisconnecting(null);
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
        Loading settings...
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      fontFamily: '-apple-system, system-ui, sans-serif',
      padding: '32px',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <h1 style={{ color: '#60a5fa', fontSize: '20px', marginBottom: '4px' }}>Settings</h1>
        <p style={{ color: '#666', fontSize: '13px', marginBottom: '28px' }}>
          Manage your account, broker connections, and trading strategy.
        </p>

        {/* Broker Connections */}
        <Card style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', marginBottom: '16px' }}>
          <CardBody style={{ padding: '24px' }}>
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>Broker Connections</h2>

              {brokers.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <BrokerRow
                    name="Alpaca"
                    connected={false}
                    maskedKey=""
                    onDisconnect={() => {}}
                    disconnecting={false}
                  />
                  <BrokerRow
                    name="OANDA"
                    connected={false}
                    maskedKey=""
                    onDisconnect={() => {}}
                    disconnecting={false}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {brokers.map((b) => (
                    <BrokerRow
                      key={b.broker}
                      name={b.broker.charAt(0).toUpperCase() + b.broker.slice(1)}
                      connected={b.connected}
                      maskedKey={b.maskedKey}
                      mode={b.mode}
                      onDisconnect={() => handleDisconnect(b.broker)}
                      disconnecting={disconnecting === b.broker}
                    />
                  ))}
                </div>
              )}

              <Button
                variant="bordered"
                onPress={() => window.location.href = '/onboard'}
                style={{
                  borderColor: '#333',
                  color: '#60a5fa',
                  fontSize: '13px',
                  marginTop: '12px',
                }}
                size="sm"
              >
                + Connect Broker
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Strategy Config */}
        <Card style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', marginBottom: '16px' }}>
          <CardBody style={{ padding: '24px' }}>
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>Strategy Configuration</h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <Input
                  label="Simulated Capital ($)"
                  type="number"
                  value={String(strategy.capital)}
                  onValueChange={(v) => setStrategy({ ...strategy, capital: parseFloat(v) || 0 })}
                  variant="bordered"
                  classNames={inputClassNames}
                />

                <Input
                  label="Daily Goal ($)"
                  type="number"
                  value={String(strategy.dailyGoal)}
                  onValueChange={(v) => setStrategy({ ...strategy, dailyGoal: parseFloat(v) || 0 })}
                  variant="bordered"
                  classNames={inputClassNames}
                />

                <div>
                  <p style={{ color: '#999', fontSize: '13px', marginBottom: '8px' }}>Risk Level</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {riskOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setStrategy({ ...strategy, riskLevel: opt.value })}
                        style={{
                          flex: 1,
                          padding: '8px',
                          background: strategy.riskLevel === opt.value ? '#1e3a5f' : '#1a1a1a',
                          border: `1px solid ${strategy.riskLevel === opt.value ? '#2563eb' : '#333'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          color: '#fff',
                          fontSize: '13px',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}>
                    <span style={{ color: '#999', fontSize: '13px' }}>Crypto Allocation</span>
                    <span style={{ color: '#60a5fa', fontSize: '13px', fontWeight: 600 }}>
                      {strategy.cryptoPct}%
                    </span>
                  </div>
                  <Slider
                    aria-label="Crypto allocation percentage"
                    step={5}
                    minValue={0}
                    maxValue={100}
                    value={strategy.cryptoPct}
                    onChange={(v) => setStrategy({ ...strategy, cryptoPct: v as number })}
                    color="primary"
                    classNames={{ track: 'bg-[#333]' }}
                  />
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '4px',
                  }}>
                    <span style={{ color: '#555', fontSize: '11px' }}>
                      Equities: {100 - strategy.cryptoPct}%
                    </span>
                    <span style={{ color: '#555', fontSize: '11px' }}>
                      Crypto: {strategy.cryptoPct}%
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                  <Button
                    isLoading={saving}
                    onPress={handleSaveStrategy}
                    style={{
                      background: '#2563eb',
                      color: '#fff',
                      fontWeight: 600,
                    }}
                  >
                    Save Strategy
                  </Button>
                  {saveMessage && (
                    <span style={{
                      color: saveMessage === 'Settings saved' ? '#4ade80' : '#f87171',
                      fontSize: '13px',
                    }}>
                      {saveMessage}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Subscription */}
        <Card style={{ background: '#111', border: '1px solid #222', borderRadius: '12px' }}>
          <CardBody style={{ padding: '24px' }}>
            <h2 style={sectionTitleStyle}>Subscription</h2>

            <div style={{
              background: '#1a1a1a',
              border: '1px solid #222',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888', fontSize: '13px' }}>Plan</span>
                <span style={{ color: '#fff', fontSize: '13px' }}>
                  {subscription.tier === 'hosted' ? 'Hosted ($29-49/mo)' : subscription.tier}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888', fontSize: '13px' }}>Status</span>
                <span style={{
                  color: subscription.status === 'active' ? '#4ade80'
                    : subscription.status === 'trial' ? '#facc15'
                    : '#f87171',
                  fontSize: '13px',
                  fontWeight: 600,
                }}>
                  {subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
                </span>
              </div>
              {subscription.trialEndsAt && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#888', fontSize: '13px' }}>Trial Ends</span>
                  <span style={{ color: '#facc15', fontSize: '13px' }}>
                    {new Date(subscription.trialEndsAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <a
              href="/billing"
              style={{
                display: 'inline-block',
                marginTop: '12px',
                color: '#60a5fa',
                fontSize: '13px',
                textDecoration: 'none',
              }}
            >
              Manage Billing &rarr;
            </a>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function BrokerRow({
  name,
  connected,
  maskedKey,
  mode,
  onDisconnect,
  disconnecting,
}: {
  name: string;
  connected: boolean;
  maskedKey: string;
  mode?: string;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px',
      background: '#1a1a1a',
      border: '1px solid #222',
      borderRadius: '8px',
    }}>
      <div>
        <span style={{ color: '#fff', fontSize: '14px' }}>{name}</span>
        {connected && maskedKey && (
          <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
            {maskedKey}
            {mode && ` (${mode})`}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          color: connected ? '#4ade80' : '#666',
          fontSize: '12px',
        }}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
        {connected && (
          <Button
            size="sm"
            variant="bordered"
            isLoading={disconnecting}
            onPress={onDisconnect}
            style={{
              borderColor: '#333',
              color: '#f87171',
              fontSize: '12px',
              minWidth: 'auto',
              height: '28px',
            }}
          >
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}

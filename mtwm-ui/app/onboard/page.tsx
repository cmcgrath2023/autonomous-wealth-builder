'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, Button, Input, Switch, Slider } from '@heroui/react';

type RiskLevel = 'conservative' | 'moderate' | 'aggressive';

interface AlpacaConfig {
  apiKey: string;
  apiSecret: string;
  paperMode: boolean;
}

interface OandaConfig {
  apiKey: string;
  accountId: string;
}

interface StrategyConfig {
  capital: string;
  dailyGoal: string;
  riskLevel: RiskLevel;
  cryptoPct: number;
}

const TOTAL_STEPS = 4;

const stepIndicatorStyle = (active: boolean, completed: boolean) => ({
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  fontSize: '13px',
  fontWeight: 600,
  background: completed ? '#2563eb' : active ? '#1e3a5f' : '#1a1a1a',
  color: completed || active ? '#fff' : '#555',
  border: `1px solid ${completed ? '#2563eb' : active ? '#2563eb' : '#333'}`,
  transition: 'all 0.2s',
});

const stepLabelStyle = (active: boolean) => ({
  fontSize: '11px',
  color: active ? '#999' : '#444',
  marginTop: '4px',
  textAlign: 'center' as const,
  maxWidth: '80px',
});

const inputClassNames = {
  input: 'text-white',
  label: 'text-gray-400',
  inputWrapper: 'bg-[#1a1a1a] border-[#333] hover:border-[#555]',
};

const riskOptions: { value: RiskLevel; label: string; desc: string }[] = [
  { value: 'conservative', label: 'Conservative', desc: 'Lower risk, steady returns' },
  { value: 'moderate', label: 'Moderate', desc: 'Balanced risk and reward' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Higher risk, higher potential' },
];

export default function OnboardPage() {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const [alpaca, setAlpaca] = useState<AlpacaConfig>({
    apiKey: '',
    apiSecret: '',
    paperMode: true,
  });

  const [oanda, setOanda] = useState<OandaConfig>({
    apiKey: '',
    accountId: '',
  });

  const [strategy, setStrategy] = useState<StrategyConfig>({
    capital: '10000',
    dailyGoal: '100',
    riskLevel: 'moderate',
    cryptoPct: 30,
  });

  async function saveStep(stepNum: number, data: Record<string, unknown>) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/onboard/${stepNum}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to save');
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    let data: Record<string, unknown> = {};
    let valid = true;

    if (step === 1) {
      if (!alpaca.apiKey || !alpaca.apiSecret) {
        setError('Alpaca API key and secret are required');
        return;
      }
      data = { broker: 'alpaca', ...alpaca };
    } else if (step === 2) {
      data = { broker: 'oanda', ...oanda, skipped: !oanda.apiKey };
    } else if (step === 3) {
      if (!strategy.capital || parseFloat(strategy.capital) <= 0) {
        setError('Please enter a valid capital amount');
        return;
      }
      data = {
        capital: parseFloat(strategy.capital),
        dailyGoal: parseFloat(strategy.dailyGoal) || 100,
        riskLevel: strategy.riskLevel,
        cryptoPct: strategy.cryptoPct,
      };
    }

    const ok = await saveStep(step, data);
    if (ok && step < TOTAL_STEPS) {
      setStep(step + 1);
      setError('');
    }
  }

  async function handleActivate() {
    const ok = await saveStep(4, { activate: true });
    if (ok) {
      router.push('/');
    }
  }

  const stepLabels = ['Alpaca', 'OANDA', 'Strategy', 'Activate'];

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      fontFamily: '-apple-system, system-ui, sans-serif',
      padding: '20px',
    }}>
      <Card style={{
        background: '#111',
        border: '1px solid #222',
        borderRadius: '12px',
        width: '480px',
        maxWidth: '100%',
      }}>
        <CardBody style={{ padding: '32px' }}>
          <h1 style={{ color: '#60a5fa', fontSize: '20px', marginBottom: '4px' }}>MTWM</h1>
          <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>
            Set up your trading account
          </p>

          {/* Step indicator */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '24px',
            marginBottom: '28px',
          }}>
            {stepLabels.map((label, i) => {
              const num = i + 1;
              const active = num === step;
              const completed = num < step;
              return (
                <div key={num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={stepIndicatorStyle(active, completed)}>
                    {completed ? '\u2713' : num}
                  </div>
                  <span style={stepLabelStyle(active || completed)}>{label}</span>
                </div>
              );
            })}
          </div>

          <p style={{ color: '#888', fontSize: '12px', textAlign: 'center', marginBottom: '20px' }}>
            Step {step} of {TOTAL_STEPS}
          </p>

          {/* Step 1: Connect Alpaca */}
          {step === 1 && (
            <div>
              <h2 style={{ color: '#fff', fontSize: '16px', marginBottom: '4px' }}>Connect Alpaca</h2>
              <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
                Enter your Alpaca brokerage API credentials.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Input
                  label="API Key"
                  placeholder="PK..."
                  value={alpaca.apiKey}
                  onValueChange={(v) => setAlpaca({ ...alpaca, apiKey: v })}
                  variant="bordered"
                  autoFocus
                  classNames={inputClassNames}
                />
                <Input
                  label="API Secret"
                  type="password"
                  placeholder="Your Alpaca secret"
                  value={alpaca.apiSecret}
                  onValueChange={(v) => setAlpaca({ ...alpaca, apiSecret: v })}
                  variant="bordered"
                  classNames={inputClassNames}
                />
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 0',
                }}>
                  <div>
                    <span style={{ color: '#fff', fontSize: '14px' }}>Paper Trading</span>
                    <p style={{ color: '#666', fontSize: '12px', marginTop: '2px' }}>
                      {alpaca.paperMode ? 'Simulated trades (recommended to start)' : 'Live trades with real money'}
                    </p>
                  </div>
                  <Switch
                    isSelected={alpaca.paperMode}
                    onValueChange={(v) => setAlpaca({ ...alpaca, paperMode: v })}
                    color="primary"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Connect OANDA (Optional) */}
          {step === 2 && (
            <div>
              <h2 style={{ color: '#fff', fontSize: '16px', marginBottom: '4px' }}>
                Connect OANDA
                <span style={{ color: '#555', fontSize: '12px', marginLeft: '8px', fontWeight: 400 }}>Optional</span>
              </h2>
              <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
                Add OANDA for forex trading. You can skip this and add it later in settings.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Input
                  label="API Key"
                  placeholder="Your OANDA API key"
                  value={oanda.apiKey}
                  onValueChange={(v) => setOanda({ ...oanda, apiKey: v })}
                  variant="bordered"
                  autoFocus
                  classNames={inputClassNames}
                />
                <Input
                  label="Account ID"
                  placeholder="e.g. 101-001-12345678-001"
                  value={oanda.accountId}
                  onValueChange={(v) => setOanda({ ...oanda, accountId: v })}
                  variant="bordered"
                  classNames={inputClassNames}
                />
              </div>
            </div>
          )}

          {/* Step 3: Configure Strategy */}
          {step === 3 && (
            <div>
              <h2 style={{ color: '#fff', fontSize: '16px', marginBottom: '4px' }}>Configure Strategy</h2>
              <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
                Set your trading parameters. You can adjust these anytime in settings.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <Input
                  label="Simulated Capital ($)"
                  type="number"
                  placeholder="10000"
                  value={strategy.capital}
                  onValueChange={(v) => setStrategy({ ...strategy, capital: v })}
                  variant="bordered"
                  classNames={inputClassNames}
                />
                <Input
                  label="Daily Goal ($)"
                  type="number"
                  placeholder="100"
                  value={strategy.dailyGoal}
                  onValueChange={(v) => setStrategy({ ...strategy, dailyGoal: v })}
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
                          padding: '10px 8px',
                          background: strategy.riskLevel === opt.value ? '#1e3a5f' : '#1a1a1a',
                          border: `1px solid ${strategy.riskLevel === opt.value ? '#2563eb' : '#333'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        <span style={{ color: '#fff', fontSize: '13px', display: 'block' }}>
                          {opt.label}
                        </span>
                        <span style={{ color: '#666', fontSize: '11px', display: 'block', marginTop: '2px' }}>
                          {opt.desc}
                        </span>
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
                    classNames={{
                      track: 'bg-[#333]',
                    }}
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
              </div>
            </div>
          )}

          {/* Step 4: Activate */}
          {step === 4 && (
            <div>
              <h2 style={{ color: '#fff', fontSize: '16px', marginBottom: '4px' }}>Activate Trading</h2>
              <p style={{ color: '#666', fontSize: '13px', marginBottom: '20px' }}>
                Review your configuration and start autonomous trading.
              </p>

              <div style={{
                background: '#1a1a1a',
                border: '1px solid #222',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}>
                <SummaryRow label="Alpaca" value={alpaca.apiKey ? `${alpaca.apiKey.slice(0, 6)}... (${alpaca.paperMode ? 'Paper' : 'Live'})` : 'Not configured'} />
                <SummaryRow label="OANDA" value={oanda.apiKey ? `${oanda.apiKey.slice(0, 6)}... Connected` : 'Skipped'} />
                <SummaryRow label="Capital" value={`$${parseFloat(strategy.capital || '0').toLocaleString()}`} />
                <SummaryRow label="Daily Goal" value={`$${parseFloat(strategy.dailyGoal || '0').toLocaleString()}`} />
                <SummaryRow label="Risk Level" value={strategy.riskLevel.charAt(0).toUpperCase() + strategy.riskLevel.slice(1)} />
                <SummaryRow label="Allocation" value={`${100 - strategy.cryptoPct}% Equities / ${strategy.cryptoPct}% Crypto`} />
              </div>
            </div>
          )}

          {error && (
            <p style={{ color: '#f87171', fontSize: '13px', marginTop: '12px' }}>{error}</p>
          )}

          {/* Navigation buttons */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '24px',
            gap: '12px',
          }}>
            {step > 1 && (
              <Button
                variant="bordered"
                onPress={() => { setStep(step - 1); setError(''); }}
                style={{
                  borderColor: '#333',
                  color: '#999',
                }}
              >
                Back
              </Button>
            )}
            <div style={{ flex: 1 }} />
            {step < TOTAL_STEPS ? (
              <Button
                isLoading={saving}
                onPress={handleNext}
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 600,
                }}
              >
                {step === 2 && !oanda.apiKey ? 'Skip' : 'Next'}
              </Button>
            ) : (
              <Button
                isLoading={saving}
                onPress={handleActivate}
                style={{
                  background: '#16a34a',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '14px',
                  padding: '0 24px',
                }}
              >
                Start Trading
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#888', fontSize: '13px' }}>{label}</span>
      <span style={{ color: '#fff', fontSize: '13px' }}>{value}</span>
    </div>
  );
}

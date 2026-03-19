'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, Button, Input } from '@heroui/react';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!email || !password || !confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push('/onboard');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Sign up failed. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      fontFamily: '-apple-system, system-ui, sans-serif',
    }}>
      <Card style={{
        background: '#111',
        border: '1px solid #222',
        borderRadius: '12px',
        width: '380px',
      }}>
        <CardBody style={{ padding: '32px' }}>
          <form onSubmit={handleSubmit}>
            <h1 style={{ color: '#60a5fa', fontSize: '20px', marginBottom: '4px' }}>MTWM</h1>
            <p style={{ color: '#666', fontSize: '13px', marginBottom: '8px' }}>
              McGrath Trust Wealth Management
            </p>
            <p style={{ color: '#999', fontSize: '14px', marginBottom: '24px' }}>
              Create your account to start autonomous trading.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Input
                type="email"
                label="Email"
                placeholder="you@example.com"
                value={email}
                onValueChange={setEmail}
                variant="bordered"
                autoFocus
                autoComplete="email"
                classNames={{
                  input: 'text-white',
                  label: 'text-gray-400',
                  inputWrapper: 'bg-[#1a1a1a] border-[#333] hover:border-[#555]',
                }}
              />

              <Input
                type="password"
                label="Password"
                placeholder="Min. 8 characters"
                value={password}
                onValueChange={setPassword}
                variant="bordered"
                autoComplete="new-password"
                classNames={{
                  input: 'text-white',
                  label: 'text-gray-400',
                  inputWrapper: 'bg-[#1a1a1a] border-[#333] hover:border-[#555]',
                }}
              />

              <Input
                type="password"
                label="Confirm Password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onValueChange={setConfirmPassword}
                variant="bordered"
                autoComplete="new-password"
                classNames={{
                  input: 'text-white',
                  label: 'text-gray-400',
                  inputWrapper: 'bg-[#1a1a1a] border-[#333] hover:border-[#555]',
                }}
              />
            </div>

            {error && (
              <p style={{ color: '#f87171', fontSize: '13px', marginTop: '12px' }}>{error}</p>
            )}

            <Button
              type="submit"
              isLoading={loading}
              style={{
                width: '100%',
                marginTop: '20px',
                background: '#2563eb',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
              }}
            >
              Start Free Trial
            </Button>

            <p style={{
              color: '#555',
              fontSize: '12px',
              textAlign: 'center',
              marginTop: '16px',
            }}>
              3-day free trial. No credit card required.
            </p>

            <p style={{
              color: '#666',
              fontSize: '13px',
              textAlign: 'center',
              marginTop: '12px',
            }}>
              Already have an account?{' '}
              <a href="/login" style={{ color: '#60a5fa', textDecoration: 'none' }}>
                Sign in
              </a>
            </p>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

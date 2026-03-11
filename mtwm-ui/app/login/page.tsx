'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      router.push(redirect);
    } else {
      setError('Invalid credentials');
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: '#111',
      border: '1px solid #222',
      borderRadius: '12px',
      padding: '32px',
      width: '320px',
    }}>
      <h1 style={{ color: '#60a5fa', fontSize: '20px', marginBottom: '4px' }}>MTWM</h1>
      <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>McGrath Trust Wealth Management</p>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoFocus
        autoComplete="username"
        style={{
          width: '100%',
          padding: '10px 12px',
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '6px',
          color: '#fff',
          fontSize: '14px',
          marginBottom: '10px',
          outline: 'none',
        }}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        style={{
          width: '100%',
          padding: '10px 12px',
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '6px',
          color: '#fff',
          fontSize: '14px',
          marginBottom: '12px',
          outline: 'none',
        }}
      />
      {error && <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '8px' }}>{error}</p>}
      <button type="submit" style={{
        width: '100%',
        padding: '10px',
        background: '#2563eb',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontSize: '14px',
        cursor: 'pointer',
      }}>
        Sign In
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      fontFamily: '-apple-system, system-ui, sans-serif',
    }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}

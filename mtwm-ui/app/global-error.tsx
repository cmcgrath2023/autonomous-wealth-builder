'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui' }}>
        <h2>Application Error</h2>
        <p>{error.message}</p>
        <button onClick={() => reset()} style={{ padding: '0.5rem 1rem', marginTop: '1rem', cursor: 'pointer' }}>
          Reload
        </button>
      </body>
    </html>
  );
}

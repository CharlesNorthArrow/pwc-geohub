'use client';

import { useState } from 'react';

/**
 * Tiny login form. POSTs to /api/admin/login as JSON; on 204 the page
 * reloads so the layout reruns `hasValidAdminSession` and renders the
 * children. The password value never persists in client state past the
 * submit — we clear the input on result.
 */
export default function AdminLogin(): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setPassword('');
      if (r.status === 204) {
        window.location.reload();
        return;
      }
      setError('Incorrect password.');
    } catch {
      setError('Network error.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: 32, background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px 0' }}>Admin sign-in</h1>
      <p style={{ fontSize: 13, color: '#5a6e85', margin: '0 0 20px 0' }}>
        Enter the admin password to manage PWC data.
      </p>
      <form onSubmit={onSubmit}>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          disabled={busy}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #c7d3e0',
            borderRadius: 4,
            boxSizing: 'border-box',
            marginBottom: 12,
          }}
        />
        <button
          type="submit"
          disabled={busy || password.length === 0}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: '#027BC0',
            color: '#fff',
            border: 0,
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 600,
            cursor: busy ? 'progress' : 'pointer',
            opacity: password.length === 0 ? 0.6 : 1,
          }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error ? (
          <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginTop: 12 }}>
            {error}
          </div>
        ) : null}
      </form>
    </div>
  );
}

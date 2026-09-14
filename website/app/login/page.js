'use client';

import Link from 'next/link';
import { useState } from 'react';
import SiteNav from '@/components/SiteNav';
import { api, setAuth } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setAuth(data.token, data.user);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="form-shell">
      <SiteNav />
      <form className="form-card" onSubmit={onSubmit}>
        <h1>Log in</h1>
        <p className="lead">Access your RB-VPN dashboard.</p>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        <label>Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />
        <button className="btn-primary btn-block" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="error">{error}</p>
        <p className="lead">
          New here? <Link href="/register">Create an account</Link>
        </p>
      </form>
    </div>
  );
}

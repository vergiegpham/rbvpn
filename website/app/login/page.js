'use client';

import Link from 'next/link';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import SiteNav from '@/components/SiteNav';
import { api, safeNextPath, setAuth } from '@/lib/api';

function LoginForm() {
  const params = useSearchParams();
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
        auth: false,
      });
      setAuth(data.token, data.user);
      const next = safeNextPath(params.get('next'));
      if (next) {
        window.location.href = next;
      } else if (data.user.role === 'admin') {
        window.location.href = '/admin';
      } else {
        window.location.href = '/dashboard';
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      <h1>Log in</h1>
      <p className="lead">Access your RB-VPN dashboard.</p>
      <label>Email</label>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        autoComplete="username"
        required
      />
      <label>Password</label>
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        autoComplete="current-password"
        required
      />
      <button className="btn-primary btn-block" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="error">{error}</p>
      <p className="lead">
        New here? <Link href="/register">Create an account</Link>
      </p>
      <p className="lead" style={{ fontSize: '0.9rem' }}>
        Forgot your password? <Link href="/contact">Contact support</Link> from your account email
        and we will reset it.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="form-shell">
      <SiteNav />
      <Suspense fallback={<div className="form-card">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
import SiteNav from '@/components/SiteNav';
import { api, setAuth } from '@/lib/api';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: { name, email, password },
      });
      setAuth(data.token, data.user);
      window.location.href = '/pricing';
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
        <h1>Create account</h1>
        <p className="lead">Then pick a plan and download the Windows client.</p>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        <label>Password (min 8)</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          minLength={8}
          required
        />
        <button className="btn-primary btn-block" disabled={loading}>
          {loading ? 'Creating…' : 'Create account'}
        </button>
        <p className="error">{error}</p>
        <p className="lead">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { api, formatMoney, getStoredUser, getToken } from '@/lib/api';

const STATUSES = ['', 'paid', 'pending', 'processing', 'partially_paid', 'failed', 'expired', 'refunded'];

function providerLabel(p) {
  const ref = String(p.providerRef || '');
  const test = ref.startsWith('mock_') || ref.startsWith('dev_stripe_');
  const name = p.provider === 'nowpayments' ? 'crypto' : p.provider;
  return test ? `${name} (test)` : name;
}

export default function AdminPaymentsPage() {
  const router = useRouter();
  const [payments, setPayments] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function load(filter = status) {
    const data = await api(`/api/admin/payments${filter ? `?status=${encodeURIComponent(filter)}` : ''}`);
    setPayments(data.payments || []);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/admin/payments');
      return;
    }
    if (getStoredUser()?.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    load('').catch((err) => setError(err.message));
  }, [router]);

  const paidTotal = payments
    .filter((p) => p.status === 'paid')
    .reduce((sum, p) => sum + (p.amountCents || 0), 0);

  return (
    <AdminShell title="Payments">
      <div className="admin-toolbar">
        <select
          value={status}
          style={{ maxWidth: 220 }}
          onChange={(e) => {
            setStatus(e.target.value);
            load(e.target.value).catch((err) => setError(err.message));
          }}
        >
          {STATUSES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s ? s.replace('_', ' ') : 'All statuses'}
            </option>
          ))}
        </select>
        <button type="button" className="ghost-btn" onClick={() => load().catch((err) => setError(err.message))}>
          Refresh
        </button>
        <span className="admin-muted">
          {payments.length} shown · paid total {formatMoney(paidTotal)}
        </span>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>Plan</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr>
                <td colSpan={6} className="admin-muted">
                  No payments.
                </td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="admin-muted">{new Date(p.createdAt).toLocaleString()}</td>
                <td>{p.user?.email}</td>
                <td>{p.plan?.name}</td>
                <td>{providerLabel(p)}</td>
                <td>{p.status}</td>
                <td>{formatMoney(p.amountCents, p.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}

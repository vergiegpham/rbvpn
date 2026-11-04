'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { api, formatMoney, getStoredUser, getToken } from '@/lib/api';

function StatCard({ label, value }) {
  return (
    <div className="admin-stat">
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState({ payments: [], subscriptions: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/admin');
      return;
    }
    const user = getStoredUser();
    if (!user || user.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }

    (async () => {
      try {
        const [s, p, sub] = await Promise.all([
          api('/api/admin/stats'),
          api('/api/admin/payments'),
          api('/api/admin/subscriptions'),
        ]);
        setStats(s.stats);
        setRecent({
          payments: (p.payments || []).slice(0, 8),
          subscriptions: (sub.subscriptions || []).slice(0, 8),
        });
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [router]);

  return (
    <AdminShell title="Overview">
      {error && <p className="error">{error}</p>}
      {stats && (
        <div className="admin-stats-grid">
          <StatCard label="Users" value={stats.users} />
          <StatCard label="Active subscriptions" value={stats.activeSubscriptions} />
          <StatCard label="Devices" value={stats.devices} />
          <StatCard label="Connected now" value={stats.liveSessions ?? 0} />
          <StatCard label="Active nodes" value={stats.activeNodes} />
          <StatCard label="Paid orders" value={stats.paidPayments} />
          <StatCard label="Revenue today" value={formatMoney(stats.dailyRevenueCents)} />
          <StatCard label="Revenue this month" value={formatMoney(stats.monthlyRevenueCents)} />
        </div>
      )}

      <div className="admin-toolbar" style={{ marginBottom: '1rem' }}>
        <a href="/admin/nodes" className="btn-primary">
          Create new node
        </a>
        <a href="/admin/users" className="ghost-btn">
          Manage users
        </a>
        <a href="/admin/devices" className="ghost-btn">
          Connected devices
        </a>
        <a href="/admin/payments" className="ghost-btn">
          Payments
        </a>
        <a href="/admin/messages" className="ghost-btn">
          Messages
        </a>
      </div>

      <div className="admin-two-col">
        <section className="admin-panel">
          <h2>Recent payments</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.user?.email}</td>
                  <td>{p.plan?.name}</td>
                  <td>{p.status}</td>
                  <td>${(p.amountCents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="admin-panel">
          <h2>Recent subscriptions</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Ends</th>
              </tr>
            </thead>
            <tbody>
              {recent.subscriptions.map((s) => (
                <tr key={s.id}>
                  <td>{s.user?.email}</td>
                  <td>{s.plan?.name}</td>
                  <td>{s.status}</td>
                  <td>{new Date(s.endsAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </AdminShell>
  );
}

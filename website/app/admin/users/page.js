'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { api, getStoredUser, getToken } from '@/lib/api';

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tempPassword, setTempPassword] = useState(null);

  async function load(search = q) {
    const data = await api(`/api/admin/users${search ? `?q=${encodeURIComponent(search)}` : ''}`);
    setUsers(data.users || []);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/admin/users');
      return;
    }
    if (getStoredUser()?.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    (async () => {
      try {
        await load('');
        const p = await api('/api/admin/plans');
        setPlans(p.plans || []);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [router]);

  async function grantSub(userId, planCode) {
    setError('');
    setMessage('');
    try {
      await api(`/api/admin/users/${userId}/subscription`, {
        method: 'POST',
        body: { planCode },
      });
      setMessage('Subscription granted.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelSub(userId) {
    setError('');
    try {
      await api(`/api/admin/users/${userId}/subscription/cancel`, { method: 'POST' });
      setMessage('Subscription cancelled.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function setRole(userId, role) {
    setError('');
    try {
      await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: { role } });
      setMessage('User updated.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function setSuspended(user, suspended) {
    const action = suspended ? 'Suspend' : 'Unsuspend';
    const ok = window.confirm(
      suspended
        ? `Suspend "${user.email}"?\n\nThey will be blocked from login and VPN access.`
        : `Unsuspend "${user.email}"?\n\nThey will be able to log in and reconnect.`
    );
    if (!ok) return;

    setError('');
    setMessage('');
    try {
      await api(`/api/admin/users/${user.id}/${suspended ? 'suspend' : 'unsuspend'}`, {
        method: 'POST',
      });
      setMessage(`${action}ed ${user.email}.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetPassword(user) {
    const ok = window.confirm(
      `Reset the password for "${user.email}"?\n\nThey will be signed out everywhere. You will see a temporary password once.`
    );
    if (!ok) return;
    setError('');
    setMessage('');
    setTempPassword(null);
    try {
      const result = await api(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' });
      setTempPassword({ email: user.email, password: result.temporaryPassword });
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeUser(user) {
    const ok = window.confirm(
      `Delete user "${user.email}"?\n\nThis removes their account, subscriptions, devices, and payment history. This cannot be undone.`
    );
    if (!ok) return;

    setError('');
    setMessage('');
    try {
      const result = await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      setMessage(`Deleted ${result.deleted || user.email}.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AdminShell title="Users">
      <div className="admin-toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email or name"
        />
        <button type="button" className="btn-primary" onClick={() => load(q)}>
          Search
        </button>
      </div>
      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}
      {tempPassword && (
        <p className="ok">
          Temporary password for {tempPassword.email}: <strong>{tempPassword.password}</strong>. Share it
          securely. It is not shown again.
        </p>
      )}

      <section className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Subscription</th>
              <th>Devices</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const sub = u.subscriptions?.[0];
              return (
                <tr key={u.id}>
                  <td>
                    <strong>{u.email}</strong>
                    <div className="admin-muted">{u.name}</div>
                  </td>
                  <td>{u.role}</td>
                  <td>
                    {u.suspended ? (
                      <span className="admin-badge admin-badge-danger">Suspended</span>
                    ) : (
                      <span className="admin-badge admin-badge-ok">Active</span>
                    )}
                  </td>
                  <td>
                    {sub ? (
                      <>
                        {sub.plan?.name} · until {new Date(sub.endsAt).toLocaleDateString()}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{u._count?.devices ?? 0}</td>
                  <td className="admin-actions">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) grantSub(u.id, v);
                        e.target.value = '';
                      }}
                    >
                      <option value="">Grant plan…</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="ghost-btn" onClick={() => cancelSub(u.id)}>
                      Cancel sub
                    </button>
                    {u.role !== 'admin' ? (
                      <button type="button" className="ghost-btn" onClick={() => setRole(u.id, 'admin')}>
                        Make admin
                      </button>
                    ) : (
                      <button type="button" className="ghost-btn" onClick={() => setRole(u.id, 'user')}>
                        Remove admin
                      </button>
                    )}
                    {u.suspended ? (
                      <button type="button" className="ghost-btn" onClick={() => setSuspended(u, false)}>
                        Unsuspend
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost-btn admin-btn-danger"
                        onClick={() => setSuspended(u, true)}
                      >
                        Suspend
                      </button>
                    )}
                    <button type="button" className="ghost-btn" onClick={() => resetPassword(u)}>
                      Reset password
                    </button>
                    <button
                      type="button"
                      className="ghost-btn admin-btn-danger"
                      onClick={() => removeUser(u)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}

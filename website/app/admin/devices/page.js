'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { api, getStoredUser, getToken } from '@/lib/api';

const STATUS_LABELS = {
  idle: 'idle',
  pending: 'connecting',
  synced: 'connected',
  release_pending: 'disconnecting',
};

export default function AdminDevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState([]);
  const [q, setQ] = useState('');
  const [liveOnly, setLiveOnly] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load(search = q, live = liveOnly) {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (live) params.set('live', '1');
    const qs = params.toString();
    const data = await api(`/api/admin/devices${qs ? `?${qs}` : ''}`);
    setDevices(data.devices || []);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/admin/devices');
      return;
    }
    if (getStoredUser()?.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    load('', true).catch((err) => setError(err.message));
  }, [router]);

  async function disconnect(d) {
    setError('');
    setMessage('');
    try {
      const result = await api(`/api/admin/devices/${d.id}/disconnect`, { method: 'POST' });
      setMessage(result.released ? `Disconnecting ${d.name}.` : `${d.name} had no active session.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(d) {
    if (!window.confirm(`Remove device "${d.name}" (${d.user?.email})?`)) return;
    setError('');
    setMessage('');
    try {
      await api(`/api/admin/devices/${d.id}`, { method: 'DELETE' });
      setMessage(`Removed ${d.name}.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AdminShell title="Devices">
      <div className="admin-toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email, device, or VPN IP"
          onKeyDown={(e) => {
            if (e.key === 'Enter') load(q).catch((err) => setError(err.message));
          }}
        />
        <button type="button" className="btn-primary" onClick={() => load(q).catch((err) => setError(err.message))}>
          Search
        </button>
        <label className="admin-check" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={liveOnly}
            onChange={(e) => {
              setLiveOnly(e.target.checked);
              load(q, e.target.checked).catch((err) => setError(err.message));
            }}
          />
          Connected only
        </label>
      </div>
      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>User</th>
              <th>Node</th>
              <th>Status</th>
              <th>VPN IP</th>
              <th>Last active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr>
                <td colSpan={7} className="admin-muted">
                  {liveOnly ? 'No connected devices.' : 'No devices.'}
                </td>
              </tr>
            )}
            {devices.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.name}</strong>
                </td>
                <td>{d.user?.email}</td>
                <td>{d.node?.name}</td>
                <td>{STATUS_LABELS[d.syncStatus] || d.syncStatus}</td>
                <td>{d.clientIp || '—'}</td>
                <td className="admin-muted">
                  {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
                </td>
                <td className="admin-actions">
                  {d.clientIp && ['pending', 'synced'].includes(d.syncStatus) && (
                    <button type="button" className="ghost-btn" onClick={() => disconnect(d)}>
                      Disconnect
                    </button>
                  )}
                  <button type="button" className="ghost-btn admin-btn-danger" onClick={() => remove(d)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}

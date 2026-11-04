'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SiteNav from '@/components/SiteNav';
import SiteFooter from '@/components/SiteFooter';
import { api, getStoredUser, getToken, clearAuth, setAuth } from '@/lib/api';

function deviceStatus(d) {
  switch (d.syncStatus) {
    case 'synced':
      return { label: `Connected${d.clientIp ? ` · ${d.clientIp}` : ''}`, tone: 'live' };
    case 'pending':
      return { label: 'Connecting…', tone: 'busy' };
    case 'release_pending':
      return { label: 'Disconnecting…', tone: 'busy' };
    default:
      return { label: 'Not connected', tone: '' };
  }
}

function ChangePasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setOk('');
    setError('');
    setBusy(true);
    try {
      const data = await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setAuth(data.token, data.user);
      setCurrentPassword('');
      setNewPassword('');
      setOk('Password updated. Other browsers and the Windows app need the new password.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>Change password</h3>
      <form onSubmit={onSubmit}>
        <label>Current password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <label>New password (8–72 characters)</label>
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Update password'}
        </button>
      </form>
      {ok && <p className="ok">{ok}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function DashboardInner() {
  const params = useSearchParams();
  const [user, setUser] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [devices, setDevices] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    const [sub, devs, nodeList] = await Promise.all([
      api('/api/plans/subscription'),
      api('/api/devices'),
      api('/api/devices/nodes/list'),
    ]);
    setSubscription(sub.subscription);
    setDevices(devs.devices || []);
    const list = nodeList.nodes || [];
    setNodes(list);
    setSelectedNodeId((current) => current || list[0]?.id || '');
  }

  useEffect(() => {
    if (!getToken()) {
      window.location.href = '/login?next=/dashboard';
      return;
    }
    setUser(getStoredUser());

    (async () => {
      try {
        const mockPay = params.get('mockPay');
        if (mockPay) {
          await api('/api/payments/mock/complete', {
            method: 'POST',
            body: { paymentId: mockPay },
          });
          setMessage('Test payment completed. Subscription activated.');
          window.history.replaceState({}, '', '/dashboard');
        } else if (params.get('paid') === '1') {
          setMessage('Payment received. If your plan is not visible yet, refresh in a few seconds.');
        }
        await refresh();
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [params]);

  async function addDevice() {
    setError('');
    try {
      await api('/api/devices', {
        method: 'POST',
        body: {
          name: `Device-${devices.length + 1}`,
          nodeId: selectedNodeId || undefined,
        },
      });
      await refresh();
      setMessage('Device created on the selected node.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function switchNode(deviceId, nodeId) {
    if (!nodeId) return;
    setError('');
    try {
      await api(`/api/devices/${deviceId}/node`, {
        method: 'POST',
        body: { nodeId },
      });
      await refresh();
      setMessage('Node switched. Reconnect in the Windows app to use the new server.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeDevice(device) {
    if (!window.confirm(`Remove "${device.name}"? If it is connected, it will be disconnected.`)) return;
    setError('');
    try {
      await api(`/api/devices/${device.id}`, { method: 'DELETE' });
      await refresh();
      setMessage('Device removed.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="form-shell">
      <SiteNav />
      <section className="section">
        <h2>Dashboard</h2>
        <p className="lead">Signed in as {user?.email}</p>
        {message && <p className="ok">{message}</p>}
        {error && <p className="error">{error}</p>}

        <div className="dash-grid">
          <div className="panel">
            <h3>Subscription</h3>
            {subscription ? (
              <>
                <p>
                  <strong>{subscription.plan.name}</strong> · active until{' '}
                  {new Date(subscription.endsAt).toLocaleString()}
                </p>
                <p className="lead">
                  Up to {subscription.plan.maxDevices} device
                  {subscription.plan.maxDevices > 1 ? 's' : ''} · all active nodes.
                </p>
                <Link href="/pricing" className="ghost-btn">
                  Extend or change plan
                </Link>
              </>
            ) : (
              <>
                <p className="lead">No active subscription.</p>
                <Link href="/pricing" className="btn-primary">
                  Choose a plan
                </Link>
              </>
            )}
          </div>

          <div className="panel">
            <h3>Windows app</h3>
            <p className="lead">Download the RB-VPN installer, sign in with this account, and click Connect.</p>
            <Link href="/download" className="btn-primary">
              Download app
            </Link>
          </div>
        </div>

        <div className="panel" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <h3>Devices</h3>
            <div className="pay-row" style={{ marginTop: 0 }}>
              <select
                value={selectedNodeId}
                onChange={(e) => setSelectedNodeId(e.target.value)}
                style={{ width: 'auto', minWidth: 180 }}
              >
                {nodes.length === 0 && <option value="">No nodes</option>}
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.region})
                  </option>
                ))}
              </select>
              <button className="ghost-btn" onClick={addDevice} type="button" disabled={!subscription}>
                Add device
              </button>
            </div>
          </div>
          {devices.length === 0 && (
            <p className="lead">
              No devices yet. The Windows app creates one automatically the first time you connect.
            </p>
          )}
          {devices.map((d) => {
            const status = deviceStatus(d);
            return (
              <div className="device-item" key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <div className="lead" style={{ margin: 0 }}>
                    {d.node?.name} · {d.node?.region} ·{' '}
                    <span className={`status-badge ${status.tone}`}>{status.label}</span>
                  </div>
                  {d.lastSeenAt && (
                    <div className="lead" style={{ margin: 0, fontSize: '0.85rem' }}>
                      Last active {new Date(d.lastSeenAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="pay-row">
                  <select
                    value={d.node?.id || ''}
                    onChange={(e) => switchNode(d.id, e.target.value)}
                    style={{ width: 'auto', minWidth: 160 }}
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                  <button className="ghost-btn" type="button" onClick={() => removeDevice(d)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="dash-grid" style={{ marginTop: '1rem' }}>
          <ChangePasswordPanel />
        </div>

        <button
          className="ghost-btn"
          style={{ marginTop: '1.5rem' }}
          type="button"
          onClick={() => {
            clearAuth();
            window.location.href = '/';
          }}
        >
          Log out
        </button>
      </section>
      <SiteFooter />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="section">Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}

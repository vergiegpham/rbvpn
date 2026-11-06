'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SiteNav from '@/components/SiteNav';
import { api, getStoredUser, getToken, clearAuth, setAuth } from '@/lib/api';

function deviceStatus(syncStatus) {
  switch (syncStatus) {
    case 'synced':
      return 'Connected';
    case 'pending':
      return 'Connecting…';
    case 'release_pending':
      return 'Disconnecting…';
    default:
      return 'Disconnected';
  }
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
    if (!selectedNodeId && list[0]) setSelectedNodeId(list[0].id);
  }

  useEffect(() => {
    if (!getToken()) {
      window.location.href = '/login';
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
          setMessage('Mock payment completed. Subscription activated.');
          window.history.replaceState({}, '', '/dashboard');
        } else if (params.get('paid') === '1') {
          setMessage('Payment received. If subscription is not visible yet, refresh in a few seconds.');
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
      setMessage('Device created on selected node. All plans can use every node.');
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

  async function removeDevice(id) {
    setError('');
    try {
      await api(`/api/devices/${id}`, { method: 'DELETE' });
      await refresh();
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
                <p className="lead">All active nodes are available on every plan.</p>
                <Link href="/pricing" className="ghost-btn">
                  Change plan
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
            <p className="lead">Download the RB-VPN .msi, install, and sign in with this account.</p>
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
              <button className="ghost-btn" onClick={addDevice} type="button">
                Add device
              </button>
            </div>
          </div>
          {devices.length === 0 && (
            <p className="lead">No devices yet. Pick any node above, or let the Windows app create one.</p>
          )}
          {devices.map((d) => (
            <div className="device-item" key={d.id}>
              <div>
                <strong>{d.name}</strong>
                <div className="lead" style={{ margin: 0 }}>
                  {d.node?.name} · {d.node?.region} · {deviceStatus(d.syncStatus)}
                </div>
              </div>
              <div className="pay-row">
                <select
                  defaultValue={d.node?.id || ''}
                  onChange={(e) => switchNode(d.id, e.target.value)}
                  style={{ width: 'auto', minWidth: 160 }}
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
                <button className="ghost-btn" type="button" onClick={() => removeDevice(d.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <ChangePassword />

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
    </div>
  );
}

function ChangePassword() {
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
      setOk('Password updated. Sign in again on the Windows app with the new password.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" style={{ marginTop: '1rem' }} onSubmit={onSubmit}>
      <h3>Change password</h3>
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
      {ok && <p className="ok">{ok}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="section">Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}

'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SiteNav from '@/components/SiteNav';
import { api, getStoredUser, getToken, clearAuth } from '@/lib/api';

function DashboardInner() {
  const params = useSearchParams();
  const [user, setUser] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [devices, setDevices] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [configText, setConfigText] = useState('');

  async function refresh() {
    const [sub, devs] = await Promise.all([
      api('/api/plans/subscription'),
      api('/api/devices'),
    ]);
    setSubscription(sub.subscription);
    setDevices(devs.devices || []);
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
        body: { name: `Device-${devices.length + 1}` },
      });
      await refresh();
      setMessage('Device created. Node agent will sync the peer shortly.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function showConfig(id) {
    setError('');
    try {
      const conf = await api(`/api/devices/${id}/config`);
      setConfigText(conf.conf);
      setMessage(`Config for ${conf.name} · ${conf.endpoint}`);
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
            <p className="lead">Install WireGuard, then run the RB-VPN client and sign in.</p>
            <Link href="/download" className="btn-primary">
              Download instructions
            </Link>
          </div>
        </div>

        <div className="panel" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <h3>Devices</h3>
            <button className="ghost-btn" onClick={addDevice} type="button">
              Add device
            </button>
          </div>
          {devices.length === 0 && <p className="lead">No devices yet.</p>}
          {devices.map((d) => (
            <div className="device-item" key={d.id}>
              <div>
                <strong>{d.name}</strong>
                <div className="lead" style={{ margin: 0 }}>
                  {d.node?.name} · {d.clientIp} · {d.syncStatus}
                </div>
              </div>
              <div className="pay-row">
                <button className="ghost-btn" type="button" onClick={() => showConfig(d.id)}>
                  Config
                </button>
                <button className="ghost-btn" type="button" onClick={() => removeDevice(d.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          {configText && (
            <pre
              style={{
                marginTop: '1rem',
                padding: '0.9rem',
                background: '#0f1a28',
                color: '#d7e6ff',
                borderRadius: '0.75rem',
                overflow: 'auto',
                fontSize: '0.8rem',
              }}
            >
              {configText}
            </pre>
          )}
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

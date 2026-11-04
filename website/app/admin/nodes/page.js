'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { api, getStoredUser, getToken } from '@/lib/api';

const emptyNode = {
  name: '',
  region: '',
  publicHost: '',
  publicPort: 51820,
  publicKey: '',
  interfaceName: 'wg0',
  subnetCidr: '10.10.0.0/24',
  gatewayIp: '10.10.0.1',
  capacity: 250,
  active: true,
};

const emptyPurchase = {
  quantity: 2,
  slices: 1,
  period: 1,
  platform: 'kvm',
  location: '',
  templateKey: '',
  hostnamePrefix: 'rbvpn',
  namePrefix: 'Node',
  coupon: '',
  capacity: 250,
  waitForIp: true,
};

// The agent reports every ~30s; two minutes of silence means it is down or cannot reach the API.
function AgentStatus({ seenAt }) {
  if (!seenAt) return <span className="admin-muted">never reported</span>;
  const ageMs = Date.now() - new Date(seenAt).getTime();
  if (ageMs < 2 * 60 * 1000) return <span className="admin-badge admin-badge-ok">online</span>;
  return (
    <span className="admin-badge admin-badge-danger" title={new Date(seenAt).toLocaleString()}>
      offline
    </span>
  );
}

export default function AdminNodesPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState([]);
  const [form, setForm] = useState(emptyNode);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [purchase, setPurchase] = useState(emptyPurchase);
  const [buying, setBuying] = useState(false);
  const [credentials, setCredentials] = useState([]);

  async function load() {
    const data = await api('/api/admin/nodes');
    setNodes(data.nodes || []);
  }

  async function loadCatalog() {
    try {
      const data = await api('/api/admin/interserver/catalog');
      setCatalog(data);
      setPurchase((p) => ({
        ...p,
        location: p.location || String(data.locations?.[0]?.id || ''),
        platform:
          p.platform ||
          data.platforms?.find((x) => /kvm/i.test(x.platform))?.platform ||
          data.platforms?.[0]?.platform ||
          'kvm',
        templateKey:
          p.templateKey ||
          (data.templates?.[0] ? `${data.templates[0].file}||${data.templates[0].os}` : ''),
      }));
    } catch (err) {
      setCatalog({
        configured: false,
        error: err.message,
        locations: [],
        platforms: [],
        templates: [],
      });
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/admin/nodes');
      return;
    }
    if (getStoredUser()?.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    load().catch((err) => setError(err.message));
    loadCatalog().catch(() => {});
  }, [router]);

  const selectedTemplate = useMemo(() => {
    if (!catalog?.templates?.length || !purchase.templateKey) return null;
    const [file, os] = purchase.templateKey.split('||');
    return catalog.templates.find((t) => t.file === file && t.os === os) || null;
  }, [catalog, purchase.templateKey]);

  function resetForm() {
    setForm(emptyNode);
    setEditingId(null);
  }

  function startEdit(n) {
    setEditingId(n.id);
    setForm({
      name: n.name || '',
      region: n.region || '',
      publicHost: n.publicHost || '',
      publicPort: n.publicPort || 51820,
      publicKey: n.publicKey || '',
      interfaceName: n.interfaceName || 'wg0',
      subnetCidr: n.subnetCidr || '10.10.0.0/24',
      gatewayIp: n.gatewayIp || '10.10.0.1',
      capacity: n.capacity || 250,
      active: n.active !== false,
    });
    setMessage('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveNode(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const body = {
        ...form,
        publicPort: Number(form.publicPort),
        capacity: Number(form.capacity),
      };
      if (editingId) {
        await api(`/api/admin/nodes/${editingId}`, { method: 'PATCH', body });
        setMessage('Node updated.');
      } else {
        const created = await api('/api/admin/nodes', { method: 'POST', body });
        setMessage(
          `Node created. Use NODE_ID=${created.node.id} in the vpn-agent .env on that VPS.`
        );
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleNode(id, active) {
    setError('');
    try {
      await api(`/api/admin/nodes/${id}`, { method: 'PATCH', body: { active } });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteNode(n) {
    if (!window.confirm(`Delete node "${n.name}"? This cannot be undone.`)) return;
    setError('');
    setMessage('');
    try {
      await api(`/api/admin/nodes/${n.id}`, { method: 'DELETE' });
      if (editingId === n.id) resetForm();
      setMessage('Node deleted.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyId(id) {
    try {
      await navigator.clipboard.writeText(id);
      setMessage(`Copied node ID: ${id}`);
    } catch {
      setMessage(`Node ID: ${id}`);
    }
  }

  async function purchaseVps(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setCredentials([]);
    if (!selectedTemplate) {
      setError('Select an OS template.');
      return;
    }
    if (!purchase.location) {
      setError('Select a location.');
      return;
    }
    setBuying(true);
    try {
      const result = await api('/api/admin/interserver/purchase', {
        method: 'POST',
        body: {
          quantity: Number(purchase.quantity),
          slices: Number(purchase.slices),
          period: Number(purchase.period),
          platform: purchase.platform,
          location: Number(purchase.location),
          os: selectedTemplate.file,
          version: selectedTemplate.os,
          hostnamePrefix: purchase.hostnamePrefix,
          namePrefix: purchase.namePrefix,
          coupon: purchase.coupon || '',
          capacity: Number(purchase.capacity),
          waitForIp: Boolean(purchase.waitForIp),
          regionLabel:
            catalog?.locations?.find((l) => String(l.id) === String(purchase.location))?.name ||
            undefined,
        },
      });
      const okCount = (result.orders || []).filter((o) => o.ok).length;
      const failCount = (result.orders || []).length - okCount;
      setCredentials(result.credentials || []);
      setMessage(
        `Ordered ${okCount} VPS${failCount ? ` (${failCount} failed)` : ''}. Save root passwords below, then install WireGuard + agent on each host.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBuying(false);
    }
  }

  async function importServices() {
    setError('');
    setMessage('');
    try {
      const result = await api('/api/admin/interserver/import-services', {
        method: 'POST',
        body: {},
      });
      setMessage(`Imported ${result.count || 0} InterServer VPS as disabled nodes.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AdminShell title="VPN nodes">
      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="admin-panel">
        <h2>Purchase InterServer VPS</h2>
        {catalog?.error && (
          <p className="admin-muted">
            InterServer not ready: {catalog.error}. Set <code>INTERSERVER_USERNAME</code> and{' '}
            <code>INTERSERVER_PASSWORD</code> (or API key) in <code>api/.env</code>, then restart the
            API.
          </p>
        )}
        {catalog && !catalog.error && (
          <p className="admin-muted">
            Orders charge your InterServer account. New nodes are created as <strong>disabled</strong>{' '}
            until you install WireGuard and set the server public key.
          </p>
        )}
        <form className="admin-form-grid" onSubmit={purchaseVps}>
          <label>
            Quantity
            <input
              type="number"
              min={1}
              max={20}
              required
              value={purchase.quantity}
              onChange={(e) => setPurchase({ ...purchase, quantity: e.target.value })}
            />
          </label>
          <label>
            Slices (size)
            <input
              type="number"
              min={1}
              max={32}
              required
              value={purchase.slices}
              onChange={(e) => setPurchase({ ...purchase, slices: e.target.value })}
            />
          </label>
          <label>
            Location
            <select
              required
              value={purchase.location}
              onChange={(e) => setPurchase({ ...purchase, location: e.target.value })}
            >
              <option value="">Select…</option>
              {(catalog?.locations || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Platform
            <select
              required
              value={purchase.platform}
              onChange={(e) => setPurchase({ ...purchase, platform: e.target.value })}
            >
              {(catalog?.platforms || [{ platform: 'kvm', name: 'KVM' }]).map((p) => (
                <option key={p.platform} value={p.platform}>
                  {p.name || p.platform}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-span-2">
            OS template
            <select
              required
              value={purchase.templateKey}
              onChange={(e) => setPurchase({ ...purchase, templateKey: e.target.value })}
            >
              <option value="">Select…</option>
              {(catalog?.templates || []).map((t) => (
                <option key={`${t.file}||${t.os}`} value={`${t.file}||${t.os}`}>
                  {t.title || `${t.os} ${t.version}`} ({t.virtualization || 'linux'})
                </option>
              ))}
            </select>
          </label>
          <label>
            Hostname prefix
            <input
              required
              value={purchase.hostnamePrefix}
              onChange={(e) => setPurchase({ ...purchase, hostnamePrefix: e.target.value })}
              placeholder="rbvpn"
            />
          </label>
          <label>
            Node name prefix
            <input
              value={purchase.namePrefix}
              onChange={(e) => setPurchase({ ...purchase, namePrefix: e.target.value })}
              placeholder="Node"
            />
          </label>
          <label>
            Bill period (months)
            <input
              type="number"
              min={1}
              max={36}
              value={purchase.period}
              onChange={(e) => setPurchase({ ...purchase, period: e.target.value })}
            />
          </label>
          <label>
            Capacity
            <input
              type="number"
              value={purchase.capacity}
              onChange={(e) => setPurchase({ ...purchase, capacity: e.target.value })}
            />
          </label>
          <label>
            Coupon (optional)
            <input
              value={purchase.coupon}
              onChange={(e) => setPurchase({ ...purchase, coupon: e.target.value })}
            />
          </label>
          <label className="admin-check admin-span-2">
            <input
              type="checkbox"
              checked={purchase.waitForIp}
              onChange={(e) => setPurchase({ ...purchase, waitForIp: e.target.checked })}
            />
            Wait for public IP after order (recommended)
          </label>
          <button
            type="submit"
            className="btn-primary"
            disabled={buying || !catalog?.locations?.length}
          >
            {buying ? 'Purchasing…' : `Purchase ${purchase.quantity} VPS`}
          </button>
          <button type="button" className="ghost-btn" onClick={importServices} disabled={buying}>
            Import existing InterServer VPS
          </button>
        </form>

        {credentials.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <h3>Root credentials (save now)</h3>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>IP</th>
                  <th>Node ID</th>
                  <th>Root password</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((c) => (
                  <tr key={c.nodeId}>
                    <td>{c.hostname}</td>
                    <td>{c.ip || 'pending'}</td>
                    <td>
                      <code style={{ fontSize: '0.75rem' }}>{c.nodeId}</code>
                    </td>
                    <td>
                      <code>{c.rootPassword}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <h2>{editingId ? 'Edit node' : 'Create node manually'}</h2>
          {editingId && (
            <button type="button" className="ghost-btn" onClick={resetForm}>
              Cancel edit
            </button>
          )}
        </div>
        <p className="admin-muted">
          After creating a node, install WireGuard on the VPS and set <code>NODE_ID</code> in the
          vpn-agent to the new node ID.
        </p>
        <form className="admin-form-grid" onSubmit={saveNode}>
          <label>
            Name
            <input
              required
              placeholder="US East 1"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Region
            <input
              required
              placeholder="us-east"
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
            />
          </label>
          <label>
            Public host (IP or domain)
            <input
              required
              placeholder="203.0.113.10"
              value={form.publicHost}
              onChange={(e) => setForm({ ...form, publicHost: e.target.value })}
            />
          </label>
          <label>
            Port
            <input
              type="number"
              required
              value={form.publicPort}
              onChange={(e) => setForm({ ...form, publicPort: e.target.value })}
            />
          </label>
          <label className="admin-span-2">
            Server public key
            <input
              required
              placeholder="WireGuard server public key"
              value={form.publicKey}
              onChange={(e) => setForm({ ...form, publicKey: e.target.value })}
            />
          </label>
          <label>
            Capacity
            <input
              type="number"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
          </label>
          <label>
            Interface
            <input
              value={form.interfaceName}
              onChange={(e) => setForm({ ...form, interfaceName: e.target.value })}
            />
          </label>
          <label>
            Subnet CIDR
            <input
              value={form.subnetCidr}
              onChange={(e) => setForm({ ...form, subnetCidr: e.target.value })}
            />
          </label>
          <label>
            Gateway IP
            <input
              value={form.gatewayIp}
              onChange={(e) => setForm({ ...form, gatewayIp: e.target.value })}
            />
          </label>
          <label className="admin-check admin-span-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active (visible to users)
          </label>
          <button type="submit" className="btn-primary">
            {editingId ? 'Save changes' : 'Create node'}
          </button>
        </form>
      </section>

      <section className="admin-panel">
        <h2>All nodes ({nodes.length})</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Host</th>
              <th>Provider</th>
              <th>Node ID</th>
              <th>Sessions</th>
              <th>Agent</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 && (
              <tr>
                <td colSpan={8} className="admin-muted">
                  No nodes yet. Purchase or create one above.
                </td>
              </tr>
            )}
            {nodes.map((n) => (
              <tr key={n.id}>
                <td>
                  <strong>{n.name}</strong>
                  <div className="admin-muted">{n.region}</div>
                </td>
                <td>
                  {n.publicHost}:{n.publicPort}
                </td>
                <td className="admin-muted">
                  {n.provider || 'manual'}
                  {n.provisionStatus ? ` · ${n.provisionStatus}` : ''}
                </td>
                <td>
                  <code style={{ fontSize: '0.75rem' }}>{n.id}</code>
                </td>
                <td>
                  {n.liveSessions ?? 0} live / {n.capacity}
                  <div className="admin-muted">{n._count?.devices ?? 0} devices</div>
                </td>
                <td>
                  <AgentStatus seenAt={n.agentSeenAt} />
                </td>
                <td>{n.active ? 'active' : 'disabled'}</td>
                <td className="admin-actions">
                  <button type="button" className="ghost-btn" onClick={() => startEdit(n)}>
                    Edit
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => copyId(n.id)}>
                    Copy ID
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => toggleNode(n.id, !n.active)}
                  >
                    {n.active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn admin-btn-danger"
                    onClick={() => deleteNode(n)}
                  >
                    Delete
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

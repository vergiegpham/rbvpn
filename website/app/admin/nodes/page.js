'use client';

import { useEffect, useState } from 'react';
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

export default function AdminNodesPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState([]);
  const [form, setForm] = useState(emptyNode);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const data = await api('/api/admin/nodes');
    setNodes(data.nodes || []);
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
  }, [router]);

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

  return (
    <AdminShell title="VPN nodes">
      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="admin-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <h2>{editingId ? 'Edit node' : 'Create new node'}</h2>
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
              <th>Node ID</th>
              <th>Peers</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 && (
              <tr>
                <td colSpan={6} className="admin-muted">
                  No nodes yet. Create one above.
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
                <td>
                  <code style={{ fontSize: '0.75rem' }}>{n.id}</code>
                </td>
                <td>
                  {n._count?.devices ?? 0} / {n.capacity}
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

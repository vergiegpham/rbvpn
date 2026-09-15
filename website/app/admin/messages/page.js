'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { api, getStoredUser, getToken } from '@/lib/api';

export default function AdminMessagesPage() {
  const router = useRouter();
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load(status = filter) {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await api(`/api/admin/messages${q}`);
    setMessages(data.messages || []);
    setUnread(data.unread || 0);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/admin/messages');
      return;
    }
    if (getStoredUser()?.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    load('').catch((err) => setError(err.message));
  }, [router]);

  async function setStatus(id, status) {
    setError('');
    try {
      await api(`/api/admin/messages/${id}`, { method: 'PATCH', body: { status } });
      if (selected?.id === id) setSelected({ ...selected, status });
      await load(filter);
      setMessage('Updated.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function openMessage(m) {
    setSelected(m);
    if (m.status === 'new') {
      try {
        await api(`/api/admin/messages/${m.id}`, { method: 'PATCH', body: { status: 'read' } });
        setSelected({ ...m, status: 'read' });
        await load(filter);
      } catch {
        /* ignore */
      }
    }
  }

  async function removeMessage(id) {
    if (!window.confirm('Delete this message?')) return;
    setError('');
    try {
      await api(`/api/admin/messages/${id}`, { method: 'DELETE' });
      if (selected?.id === id) setSelected(null);
      await load(filter);
      setMessage('Deleted.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AdminShell title={`Messages${unread ? ` (${unread} new)` : ''}`}>
      <div className="admin-toolbar">
        <select
          value={filter}
          onChange={(e) => {
            const v = e.target.value;
            setFilter(v);
            load(v).catch((err) => setError(err.message));
          }}
          style={{ maxWidth: 200 }}
        >
          <option value="">All</option>
          <option value="new">New</option>
          <option value="read">Read</option>
          <option value="replied">Replied</option>
          <option value="archived">Archived</option>
        </select>
        <button type="button" className="ghost-btn" onClick={() => load(filter)}>
          Refresh
        </button>
      </div>
      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}

      <div className="admin-two-col">
        <section className="admin-panel">
          <h2>Inbox</h2>
          {messages.length === 0 && <p className="admin-muted">No messages.</p>}
          <table className="admin-table">
            <thead>
              <tr>
                <th>From</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => openMessage(m)}
                  style={{ cursor: 'pointer', fontWeight: m.status === 'new' ? 700 : 400 }}
                >
                  <td>{m.email}</td>
                  <td>{m.subject}</td>
                  <td>{m.status}</td>
                  <td>{new Date(m.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="admin-panel">
          <h2>Detail</h2>
          {!selected && <p className="admin-muted">Select a message.</p>}
          {selected && (
            <>
              <p>
                <strong>{selected.subject}</strong>
              </p>
              <p className="admin-muted">
                From {selected.name} &lt;{selected.email}&gt; ·{' '}
                {new Date(selected.createdAt).toLocaleString()}
              </p>
              <pre className="contact-message-body">{selected.message}</pre>
              <div className="admin-actions" style={{ marginTop: '0.75rem' }}>
                <a className="ghost-btn" href={`mailto:${selected.email}?subject=Re: ${encodeURIComponent(selected.subject)}`}>
                  Reply by email
                </a>
                <button type="button" className="ghost-btn" onClick={() => setStatus(selected.id, 'replied')}>
                  Mark replied
                </button>
                <button type="button" className="ghost-btn" onClick={() => setStatus(selected.id, 'archived')}>
                  Archive
                </button>
                <button
                  type="button"
                  className="ghost-btn admin-btn-danger"
                  onClick={() => removeMessage(selected.id)}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </AdminShell>
  );
}

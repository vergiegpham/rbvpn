'use client';

import { useEffect, useState } from 'react';
import SiteNav from '@/components/SiteNav';
import { api, getStoredUser } from '@/lib/api';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = getStoredUser();
    if (stored?.name) setName(stored.name);
    if (stored?.email) setEmail(stored.email);
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setOk('');
    setLoading(true);
    try {
      await api('/api/contact', {
        method: 'POST',
        body: { name, email, subject, message },
      });
      setOk('Message sent. We will get back to you soon.');
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="form-shell">
      <SiteNav />
      <section className="section" style={{ maxWidth: 720 }}>
        <h2>Contact us</h2>
        <p className="lead">
          Questions about billing, connections, or your account? Send a message and our team will
          reply by email.
        </p>

        <form
          className="form-card"
          style={{ margin: '1.5rem 0', width: '100%', maxWidth: 560 }}
          onSubmit={onSubmit}
        >
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />

          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={120}
          />

          <label>Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            maxLength={120}
            placeholder="Billing, connection issue, other…"
          />

          <label>Message</label>
          <textarea
            className="contact-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            minLength={10}
            maxLength={4000}
            rows={6}
            placeholder="How can we help?"
          />

          <button className="btn-primary btn-block" disabled={loading}>
            {loading ? 'Sending…' : 'Send message'}
          </button>
          {ok && <p className="ok">{ok}</p>}
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    </div>
  );
}

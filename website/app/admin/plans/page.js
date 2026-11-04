'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { api, formatMoney, getStoredUser, getToken } from '@/lib/api';

const emptyPlan = {
  code: '',
  name: '',
  description: '',
  priceCents: 999,
  durationDays: 30,
  maxDevices: 1,
  active: true,
};

export default function AdminPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState([]);
  const [draft, setDraft] = useState(emptyPlan);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const data = await api('/api/admin/plans');
    setPlans(data.plans || []);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/admin/plans');
      return;
    }
    if (getStoredUser()?.role !== 'admin') {
      router.replace('/dashboard');
      return;
    }
    load().catch((err) => setError(err.message));
  }, [router]);

  async function savePlan(plan) {
    setError('');
    setMessage('');
    try {
      await api(`/api/admin/plans/${plan.id}`, {
        method: 'PATCH',
        body: {
          name: plan.name,
          description: plan.description,
          priceCents: Number(plan.priceCents),
          durationDays: Number(plan.durationDays),
          maxDevices: Number(plan.maxDevices),
          active: plan.active,
        },
      });
      setMessage('Plan saved.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createPlan(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api('/api/admin/plans', {
        method: 'POST',
        body: {
          ...draft,
          code: draft.code.trim().toLowerCase(),
          priceCents: Number(draft.priceCents),
          durationDays: Number(draft.durationDays),
          maxDevices: Number(draft.maxDevices),
        },
      });
      setDraft(emptyPlan);
      setMessage('Plan created.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function updateLocal(id, field, value) {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  return (
    <AdminShell title="Plans">
      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}
      <p className="admin-muted" style={{ marginTop: 0 }}>
        Changes apply to new purchases. Inactive plans are hidden from the pricing page but can still
        be granted from Users.
      </p>

      <div className="admin-plans-grid">
        {plans.map((plan) => (
          <section key={plan.id} className="admin-panel">
            <h2>{plan.code}</h2>
            <label>
              Name
              <input value={plan.name} onChange={(e) => updateLocal(plan.id, 'name', e.target.value)} />
            </label>
            <label>
              Description
              <input
                value={plan.description}
                onChange={(e) => updateLocal(plan.id, 'description', e.target.value)}
              />
            </label>
            <label>
              Price (cents) · {formatMoney(plan.priceCents, plan.currency)}
              <input
                type="number"
                min={1}
                value={plan.priceCents}
                onChange={(e) => updateLocal(plan.id, 'priceCents', e.target.value)}
              />
            </label>
            <label>
              Duration (days)
              <input
                type="number"
                min={1}
                value={plan.durationDays}
                onChange={(e) => updateLocal(plan.id, 'durationDays', e.target.value)}
              />
            </label>
            <label>
              Max devices
              <input
                type="number"
                min={1}
                value={plan.maxDevices}
                onChange={(e) => updateLocal(plan.id, 'maxDevices', e.target.value)}
              />
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={plan.active}
                onChange={(e) => updateLocal(plan.id, 'active', e.target.checked)}
              />
              Active on pricing page
            </label>
            <button type="button" className="btn-primary" onClick={() => savePlan(plan)}>
              Save
            </button>
          </section>
        ))}
      </div>

      <section className="admin-panel">
        <h2>New plan</h2>
        <form className="admin-form-grid" onSubmit={createPlan}>
          <label>
            Code (lowercase, e.g. trial-7d)
            <input
              required
              pattern="[a-z0-9-]{2,40}"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
          </label>
          <label>
            Name
            <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="admin-span-2">
            Description
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <label>
            Price (cents) · {formatMoney(draft.priceCents)}
            <input
              type="number"
              min={1}
              required
              value={draft.priceCents}
              onChange={(e) => setDraft({ ...draft, priceCents: e.target.value })}
            />
          </label>
          <label>
            Duration (days)
            <input
              type="number"
              min={1}
              required
              value={draft.durationDays}
              onChange={(e) => setDraft({ ...draft, durationDays: e.target.value })}
            />
          </label>
          <label>
            Max devices
            <input
              type="number"
              min={1}
              required
              value={draft.maxDevices}
              onChange={(e) => setDraft({ ...draft, maxDevices: e.target.value })}
            />
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            Show on pricing page
          </label>
          <button type="submit" className="btn-primary">
            Create plan
          </button>
        </form>
      </section>
    </AdminShell>
  );
}

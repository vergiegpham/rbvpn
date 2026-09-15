'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '@/components/AdminShell';
import { api, getStoredUser, getToken } from '@/lib/api';

export default function AdminPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState([]);
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

  function updateLocal(id, field, value) {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  return (
    <AdminShell title="Plans">
      {message && <p className="ok">{message}</p>}
      {error && <p className="error">{error}</p>}

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
              Price (cents)
              <input
                type="number"
                value={plan.priceCents}
                onChange={(e) => updateLocal(plan.id, 'priceCents', e.target.value)}
              />
            </label>
            <label>
              Duration (days)
              <input
                type="number"
                value={plan.durationDays}
                onChange={(e) => updateLocal(plan.id, 'durationDays', e.target.value)}
              />
            </label>
            <label>
              Max devices
              <input
                type="number"
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
    </AdminShell>
  );
}

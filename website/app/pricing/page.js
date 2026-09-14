'use client';

import { useEffect, useState } from 'react';
import SiteNav from '@/components/SiteNav';
import { api, getToken } from '@/lib/api';

export default function PricingPage() {
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/api/plans')
      .then((d) => setPlans(d.plans || []))
      .catch((e) => setError(e.message));
  }, []);

  async function checkout(planCode, provider) {
    if (!getToken()) {
      window.location.href = '/login';
      return;
    }
    setBusy(`${planCode}-${provider}`);
    setError('');
    try {
      const result = await api('/api/payments/checkout', {
        method: 'POST',
        body: { planCode, provider },
      });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="form-shell">
      <SiteNav />
      <section className="section">
        <h2>Pricing</h2>
        <p className="lead">Pay with card (Stripe) or crypto (NOWPayments). Cancel anytime by not renewing.</p>
        <p className="error">{error}</p>
        <div className="pricing-grid">
          {plans.map((plan) => (
            <div className="price-panel" key={plan.id}>
              <h3>{plan.name}</h3>
              <p className="lead" style={{ marginBottom: 0 }}>
                {plan.description}
              </p>
              <p className="price">
                ${(plan.priceCents / 100).toFixed(2)} <span>/ {plan.durationDays} days</span>
              </p>
              <p className="lead">Up to {plan.maxDevices} device{plan.maxDevices > 1 ? 's' : ''}</p>
              <div className="pay-row">
                <button
                  className="btn-primary"
                  disabled={!!busy}
                  onClick={() => checkout(plan.code, 'stripe')}
                >
                  {busy === `${plan.code}-stripe` ? '…' : 'Pay with Stripe'}
                </button>
                <button
                  className="ghost-btn"
                  disabled={!!busy}
                  onClick={() => checkout(plan.code, 'crypto')}
                >
                  {busy === `${plan.code}-crypto` ? '…' : 'Pay with crypto'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import SiteNav from '@/components/SiteNav';
import { api, formatMoney, getToken } from '@/lib/api';

function formatDuration(days) {
  if (days >= 365) return '/ year';
  if (days === 30) return '/ month';
  return `/ ${days} days`;
}

export default function PricingPage() {
  const [plans, setPlans] = useState([]);
  const [providers, setProviders] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/api/plans')
      .then((d) => setPlans(d.plans || []))
      .catch((e) => setError(e.message));

    api('/api/payments/providers')
      .then((d) => setProviders(d.providers || {}))
      .catch(() => setProviders({}));

    if (getToken()) {
      api('/api/plans/subscription')
        .then((d) => setSubscription(d.subscription || null))
        .catch(() => setSubscription(null));
    }
  }, []);

  const hasActive = Boolean(subscription);
  const stripeOn = Boolean(providers?.stripe?.available);
  const cryptoOn = Boolean(providers?.crypto?.available);
  const anyPay = stripeOn || cryptoOn;

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

  const monthly = plans.filter((p) => p.durationDays < 365);
  const annual = plans.filter((p) => p.durationDays >= 365);

  function PlanCard({ plan }) {
    return (
      <div className="price-panel" key={plan.id}>
        <h3>{plan.name}</h3>
        <p className="lead" style={{ marginBottom: 0 }}>
          {plan.description}
        </p>
        <p className="price">
          {formatMoney(plan.priceCents, plan.currency)}{' '}
          <span>{formatDuration(plan.durationDays)}</span>
        </p>
        <p className="lead">
          Up to {plan.maxDevices} device{plan.maxDevices > 1 ? 's' : ''}
        </p>
        {hasActive && (
          <p className="ok" style={{ fontSize: '0.9rem' }}>
            Extends your current plan through{' '}
            {new Date(
              new Date(subscription.endsAt).getTime() +
                plan.durationDays * 24 * 60 * 60 * 1000
            ).toLocaleDateString()}
          </p>
        )}
        <div className="pay-row">
          {stripeOn && (
            <button
              className="btn-primary"
              disabled={!!busy}
              onClick={() => checkout(plan.code, 'stripe')}
            >
              {busy === `${plan.code}-stripe`
                ? '…'
                : providers.stripe.mock
                  ? 'Test checkout'
                  : hasActive
                    ? 'Extend with card'
                    : 'Pay with card'}
            </button>
          )}
          {cryptoOn && (
            <button
              className="ghost-btn"
              disabled={!!busy}
              onClick={() => checkout(plan.code, 'crypto')}
            >
              {busy === `${plan.code}-crypto`
                ? '…'
                : providers.crypto.mock
                  ? 'Test crypto checkout'
                  : hasActive
                    ? 'Extend with crypto'
                    : 'Pay with crypto'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="form-shell">
      <SiteNav />
      <section className="section">
        <h2>Pricing</h2>
        <p className="lead">
          Plans are prepaid. If you already have a plan, buying again <strong>extends</strong> your
          current expiry — it does not restart it.
        </p>
        {providers && !anyPay && (
          <p className="lead">Online checkout is not set up yet. Contact us to activate a plan.</p>
        )}
        {hasActive && (
          <p className="ok">
            Active: {subscription.plan?.name} until{' '}
            {new Date(subscription.endsAt).toLocaleDateString()}
          </p>
        )}
        <p className="error">{error}</p>

        {annual.length > 0 && (
          <>
            <h3 style={{ fontFamily: 'var(--font-display)', marginTop: '1.5rem' }}>Annual</h3>
            <div className="pricing-grid">
              {annual.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          </>
        )}

        {monthly.length > 0 && (
          <>
            <h3 style={{ fontFamily: 'var(--font-display)', marginTop: '2rem' }}>Monthly</h3>
            <div className="pricing-grid">
              {monthly.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

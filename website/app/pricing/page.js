'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SiteNav from '@/components/SiteNav';
import SiteFooter from '@/components/SiteFooter';
import { api, formatMoney, getToken } from '@/lib/api';

function formatDuration(days) {
  if (days >= 365 && days % 365 === 0) return days === 365 ? '/ year' : `/ ${days / 365} years`;
  if (days === 30) return '/ month';
  return `/ ${days} days`;
}

function PricingInner() {
  const params = useSearchParams();
  const [plans, setPlans] = useState([]);
  const [providers, setProviders] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/api/plans', { auth: false })
      .then((d) => setPlans(d.plans || []))
      .catch((e) => setError(e.message));

    // If availability is unknown, offer both; checkout itself reports what is not set up.
    const fallback = { stripe: { available: true }, crypto: { available: true } };
    api('/api/payments/providers', { auth: false })
      .then((d) => setProviders(d.providers || fallback))
      .catch(() => setProviders(fallback));

    if (getToken()) {
      api('/api/plans/subscription', { redirectOn401: false })
        .then((d) => setSubscription(d.subscription || null))
        .catch(() => setSubscription(null));
    }
  }, []);

  const hasActive = Boolean(subscription);
  const anyProvider = Boolean(providers?.stripe?.available || providers?.crypto?.available);
  const testMode = Boolean(providers?.stripe?.mock || providers?.crypto?.mock);

  async function checkout(planCode, provider) {
    if (!getToken()) {
      window.location.href = '/login?next=/pricing';
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

  function payLabel(plan, provider) {
    if (busy === `${plan.code}-${provider}`) return '…';
    const method = provider === 'stripe' ? 'card' : 'crypto';
    return hasActive ? `Extend with ${method}` : `Pay with ${method}`;
  }

  function PlanCard({ plan }) {
    return (
      <div className="price-panel">
        <h3>{plan.name}</h3>
        <p className="lead" style={{ marginBottom: 0 }}>
          {plan.description}
        </p>
        <p className="price">
          {formatMoney(plan.priceCents, plan.currency)} <span>{formatDuration(plan.durationDays)}</span>
        </p>
        <p className="lead">
          Up to {plan.maxDevices} device{plan.maxDevices > 1 ? 's' : ''}
        </p>
        {hasActive && (
          <p className="ok" style={{ fontSize: '0.9rem' }}>
            Extends your current plan through{' '}
            {new Date(
              new Date(subscription.endsAt).getTime() + plan.durationDays * 24 * 60 * 60 * 1000
            ).toLocaleDateString()}
          </p>
        )}
        <div className="pay-row">
          {providers?.stripe?.available !== false && (
            <button
              className="btn-primary"
              disabled={!!busy || providers === null}
              onClick={() => checkout(plan.code, 'stripe')}
            >
              {payLabel(plan, 'stripe')}
            </button>
          )}
          {providers?.crypto?.available !== false && (
            <button
              className="ghost-btn"
              disabled={!!busy || providers === null}
              onClick={() => checkout(plan.code, 'crypto')}
            >
              {payLabel(plan, 'crypto')}
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
          Pay with card (Stripe) or crypto. Plans are prepaid and do not auto-renew. If you already
          have a plan, buying again <strong>extends</strong> your current expiry — it does not restart
          it.
        </p>
        {params.get('canceled') === '1' && (
          <p className="notice">Checkout was cancelled — you were not charged.</p>
        )}
        {providers && !anyProvider && (
          <p className="notice">
            Online payments are being set up. <a href="/contact">Contact us</a> to get a plan
            activated.
          </p>
        )}
        {testMode && (
          <p className="notice">Test mode: checkout activates the plan without charging.</p>
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
      <SiteFooter />
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="section">Loading…</div>}>
      <PricingInner />
    </Suspense>
  );
}

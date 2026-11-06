import crypto from 'crypto';
import Stripe from 'stripe';
import { env, isPlaceholder } from '../utils/env.js';
import { prisma } from '../utils/db.js';
import { activateSubscription } from './subscription.js';

const MOCK_REF_PREFIX = 'mock_';
const LEGACY_MOCK_REF_PREFIX = 'dev_stripe_';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function stripeConfigured() {
  return !isPlaceholder(env.stripeSecretKey) && !isPlaceholder(env.stripeWebhookSecret);
}

function cryptoConfigured() {
  return !isPlaceholder(env.nowPaymentsApiKey) && !isPlaceholder(env.nowPaymentsIpnSecret);
}

function getStripe() {
  return stripeConfigured() ? new Stripe(env.stripeSecretKey) : null;
}

/** What the pricing page may offer. `mock` means the button runs a test checkout (no charge). */
export function paymentProviders() {
  const stripeReady = stripeConfigured();
  const cryptoReady = cryptoConfigured();
  return {
    stripe: {
      available: stripeReady || env.allowMockPayments,
      mock: !stripeReady && env.allowMockPayments,
    },
    crypto: {
      available: cryptoReady || env.allowMockPayments,
      mock: !cryptoReady && env.allowMockPayments,
    },
  };
}

export function isMockPayment(payment) {
  const ref = String(payment?.providerRef || '');
  return ref.startsWith(MOCK_REF_PREFIX) || ref.startsWith(LEGACY_MOCK_REF_PREFIX);
}

function createPendingPayment({ user, plan, provider, providerRef = null }) {
  return prisma.payment.create({
    data: {
      userId: user.id,
      planId: plan.id,
      provider,
      providerRef,
      amountCents: plan.priceCents,
      currency: plan.currency,
      status: 'pending',
    },
  });
}

async function mockCheckout({ user, plan, provider, label }) {
  if (!env.allowMockPayments) {
    throw httpError(503, `${label} payments are not available yet. Please contact support.`);
  }
  const payment = await createPendingPayment({
    user,
    plan,
    provider: provider === 'crypto' ? 'nowpayments' : 'stripe',
    providerRef: `${MOCK_REF_PREFIX}${crypto.randomUUID()}`,
  });
  return {
    url: `${env.appUrl}/dashboard?mockPay=${payment.id}&provider=${provider}`,
    paymentId: payment.id,
    mock: true,
  };
}

export async function createStripeCheckout({ user, plan }) {
  const stripe = getStripe();
  if (!stripe) return mockCheckout({ user, plan, provider: 'stripe', label: 'Card' });

  const payment = await createPendingPayment({ user, plan, provider: 'stripe' });
  const priceId = isPlaceholder(plan.stripePriceId) ? null : plan.stripePriceId;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    client_reference_id: payment.id,
    line_items: [
      priceId
        ? { price: priceId, quantity: 1 }
        : {
            price_data: {
              currency: plan.currency,
              unit_amount: plan.priceCents,
              product_data: {
                name: `RB-VPN ${plan.name}`,
                description: plan.description,
              },
            },
            quantity: 1,
          },
    ],
    success_url: `${env.appUrl}/dashboard?paid=1`,
    cancel_url: `${env.appUrl}/pricing?canceled=1`,
    metadata: {
      paymentId: payment.id,
      userId: user.id,
      planId: plan.id,
    },
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: { providerRef: session.id },
  });

  return { url: session.url, paymentId: payment.id };
}

async function markPaymentStatus(paymentId, status, rawPayload) {
  await prisma.payment.updateMany({
    where: { id: paymentId, status: { not: 'paid' } },
    data: { status, rawPayload },
  });
}

export async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripe();
  if (!stripe) return { ignored: true };

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  } catch (err) {
    throw httpError(400, `Webhook signature error: ${err.message}`);
  }

  const session = event.data?.object || {};
  const paymentId = session.metadata?.paymentId || session.client_reference_id;
  if (!paymentId) return { received: true };

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== 'stripe' || isMockPayment(payment)) return { received: true };

  const raw = JSON.stringify(session);
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (session.payment_status === 'paid') await completePayment(payment.id, raw);
      else await markPaymentStatus(payment.id, 'processing', raw);
      break;
    case 'checkout.session.async_payment_failed':
      await markPaymentStatus(payment.id, 'failed', raw);
      break;
    case 'checkout.session.expired':
      await markPaymentStatus(payment.id, 'expired', raw);
      break;
    default:
      break;
  }
  return { received: true };
}

/** Mark paid and activate exactly once, even when providers retry at the same time. */
export async function completePayment(paymentId, rawPayload) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: { not: 'paid' } },
      data: { status: 'paid', rawPayload: rawPayload || null },
    });
    if (!claimed.count) return null;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    await activateSubscription(payment.userId, payment.planId, tx);
    return payment;
  });
}

export async function createCryptoInvoice({ user, plan }) {
  if (!cryptoConfigured()) return mockCheckout({ user, plan, provider: 'crypto', label: 'Crypto' });

  const payment = await createPendingPayment({ user, plan, provider: 'nowpayments' });
  const base = env.nowPaymentsSandbox
    ? 'https://api-sandbox.nowpayments.io/v1'
    : 'https://api.nowpayments.io/v1';

  let res;
  try {
    res = await fetch(`${base}/invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.nowPaymentsApiKey,
      },
      body: JSON.stringify({
        price_amount: plan.priceCents / 100,
        price_currency: plan.currency,
        order_id: payment.id,
        order_description: `RB-VPN ${plan.name}`,
        ipn_callback_url: `${env.apiUrl}/api/payments/crypto/ipn`,
        success_url: `${env.appUrl}/dashboard?paid=1`,
        cancel_url: `${env.appUrl}/pricing?canceled=1`,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    await markPaymentStatus(payment.id, 'failed', JSON.stringify({ error: err.message }));
    throw httpError(502, 'Crypto checkout is temporarily unavailable. Please try again.');
  }

  if (!res.ok) {
    const text = await res.text();
    await markPaymentStatus(payment.id, 'failed', text.slice(0, 2000));
    console.error('NOWPayments invoice error:', res.status, text.slice(0, 500));
    throw httpError(502, 'Crypto checkout is temporarily unavailable. Please try again.');
  }

  const data = await res.json();
  await prisma.payment.update({
    where: { id: payment.id },
    data: { providerRef: String(data.id || data.invoice_id || '') },
  });

  return { url: data.invoice_url, paymentId: payment.id };
}

/** NOWPayments signs the IPN body with HMAC-SHA512 over JSON with keys sorted recursively. */
function sortObject(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      result[key] = obj[key] && typeof obj[key] === 'object' ? sortObject(obj[key]) : obj[key];
      return result;
    }, {});
}

export function verifyNowPaymentsSignature(payload, signature) {
  if (isPlaceholder(env.nowPaymentsIpnSecret) || !signature || !payload || typeof payload !== 'object') {
    return false;
  }
  const expected = crypto
    .createHmac('sha512', env.nowPaymentsIpnSecret)
    .update(JSON.stringify(sortObject(payload)))
    .digest('hex');
  const given = String(signature).trim().toLowerCase();
  return (
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

export async function handleCryptoIpn(payload, signature) {
  if (!cryptoConfigured()) return { ignored: true };
  if (!verifyNowPaymentsSignature(payload, signature)) {
    throw httpError(401, 'Invalid IPN signature');
  }

  const orderId = String(payload.order_id || '');
  if (!orderId) return { ignored: true };
  const payment = await prisma.payment.findUnique({ where: { id: orderId } });
  if (!payment || payment.provider !== 'nowpayments' || isMockPayment(payment)) {
    return { ignored: true };
  }

  const status = String(payload.payment_status || '');
  const raw = JSON.stringify(payload);
  if (status === 'finished' || status === 'confirmed') {
    await completePayment(payment.id, raw);
  } else if (status === 'partially_paid') {
    await markPaymentStatus(payment.id, 'partially_paid', raw);
  } else if (['waiting', 'confirming', 'sending'].includes(status)) {
    await markPaymentStatus(payment.id, 'processing', raw);
  } else if (status === 'failed' || status === 'expired') {
    await markPaymentStatus(payment.id, status, raw);
  } else if (status === 'refunded') {
    await prisma.payment.update({ where: { id: payment.id }, data: { status, rawPayload: raw } });
  }
  return { ok: true };
}

import Stripe from 'stripe';
import { env } from '../utils/env.js';
import { prisma } from '../utils/db.js';
import { activateSubscription } from './subscription.js';

function getStripe() {
  if (!env.stripeSecretKey || env.stripeSecretKey.includes('xxx')) return null;
  return new Stripe(env.stripeSecretKey);
}

export async function createStripeCheckout({ user, plan }) {
  const stripe = getStripe();
  if (!stripe) {
    // Dev fallback: mark payment pending and return mock URL
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        provider: 'stripe',
        amountCents: plan.priceCents,
        currency: plan.currency,
        status: 'pending',
        providerRef: `dev_stripe_${Date.now()}`,
      },
    });
    return {
      url: `${env.appUrl}/dashboard?mockPay=${payment.id}&provider=stripe`,
      paymentId: payment.id,
      mock: true,
    };
  }

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      planId: plan.id,
      provider: 'stripe',
      amountCents: plan.priceCents,
      currency: plan.currency,
      status: 'pending',
    },
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    line_items: [
      plan.stripePriceId
        ? { price: plan.stripePriceId, quantity: 1 }
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

export async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripe();
  if (!stripe) return { ignored: true };

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  } catch (err) {
    const e = new Error(`Webhook signature error: ${err.message}`);
    e.status = 400;
    throw e;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const paymentId = session.metadata?.paymentId;
    if (paymentId) {
      await completePayment(paymentId, JSON.stringify(session));
    }
  }
  return { received: true };
}

export async function completePayment(paymentId, rawPayload) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return null;
  if (payment.status === 'paid') return payment;

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'paid', rawPayload: rawPayload || null },
  });

  await activateSubscription(payment.userId, payment.planId);
  return payment;
}

export async function createCryptoInvoice({ user, plan }) {
  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      planId: plan.id,
      provider: 'nowpayments',
      amountCents: plan.priceCents,
      currency: plan.currency,
      status: 'pending',
    },
  });

  if (!env.nowPaymentsApiKey) {
    return {
      url: `${env.appUrl}/dashboard?mockPay=${payment.id}&provider=crypto`,
      paymentId: payment.id,
      mock: true,
    };
  }

  const base = env.nowPaymentsSandbox
    ? 'https://api-sandbox.nowpayments.io/v1'
    : 'https://api.nowpayments.io/v1';

  const res = await fetch(`${base}/invoice`, {
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
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NOWPayments error: ${text}`);
  }

  const data = await res.json();
  await prisma.payment.update({
    where: { id: payment.id },
    data: { providerRef: String(data.id || data.invoice_id || '') },
  });

  return { url: data.invoice_url, paymentId: payment.id };
}

export async function handleCryptoIpn(payload) {
  const orderId = payload.order_id;
  const status = payload.payment_status;
  if (!orderId) return { ignored: true };

  if (['finished', 'confirmed', 'finished'].includes(status) || status === 'finished') {
    await completePayment(orderId, JSON.stringify(payload));
  } else if (status === 'partially_paid' || status === 'confirming') {
    await prisma.payment.updateMany({
      where: { id: orderId },
      data: { status: 'processing', rawPayload: JSON.stringify(payload) },
    });
  } else if (status === 'failed' || status === 'expired' || status === 'refunded') {
    await prisma.payment.updateMany({
      where: { id: orderId },
      data: { status, rawPayload: JSON.stringify(payload) },
    });
  }
  return { ok: true };
}

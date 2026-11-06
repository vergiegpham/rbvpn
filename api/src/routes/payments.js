import { z } from 'zod';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../utils/db.js';
import { env } from '../utils/env.js';
import { createRouter } from '../utils/router.js';
import {
  createStripeCheckout,
  createCryptoInvoice,
  handleCryptoIpn,
  completePayment,
  isMockPayment,
  paymentProviders,
} from '../services/payments.js';

const router = createRouter();

router.get('/providers', (_req, res) => {
  res.json({ providers: paymentProviders() });
});

router.post('/checkout', authRequired, async (req, res) => {
  const schema = z.object({
    planCode: z.string(),
    provider: z.enum(['stripe', 'crypto']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  const plan = await prisma.plan.findFirst({
    where: { code: parsed.data.planCode, active: true },
  });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  const result =
    parsed.data.provider === 'stripe'
      ? await createStripeCheckout({ user, plan })
      : await createCryptoInvoice({ user, plan });

  res.json(result);
});

router.post('/crypto/ipn', async (req, res) => {
  const result = await handleCryptoIpn(req.body || {}, req.headers['x-nowpayments-sig']);
  res.json(result);
});

/** Test checkout only — requires ALLOW_MOCK_PAYMENTS=true and a payment created in mock mode. */
router.post('/mock/complete', authRequired, async (req, res) => {
  if (!env.allowMockPayments) {
    return res.status(403).json({ error: 'Test payments are disabled on this server.' });
  }
  const { paymentId } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: 'paymentId required' });
  const payment = await prisma.payment.findFirst({
    where: { id: String(paymentId), userId: req.user.sub },
  });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (!isMockPayment(payment)) {
    return res.status(400).json({ error: 'This payment can only be completed by the payment provider.' });
  }
  await completePayment(payment.id, JSON.stringify({ mock: true }));
  res.json({ ok: true });
});

export default router;

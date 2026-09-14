import { Router } from 'express';
import { z } from 'zod';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../utils/db.js';
import {
  createStripeCheckout,
  createCryptoInvoice,
  handleCryptoIpn,
  completePayment,
} from '../services/payments.js';

const router = Router();

router.post('/checkout', authRequired, async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/crypto/ipn', async (req, res) => {
  try {
    const result = await handleCryptoIpn(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Dev-only helper when Stripe/NOWPayments keys are not configured */
router.post('/mock/complete', authRequired, async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: 'paymentId required' });
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: req.user.sub },
  });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  await completePayment(payment.id, JSON.stringify({ mock: true }));
  res.json({ ok: true });
});

router.get('/mine', authRequired, async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { userId: req.user.sub },
    include: { plan: { select: { name: true, code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json({ payments });
});

export default router;

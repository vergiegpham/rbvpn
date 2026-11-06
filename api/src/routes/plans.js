import { prisma } from '../utils/db.js';
import { authRequired } from '../middleware/auth.js';
import { createRouter } from '../utils/router.js';
import { getActiveSubscription } from '../services/subscription.js';

const router = createRouter();

router.get('/', async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { priceCents: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      priceCents: true,
      currency: true,
      durationDays: true,
      maxDevices: true,
    },
  });
  res.json({ plans });
});

router.get('/subscription', authRequired, async (req, res) => {
  const sub = await getActiveSubscription(req.user.sub);
  res.json({ subscription: sub });
});

export default router;

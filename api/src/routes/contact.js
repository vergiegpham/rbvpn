import { z } from 'zod';
import { prisma } from '../utils/db.js';
import { createRouter } from '../utils/router.js';
import { createRateLimiter } from '../utils/rate-limit.js';

const router = createRouter();

const perIp = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

router.post('/', async (req, res) => {
  if (perIp.hit(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'Too many messages. Please try again later.' });
  }

  const schema = z.object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(120),
    subject: z.string().trim().min(1).max(120),
    message: z.string().trim().min(10).max(4000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please fill in all fields with a valid email and message.' });
  }

  const msg = await prisma.contactMessage.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      subject: parsed.data.subject,
      message: parsed.data.message,
      status: 'new',
    },
  });

  res.status(201).json({ ok: true, id: msg.id });
});

export default router;

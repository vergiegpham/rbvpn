import { z } from 'zod';
import { prisma } from '../utils/db.js';
import { createRouter } from '../utils/router.js';
import { createRateLimiter } from '../utils/rate-limit.js';
import { hashPassword, verifyPassword, PASSWORD_MAX, PASSWORD_MIN } from '../utils/passwords.js';
import { signToken, authRequired } from '../middleware/auth.js';

const router = createRouter();

const loginPerIp = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const loginFailuresPerEmail = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const registerPerIp = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

router.post('/register', async (req, res) => {
  if (registerPerIp.hit(req.ip)) return res.status(429).json({ error: TOO_MANY });

  const schema = z.object({
    email: z.string().trim().email().max(120),
    password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
    name: z.string().trim().min(1).max(80).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: `Enter a valid email and a password of ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`,
    });
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(parsed.data.password),
      name: parsed.data.name || email.split('@')[0],
    },
  });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email or password' });

  const email = parsed.data.email.toLowerCase();
  if (loginPerIp.hit(req.ip) || loginFailuresPerEmail.blocked(email)) {
    return res.status(429).json({ error: TOO_MANY });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!ok) {
    loginFailuresPerEmail.hit(email);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  loginFailuresPerEmail.reset(email);

  if (user.suspended) {
    return res.status(403).json({ error: 'Account suspended. Contact support.' });
  }

  res.json({ token: signToken(user), user: { ...publicUser(user), suspended: false } });
});

router.get('/me', authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      suspended: true,
      createdAt: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.post('/change-password', authRequired, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: `New password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`,
    });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (loginFailuresPerEmail.blocked(user.email)) return res.status(429).json({ error: TOO_MANY });

  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    loginFailuresPerEmail.hit(user.email);
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return res.status(400).json({ error: 'New password must be different from the current one' });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      passwordChangedAt: new Date(),
    },
  });

  // Other sessions are signed out; this one continues with a fresh token.
  res.json({ ok: true, token: signToken(updated), user: publicUser(updated) });
});

export default router;

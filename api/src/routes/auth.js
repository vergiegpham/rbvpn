import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../utils/db.js';
import { signToken, authRequired } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1).max(80).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: parsed.data.name || email.split('@')[0],
    },
  });

  const token = signToken(user);
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

router.post('/login', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid credentials' });

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  if (user.suspended) {
    return res.status(403).json({ error: 'Account suspended. Contact support.' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      suspended: false,
    },
  });
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

export default router;

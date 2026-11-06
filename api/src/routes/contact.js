import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/db.js';

const router = Router();

// Simple in-memory rate limit: max 5 messages per IP per 10 minutes
const recent = new Map();

function tooMany(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (recent.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= 5) {
    recent.set(ip, list);
    return true;
  }
  list.push(now);
  recent.set(ip, list);
  return false;
}

router.post('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || 'unknown';
  if (tooMany(ip)) {
    return res.status(429).json({ error: 'Too many messages. Please try again later.' });
  }

  const schema = z.object({
    name: z.string().min(1).max(80),
    email: z.string().email().max(120),
    subject: z.string().min(1).max(120),
    message: z.string().min(10).max(4000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please fill in all fields with a valid email and message.' });
  }

  const msg = await prisma.contactMessage.create({
    data: {
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      subject: parsed.data.subject.trim(),
      message: parsed.data.message.trim(),
      status: 'new',
    },
  });

  res.status(201).json({ ok: true, id: msg.id });
});

export default router;

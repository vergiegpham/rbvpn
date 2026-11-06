import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../utils/env.js';
import { prisma } from '../utils/db.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.jwtSecret,
    { expiresIn: '30d' }
  );
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, suspended: true, passwordChangedAt: true },
  });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  // Second granularity: `iat` is whole seconds, and the token issued by a password change must stay valid.
  if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    return res.status(401).json({ error: 'Password was changed. Please sign in again.' });
  }
  if (user.suspended) {
    return res.status(403).json({ error: 'Account suspended. Contact support.' });
  }
  req.user = { sub: user.id, email: user.email, role: user.role };
  next();
}

export function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function nodeAgentRequired(req, res, next) {
  const secret = req.headers['x-node-agent-secret'];
  if (!secret || !safeEqual(secret, env.nodeAgentSecret)) {
    return res.status(401).json({ error: 'Invalid node agent secret' });
  }
  next();
}

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
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, suspended: true },
    });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.suspended) {
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }
    req.user = { sub: user.id, email: user.email, role: user.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

export function nodeAgentRequired(req, res, next) {
  const secret = req.headers['x-node-agent-secret'];
  if (!secret || secret !== env.nodeAgentSecret) {
    return res.status(401).json({ error: 'Invalid node agent secret' });
  }
  next();
}

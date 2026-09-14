import jwt from 'jsonwebtoken';
import { env } from '../utils/env.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.jwtSecret,
    { expiresIn: '30d' }
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, env.jwtSecret);
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

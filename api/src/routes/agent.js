import { Router } from 'express';
import { z } from 'zod';
import { nodeAgentRequired, authRequired, adminRequired } from '../middleware/auth.js';
import { prisma } from '../utils/db.js';

const router = Router();

/** Node agent pulls peers that need to be added/removed on WireGuard */
router.get('/peers', nodeAgentRequired, async (req, res) => {
  const nodeId = req.query.nodeId;
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });

  const node = await prisma.vpnNode.findUnique({ where: { id: nodeId } });
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const pending = await prisma.device.findMany({
    where: {
      nodeId,
      syncStatus: { in: ['pending', 'delete_pending'] },
    },
    select: {
      id: true,
      clientPublicKey: true,
      clientIp: true,
      syncStatus: true,
    },
  });

  res.json({
    node: {
      id: node.id,
      interfaceName: node.interfaceName,
      gatewayIp: node.gatewayIp,
      publicPort: node.publicPort,
    },
    peers: pending,
  });
});

router.post('/peers/ack', nodeAgentRequired, async (req, res) => {
  const schema = z.object({
    applied: z.array(z.string()).default([]),
    deleted: z.array(z.string()).default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  if (parsed.data.applied.length) {
    await prisma.device.updateMany({
      where: { id: { in: parsed.data.applied } },
      data: { syncStatus: 'synced', lastSeenAt: new Date() },
    });
  }
  if (parsed.data.deleted.length) {
    await prisma.device.deleteMany({
      where: { id: { in: parsed.data.deleted } },
    });
  }
  res.json({ ok: true });
});

router.post('/register-node', authRequired, adminRequired, async (req, res) => {
  const schema = z.object({
    name: z.string(),
    region: z.string(),
    publicHost: z.string(),
    publicPort: z.number().int().default(51820),
    publicKey: z.string(),
    interfaceName: z.string().default('wg0'),
    subnetCidr: z.string().default('10.10.0.0/24'),
    gatewayIp: z.string().default('10.10.0.1'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const node = await prisma.vpnNode.create({ data: parsed.data });
  res.status(201).json({ node });
});

router.get('/nodes', authRequired, adminRequired, async (_req, res) => {
  const nodes = await prisma.vpnNode.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ nodes });
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { nodeAgentRequired } from '../middleware/auth.js';
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
      syncStatus: { in: ['pending', 'delete_pending', 'release_pending'] },
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
    const rows = await prisma.device.findMany({
      where: { id: { in: parsed.data.deleted } },
      select: { id: true, syncStatus: true },
    });
    const toRelease = rows.filter((r) => r.syncStatus === 'release_pending').map((r) => r.id);
    const toDelete = rows.filter((r) => r.syncStatus !== 'release_pending').map((r) => r.id);

    // Disconnect: free IP, keep device identity for next connect.
    if (toRelease.length) {
      await prisma.device.updateMany({
        where: { id: { in: toRelease } },
        data: { syncStatus: 'idle', clientIp: null },
      });
    }
    // Hard delete / node switch ghost peers.
    if (toDelete.length) {
      await prisma.device.deleteMany({
        where: { id: { in: toDelete } },
      });
    }
  }
  res.json({ ok: true });
});

export default router;

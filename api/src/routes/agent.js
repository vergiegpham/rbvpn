import { z } from 'zod';
import { nodeAgentRequired } from '../middleware/auth.js';
import { prisma } from '../utils/db.js';
import { createRouter } from '../utils/router.js';

const router = createRouter();

// A peer with a handshake this recent counts as an active session.
const ACTIVE_HANDSHAKE_SECONDS = 5 * 60;

/**
 * Node agent pulls peers to add/remove on WireGuard.
 * `full=1` also returns already-synced peers so the agent can restore them after a reboot
 * and prune peers the API no longer knows about.
 */
router.get('/peers', nodeAgentRequired, async (req, res) => {
  const nodeId = String(req.query.nodeId || '');
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });
  const full = req.query.full === '1';

  const node = await prisma.vpnNode.findUnique({ where: { id: nodeId } });
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const statuses = ['pending', 'delete_pending', 'release_pending'];
  if (full) statuses.push('synced');

  const peers = await prisma.device.findMany({
    where: { nodeId, syncStatus: { in: statuses } },
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
    // Agents only prune unknown peers when the API confirms this is the complete peer list.
    full,
    peers,
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
    // Only promote rows still waiting; a disconnect may have raced the agent.
    await prisma.device.updateMany({
      where: { id: { in: parsed.data.applied }, syncStatus: 'pending' },
      data: { syncStatus: 'synced', lastSeenAt: new Date() },
    });
  }
  if (parsed.data.deleted.length) {
    const rows = await prisma.device.findMany({
      where: { id: { in: parsed.data.deleted } },
      select: { id: true, syncStatus: true },
    });
    const toRelease = rows.filter((r) => r.syncStatus === 'release_pending').map((r) => r.id);
    const toDelete = rows.filter((r) => r.syncStatus === 'delete_pending').map((r) => r.id);

    // Disconnect: free IP, keep device identity for next connect.
    if (toRelease.length) {
      await prisma.device.updateMany({
        where: { id: { in: toRelease }, syncStatus: 'release_pending' },
        data: { syncStatus: 'idle', clientIp: null },
      });
    }
    // Hard delete / node switch ghost peers.
    if (toDelete.length) {
      await prisma.device.deleteMany({
        where: { id: { in: toDelete }, syncStatus: 'delete_pending' },
      });
    }
  }
  res.json({ ok: true });
});

/** Heartbeat: marks the agent alive and refreshes lastSeenAt for peers with recent handshakes. */
router.post('/report', nodeAgentRequired, async (req, res) => {
  const schema = z.object({
    nodeId: z.string().min(1),
    handshakes: z.record(z.string(), z.number()).default({}),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  const { nodeId, handshakes } = parsed.data;
  const now = new Date();
  const updated = await prisma.vpnNode.updateMany({
    where: { id: nodeId },
    data: { agentSeenAt: now },
  });
  if (!updated.count) return res.status(404).json({ error: 'Node not found' });

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const activeKeys = Object.entries(handshakes)
    .filter(([, at]) => at > 0 && nowSeconds - at < ACTIVE_HANDSHAKE_SECONDS)
    .map(([key]) => key);

  if (activeKeys.length) {
    await prisma.device.updateMany({
      where: {
        nodeId,
        clientPublicKey: { in: activeKeys },
        syncStatus: 'synced',
        // Skip rows refreshed within the last minute to keep writes low.
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - 60 * 1000) } }],
      },
      data: { lastSeenAt: now },
    });
  }
  res.json({ ok: true, active: activeKeys.length });
});

export default router;

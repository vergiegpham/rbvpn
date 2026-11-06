import { Router } from 'express';
import { z } from 'zod';
import { authRequired } from '../middleware/auth.js';
import {
  listUserDevices,
  createDevice,
  deleteDevice,
  getDeviceConfig,
  switchDeviceNode,
  startDeviceSession,
  endDeviceSession,
} from '../services/devices.js';
import { prisma } from '../utils/db.js';

const router = Router();

function deviceDto(device) {
  return {
    id: device.id,
    name: device.name,
    clientIp: device.clientIp,
    syncStatus: device.syncStatus,
    createdAt: device.createdAt,
    node: device.node
      ? {
          id: device.node.id,
          name: device.node.name,
          region: device.node.region,
        }
      : undefined,
  };
}

router.get('/nodes/list', authRequired, async (_req, res) => {
  const nodes = await prisma.vpnNode.findMany({
    where: { active: true },
    select: { id: true, name: true, region: true, publicHost: true },
    orderBy: [{ region: 'asc' }, { name: 'asc' }],
  });
  res.json({ nodes });
});

router.get('/', authRequired, async (req, res) => {
  const devices = await listUserDevices(req.user.sub);
  res.json({ devices: devices.map(deviceDto) });
});

router.post('/', authRequired, async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(80).optional(),
      nodeId: z.string().optional(),
      replace: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

    const device = await createDevice(req.user.sub, parsed.data);
    res.status(201).json({ device: deviceDto(device) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/node', authRequired, async (req, res) => {
  try {
    const schema = z.object({ nodeId: z.string().min(1) });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'nodeId required' });

    const device = await switchDeviceNode(req.user.sub, req.params.id, parsed.data.nodeId);
    res.json({ device: deviceDto(device) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** Server allocates a free IP and queues the WireGuard peer on the node. */
router.post('/:id/connect', authRequired, async (req, res) => {
  try {
    const config = await startDeviceSession(req.user.sub, req.params.id);
    res.json(config);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** Server frees the IP and removes the peer from the node (device stays registered). */
router.post('/:id/disconnect', authRequired, async (req, res) => {
  try {
    const result = await endDeviceSession(req.user.sub, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id/config', authRequired, async (req, res) => {
  try {
    const config = await getDeviceConfig(req.user.sub, req.params.id);
    res.json(config);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await deleteDevice(req.user.sub, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { authRequired } from '../middleware/auth.js';
import {
  listUserDevices,
  createDevice,
  deleteDevice,
  getDeviceConfig,
} from '../services/devices.js';
import { prisma } from '../utils/db.js';

const router = Router();

router.get('/nodes/list', authRequired, async (_req, res) => {
  const nodes = await prisma.vpnNode.findMany({
    where: { active: true },
    select: { id: true, name: true, region: true, publicHost: true },
    orderBy: { name: 'asc' },
  });
  res.json({ nodes });
});

router.get('/', authRequired, async (req, res) => {
  const devices = await listUserDevices(req.user.sub);
  res.json({
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      clientIp: d.clientIp,
      syncStatus: d.syncStatus,
      createdAt: d.createdAt,
      node: d.node,
    })),
  });
});

router.post('/', authRequired, async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(80).optional(),
      nodeId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

    const device = await createDevice(req.user.sub, parsed.data);
    res.status(201).json({
      device: {
        id: device.id,
        name: device.name,
        clientIp: device.clientIp,
        syncStatus: device.syncStatus,
        node: {
          id: device.node.id,
          name: device.node.name,
          region: device.node.region,
        },
      },
    });
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

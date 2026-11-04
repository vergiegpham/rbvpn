import { z } from 'zod';
import { authRequired } from '../middleware/auth.js';
import { createRouter } from '../utils/router.js';
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

const router = createRouter();

function deviceDto(device) {
  return {
    id: device.id,
    name: device.name,
    clientIp: device.clientIp,
    syncStatus: device.syncStatus,
    lastSeenAt: device.lastSeenAt,
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
  const schema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    nodeId: z.string().optional(),
    replace: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  const device = await createDevice(req.user.sub, parsed.data);
  res.status(201).json({ device: deviceDto(device) });
});

router.post('/:id/node', authRequired, async (req, res) => {
  const schema = z.object({ nodeId: z.string().min(1) });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'nodeId required' });

  const device = await switchDeviceNode(req.user.sub, req.params.id, parsed.data.nodeId);
  res.json({ device: deviceDto(device) });
});

/** Server allocates a free IP and queues the WireGuard peer on the node. */
router.post('/:id/connect', authRequired, async (req, res) => {
  const config = await startDeviceSession(req.user.sub, req.params.id);
  res.json(config);
});

/** Server frees the IP and removes the peer from the node (device stays registered). */
router.post('/:id/disconnect', authRequired, async (req, res) => {
  const result = await endDeviceSession(req.user.sub, req.params.id);
  res.json(result);
});

router.get('/:id/config', authRequired, async (req, res) => {
  const config = await getDeviceConfig(req.user.sub, req.params.id);
  res.json(config);
});

router.delete('/:id', authRequired, async (req, res) => {
  await deleteDevice(req.user.sub, req.params.id);
  res.json({ ok: true });
});

export default router;

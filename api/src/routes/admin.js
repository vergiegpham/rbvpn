import { z } from 'zod';
import { authRequired, adminRequired } from '../middleware/auth.js';
import { prisma } from '../utils/db.js';
import { createRouter } from '../utils/router.js';
import { generatePassword, hashPassword } from '../utils/passwords.js';
import { activateSubscription } from '../services/subscription.js';
import { releaseUserSessions } from '../services/sessions.js';

const router = createRouter();
router.use(authRequired, adminRequired);

const LIVE_SESSION_WHERE = { clientIp: { not: null }, syncStatus: { in: ['pending', 'synced'] } };

router.get('/stats', async (_req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [users, activeSubs, devices, nodes, paymentsPaid, dailyRevenue, monthlyRevenue] =
    await Promise.all([
      prisma.user.count(),
      prisma.subscription.count({
        where: { status: 'active', endsAt: { gt: now } },
      }),
      prisma.device.count(),
      prisma.vpnNode.count({ where: { active: true } }),
      prisma.payment.count({ where: { status: 'paid' } }),
      prisma.payment.aggregate({
        where: { status: 'paid', createdAt: { gte: startOfDay } },
        _sum: { amountCents: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'paid', createdAt: { gte: startOfMonth } },
        _sum: { amountCents: true },
      }),
    ]);
  res.json({
    stats: {
      users,
      activeSubscriptions: activeSubs,
      devices,
      activeNodes: nodes,
      paidPayments: paymentsPaid,
      dailyRevenueCents: dailyRevenue._sum.amountCents || 0,
      monthlyRevenueCents: monthlyRevenue._sum.amountCents || 0,
    },
  });
});

router.get('/users', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      suspended: true,
      suspendedAt: true,
      createdAt: true,
      subscriptions: {
        where: { status: 'active' },
        orderBy: { endsAt: 'desc' },
        take: 1,
        include: { plan: { select: { name: true, code: true } } },
      },
      _count: { select: { devices: true, payments: true } },
    },
  });
  res.json({ users });
});

router.patch('/users/:id', async (req, res) => {
  const schema = z.object({
    role: z.enum(['user', 'admin']).optional(),
    name: z.string().min(1).max(80).optional(),
    suspended: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  if (parsed.data.suspended === true && req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'You cannot suspend your own account' });
  }

  const data = { ...parsed.data };
  if (parsed.data.suspended === true) {
    data.suspendedAt = new Date();
  } else if (parsed.data.suspended === false) {
    data.suspendedAt = null;
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      suspended: true,
      suspendedAt: true,
    },
  });

  if (parsed.data.suspended === true) {
    await prisma.device.updateMany({
      where: { userId: user.id, syncStatus: { not: 'delete_pending' } },
      data: { syncStatus: 'delete_pending' },
    });
  } else if (parsed.data.suspended === false) {
    await prisma.device.updateMany({
      where: { userId: user.id, syncStatus: 'delete_pending' },
      data: { syncStatus: 'idle', clientIp: null },
    });
  }

  res.json({ user });
});

router.post('/users/:id/suspend', async (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'You cannot suspend your own account' });
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { suspended: true, suspendedAt: new Date() },
    select: { id: true, email: true, suspended: true, suspendedAt: true },
  });
  await prisma.device.updateMany({
    where: { userId: user.id, syncStatus: { not: 'delete_pending' } },
    data: { syncStatus: 'delete_pending' },
  });
  res.json({ user, ok: true });
});

router.post('/users/:id/unsuspend', async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { suspended: false, suspendedAt: null },
    select: { id: true, email: true, suspended: true, suspendedAt: true },
  });
  await prisma.device.updateMany({
    where: { userId: user.id, syncStatus: 'delete_pending' },
    data: { syncStatus: 'idle', clientIp: null },
  });
  res.json({ user, ok: true });
});

/** Sets a random temporary password and signs the user out everywhere. */
router.post('/users/:id/reset-password', async (req, res) => {
  const temporaryPassword = generatePassword();
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { passwordHash: await hashPassword(temporaryPassword), passwordChangedAt: new Date() },
    select: { id: true, email: true },
  });
  res.json({ ok: true, user, temporaryPassword });
});

router.delete('/users/:id', async (req, res) => {
  const userId = req.params.id;

  if (userId === req.user.sub) {
    return res.status(400).json({ error: 'You cannot delete your own account from admin' });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.role === 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin account' });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.device.updateMany({
      where: { userId },
      data: { syncStatus: 'delete_pending' },
    });
    await tx.user.delete({ where: { id: userId } });
  });

  res.json({ ok: true, deleted: user.email });
});

router.post('/users/:id/subscription', async (req, res) => {
  const schema = z.object({ planCode: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'planCode required' });

  const plan = await prisma.plan.findFirst({
    where: { code: parsed.data.planCode, active: true },
  });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const sub = await activateSubscription(req.params.id, plan.id);
  res.status(201).json({ subscription: sub });
});

router.post('/users/:id/subscription/cancel', async (req, res) => {
  const cancelled = await prisma.subscription.updateMany({
    where: { userId: req.params.id, status: 'active' },
    data: { status: 'cancelled' },
  });
  const released = await releaseUserSessions(req.params.id);
  res.json({ ok: true, cancelled: cancelled.count, releasedSessions: released });
});

router.get('/subscriptions', async (_req, res) => {
  const subs = await prisma.subscription.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      user: { select: { id: true, email: true, name: true } },
      plan: { select: { name: true, code: true } },
    },
  });
  res.json({ subscriptions: subs });
});

router.get('/payments', async (_req, res) => {
  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      user: { select: { id: true, email: true } },
      plan: { select: { name: true, code: true } },
    },
  });
  res.json({ payments });
});

router.get('/devices', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const liveOnly = req.query.live === '1';
  const devices = await prisma.device.findMany({
    where: {
      syncStatus: { not: 'delete_pending' },
      ...(liveOnly ? LIVE_SESSION_WHERE : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { clientIp: { contains: q } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      name: true,
      clientIp: true,
      syncStatus: true,
      lastSeenAt: true,
      createdAt: true,
      user: { select: { id: true, email: true } },
      node: { select: { id: true, name: true, region: true } },
    },
  });
  res.json({ devices });
});

/** Free the device's VPN IP. The device can connect again. */
router.post('/devices/:id/disconnect', async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (device.clientIp && ['pending', 'synced'].includes(device.syncStatus)) {
    await prisma.device.update({ where: { id: device.id }, data: { syncStatus: 'release_pending' } });
    return res.json({ ok: true, released: true });
  }
  res.json({ ok: true, released: false });
});

router.delete('/devices/:id', async (req, res) => {
  await prisma.device.update({ where: { id: req.params.id }, data: { syncStatus: 'delete_pending' } });
  res.json({ ok: true });
});

router.get('/plans', async (_req, res) => {
  const plans = await prisma.plan.findMany({ orderBy: { priceCents: 'asc' } });
  res.json({ plans });
});

router.patch('/plans/:id', async (req, res) => {
  const schema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    priceCents: z.number().int().positive().optional(),
    durationDays: z.number().int().positive().optional(),
    maxDevices: z.number().int().positive().optional(),
    active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  const plan = await prisma.plan.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json({ plan });
});

router.get('/nodes', async (_req, res) => {
  const [nodes, live] = await Promise.all([
    prisma.vpnNode.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { devices: true } } },
    }),
    prisma.device.groupBy({ by: ['nodeId'], where: LIVE_SESSION_WHERE, _count: { _all: true } }),
  ]);
  const liveByNode = new Map(live.map((row) => [row.nodeId, row._count._all]));
  res.json({
    nodes: nodes.map((n) => ({ ...n, liveSessions: liveByNode.get(n.id) || 0 })),
  });
});

router.post('/nodes', async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    region: z.string().min(1),
    publicHost: z.string().min(1),
    publicPort: z.coerce.number().int().default(51820),
    publicKey: z.string().min(1),
    interfaceName: z.string().default('wg0'),
    subnetCidr: z.string().default('10.10.0.0/24'),
    gatewayIp: z.string().default('10.10.0.1'),
    capacity: z.coerce.number().int().positive().default(250),
    active: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid node fields. Check name, host, and public key.' });
  }

  const node = await prisma.vpnNode.create({ data: parsed.data });
  res.status(201).json({ node });
});

router.patch('/nodes/:id', async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    publicHost: z.string().min(1).optional(),
    publicPort: z.coerce.number().int().optional(),
    publicKey: z.string().min(1).optional(),
    interfaceName: z.string().optional(),
    subnetCidr: z.string().optional(),
    gatewayIp: z.string().optional(),
    capacity: z.coerce.number().int().positive().optional(),
    active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  const node = await prisma.vpnNode.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json({ node });
});

router.delete('/nodes/:id', async (req, res) => {
  const nodeId = req.params.id;
  const deviceCount = await prisma.device.count({
    where: { nodeId, syncStatus: { not: 'delete_pending' } },
  });
  if (deviceCount > 0) {
    return res.status(400).json({
      error: `Cannot delete node with ${deviceCount} active device(s). Move or remove them first.`,
    });
  }
  await prisma.device.deleteMany({ where: { nodeId } });
  await prisma.vpnNode.delete({ where: { id: nodeId } });
  res.json({ ok: true });
});

function nextSubnet(existing) {
  const used = new Set(existing.map((n) => n.subnetCidr));
  for (let i = 0; i < 250; i++) {
    const subnetCidr = `10.10.${i}.0/24`;
    if (!used.has(subnetCidr)) {
      return { subnetCidr, gatewayIp: `10.10.${i}.1` };
    }
  }
  throw new Error('No free 10.10.x.0/24 subnet left');
}

router.get('/interserver/status', async (_req, res) => {
  const { interserverConfigured } = await import('../services/interserver.js');
  res.json({ configured: interserverConfigured() });
});

router.get('/interserver/catalog', async (_req, res) => {
  try {
    const { getCatalog } = await import('../services/interserver.js');
    const catalog = await getCatalog();
    res.json(catalog);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.get('/interserver/services', async (_req, res) => {
  try {
    const { listVpsServices } = await import('../services/interserver.js');
    const services = await listVpsServices();
    res.json({ services });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/interserver/validate', async (req, res) => {
  const schema = z.object({
    os: z.string().min(1),
    version: z.string().min(1),
    slices: z.coerce.number().int().min(1).max(32),
    platform: z.string().min(1),
    controlpanel: z.string().default('none'),
    period: z.coerce.number().int().min(1).max(36).default(1),
    location: z.coerce.number().int().positive(),
    hostname: z.string().min(1),
    coupon: z.string().optional(),
    rootpass: z.string().min(8).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid order fields' });

  try {
    const { validateBuyVps, generateRootPassword } = await import('../services/interserver.js');
    const rootpass = parsed.data.rootpass || generateRootPassword();
    const result = await validateBuyVps({ ...parsed.data, rootpass });
    res.json({ result, rootpassPreview: rootpass ? '(generated)' : null });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/interserver/purchase', async (req, res) => {
  const schema = z.object({
    quantity: z.coerce.number().int().min(1).max(20).default(1),
    os: z.string().min(1),
    version: z.string().min(1),
    slices: z.coerce.number().int().min(1).max(32).default(1),
    platform: z.string().min(1).default('kvm'),
    controlpanel: z.string().default('none'),
    period: z.coerce.number().int().min(1).max(36).default(1),
    location: z.coerce.number().int().positive(),
    hostnamePrefix: z.string().min(1).max(40),
    regionLabel: z.string().min(1).optional(),
    coupon: z.string().optional().default(''),
    namePrefix: z.string().min(1).optional(),
    capacity: z.coerce.number().int().positive().default(250),
    waitForIp: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid purchase fields', detail: parsed.error.flatten() });
  }

  const {
    validateBuyVps,
    buyVps,
    generateRootPassword,
    findServiceByHostname,
    getCatalog,
  } = await import('../services/interserver.js');

  try {
    const data = parsed.data;
    const catalog = await getCatalog();
    const locationName =
      data.regionLabel ||
      catalog.locations.find((l) => l.id === data.location)?.name ||
      `loc-${data.location}`;

    const prefix = data.hostnamePrefix
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const namePrefix = (data.namePrefix || prefix).slice(0, 40);

    // Validate first order shape before charging multiple times
    const samplePass = generateRootPassword();
    const sampleHost = `${prefix}-1`;
    const validation = await validateBuyVps({
      os: data.os,
      version: data.version,
      slices: data.slices,
      platform: data.platform,
      controlpanel: data.controlpanel,
      period: data.period,
      location: data.location,
      hostname: sampleHost,
      coupon: data.coupon,
      rootpass: samplePass,
    });
    const status = String(validation?.status || '').toLowerCase();
    if (status && status !== 'ok') {
      return res.status(400).json({
        error: validation?.status_text || 'InterServer order validation failed',
        validation,
      });
    }

    const existing = await prisma.vpnNode.findMany({ select: { subnetCidr: true } });
    const usedSubnets = [...existing];
    const orders = [];
    const credentials = [];

    for (let i = 1; i <= data.quantity; i++) {
      const hostname = `${prefix}-${i}`;
      const rootpass = generateRootPassword();
      const buyResult = await buyVps({
        os: data.os,
        version: data.version,
        slices: data.slices,
        platform: data.platform,
        controlpanel: data.controlpanel,
        period: data.period,
        location: data.location,
        hostname,
        coupon: data.coupon,
        rootpass,
      });

      const buyStatus = String(buyResult?.status || '').toLowerCase();
      if (buyStatus === 'error' || (buyStatus && buyStatus !== 'ok')) {
        orders.push({
          hostname,
          ok: false,
          error: buyResult?.status_text || 'Buy failed',
          buyResult,
        });
        continue;
      }

      let service = null;
      if (data.waitForIp) {
        service = await findServiceByHostname(hostname, { attempts: 8, delayMs: 4000 });
      }

      const subnet = nextSubnet(usedSubnets);
      usedSubnets.push(subnet);

      const node = await prisma.vpnNode.create({
        data: {
          name: `${namePrefix} ${i}`,
          region: locationName,
          publicHost: service?.ip || 'pending',
          publicPort: 51820,
          publicKey: 'REPLACE_WITH_SERVER_PUBLIC_KEY',
          interfaceName: 'wg0',
          subnetCidr: subnet.subnetCidr,
          gatewayIp: subnet.gatewayIp,
          capacity: data.capacity,
          active: false,
          provider: 'interserver',
          providerRef: service?.vpsId ? String(service.vpsId) : null,
          provisionStatus: service?.ip ? 'ordered' : 'provisioning',
          providerMeta: JSON.stringify({
            hostname,
            slices: data.slices,
            platform: data.platform,
            locationId: data.location,
            invoices: buyResult?.invoices || null,
            cost: buyResult?.cost ?? validation?.monthly_service_cost ?? null,
            orderedAt: new Date().toISOString(),
          }),
        },
      });

      credentials.push({ nodeId: node.id, hostname, rootPassword: rootpass, ip: service?.ip || null });
      orders.push({
        hostname,
        ok: true,
        node,
        buyResult,
        service,
      });
    }

    res.status(201).json({
      ok: true,
      validation,
      orders,
      credentials,
      note:
        'Save root passwords now — they are not stored. Install WireGuard + vpn-agent on each VPS, then set publicKey and enable the node.',
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/interserver/import-services', async (req, res) => {
  try {
    const { listVpsServices } = await import('../services/interserver.js');
    const services = await listVpsServices();
    const existing = await prisma.vpnNode.findMany({
      where: { provider: 'interserver' },
      select: { providerRef: true, subnetCidr: true, publicHost: true },
    });
    const knownRefs = new Set(existing.map((n) => n.providerRef).filter(Boolean));
    const knownHosts = new Set(existing.map((n) => n.publicHost));
    const usedSubnets = await prisma.vpnNode.findMany({ select: { subnetCidr: true } });

    const created = [];
    for (const svc of services) {
      if (!svc.ip || !svc.vpsId) continue;
      if (knownRefs.has(String(svc.vpsId)) || knownHosts.has(svc.ip)) continue;
      const subnet = nextSubnet(usedSubnets);
      usedSubnets.push(subnet);
      const node = await prisma.vpnNode.create({
        data: {
          name: svc.hostname || `InterServer ${svc.vpsId}`,
          region: 'interserver',
          publicHost: svc.ip,
          publicPort: 51820,
          publicKey: 'REPLACE_WITH_SERVER_PUBLIC_KEY',
          subnetCidr: subnet.subnetCidr,
          gatewayIp: subnet.gatewayIp,
          active: false,
          provider: 'interserver',
          providerRef: String(svc.vpsId),
          provisionStatus: 'imported',
          providerMeta: JSON.stringify(svc),
        },
      });
      knownRefs.add(String(svc.vpsId));
      knownHosts.add(svc.ip);
      created.push(node);
    }
    res.json({ created, count: created.length });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.get('/messages', async (req, res) => {
  const status = String(req.query.status || '').trim();
  const messages = await prisma.contactMessage.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const unread = await prisma.contactMessage.count({ where: { status: 'new' } });
  res.json({ messages, unread });
});

router.patch('/messages/:id', async (req, res) => {
  const schema = z.object({
    status: z.enum(['new', 'read', 'replied', 'archived']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid status' });

  const message = await prisma.contactMessage.update({
    where: { id: req.params.id },
    data: { status: parsed.data.status },
  });
  res.json({ message });
});

router.delete('/messages/:id', async (req, res) => {
  await prisma.contactMessage.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;

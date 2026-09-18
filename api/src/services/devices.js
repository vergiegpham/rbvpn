import { prisma } from '../utils/db.js';
import { generateWireGuardKeyPair, ipFromIndex, buildClientConfig } from '../utils/wireguard.js';
import { getActiveSubscription } from './subscription.js';

const ACTIVE_PEER_STATUSES = ['pending', 'synced', 'release_pending'];

/** Interactive transactions default to 5s — too tight under lock wait / slow disk. */
const TX_OPTS = { maxWait: 15000, timeout: 20000 };

/** Pick the next free client IP on a node (skips gateway + currently assigned peers). */
async function allocateClientIp(tx, node) {
  const used = new Set(
    (
      await tx.device.findMany({
        where: {
          nodeId: node.id,
          clientIp: { not: null },
        },
        select: { clientIp: true },
      })
    )
      .map((d) => d.clientIp)
      .filter(Boolean)
  );
  used.add(node.gatewayIp);

  let index = Math.max(2, Number(node.nextClientIp) || 2);
  for (let n = 0; n < 253; n += 1) {
    if (index < 2 || index > 254) index = 2;
    const clientIp = ipFromIndex(node.gatewayIp, index);
    if (!used.has(clientIp)) {
      await tx.vpnNode.update({
        where: { id: node.id },
        data: { nextClientIp: index + 1 > 254 ? 2 : index + 1 },
      });
      return clientIp;
    }
    index += 1;
  }

  const err = new Error('No free client IPs on this node');
  err.status = 503;
  throw err;
}

async function countActivePeersOnNode(tx, nodeId) {
  return tx.device.count({
    where: {
      nodeId,
      clientIp: { not: null },
      syncStatus: { in: ACTIVE_PEER_STATUSES },
    },
  });
}

export async function listUserDevices(userId) {
  return prisma.device.findMany({
    where: { userId, syncStatus: { not: 'delete_pending' } },
    include: {
      node: {
        select: {
          id: true,
          name: true,
          region: true,
          publicHost: true,
          publicPort: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Register a device identity (keys + node). IP is assigned later on connect. */
export async function createDevice(
  userId,
  { name = 'Windows PC', nodeId, replace = false } = {}
) {
  const sub = await getActiveSubscription(userId);
  if (!sub) {
    const err = new Error('Active subscription required');
    err.status = 402;
    throw err;
  }

  const maxDevices = sub.plan.maxDevices;

  // Free slots when replacing (e.g. Basic 1-device plan + new PC / reinstall).
  if (replace) {
    const existing = await prisma.device.findMany({
      where: { userId, syncStatus: { not: 'delete_pending' } },
      orderBy: { updatedAt: 'asc' },
      select: { id: true },
    });
    const need = existing.length - maxDevices + 1;
    if (need > 0) {
      await prisma.device.updateMany({
        where: { id: { in: existing.slice(0, need).map((d) => d.id) } },
        data: { syncStatus: 'delete_pending' },
      });
    }
  }

  const deviceCount = await prisma.device.count({
    where: { userId, syncStatus: { not: 'delete_pending' } },
  });
  if (deviceCount >= maxDevices) {
    const err = new Error(
      `Device limit reached (${maxDevices}). Disconnect/remove an old device, or upgrade your plan.`
    );
    err.status = 400;
    throw err;
  }

  const node = nodeId
    ? await prisma.vpnNode.findFirst({ where: { id: nodeId, active: true } })
    : await prisma.vpnNode.findFirst({ where: { active: true }, orderBy: { name: 'asc' } });

  if (!node) {
    const err = new Error('No VPN nodes available');
    err.status = 503;
    throw err;
  }

  const { privateKey, publicKey } = generateWireGuardKeyPair();

  return prisma.device.create({
    data: {
      userId,
      nodeId: node.id,
      name,
      clientPrivateKey: privateKey,
      clientPublicKey: publicKey,
      clientIp: null,
      syncStatus: 'idle',
    },
    include: { node: true },
  });
}

/** Move an existing device to another node (available to every plan). */
export async function switchDeviceNode(userId, deviceId, nodeId) {
  const sub = await getActiveSubscription(userId);
  if (!sub) {
    const err = new Error('Active subscription required');
    err.status = 402;
    throw err;
  }

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId, syncStatus: { not: 'delete_pending' } },
    include: { node: true },
  });
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }

  if (device.nodeId === nodeId) {
    return device;
  }

  const node = await prisma.vpnNode.findFirst({ where: { id: nodeId, active: true } });
  if (!node) {
    const err = new Error('Node not found');
    err.status = 404;
    throw err;
  }

  const { privateKey, publicKey } = generateWireGuardKeyPair();

  return prisma.$transaction(async (tx) => {
    // Queue removal of old peer on previous node if it held an IP.
    if (device.clientIp) {
      await tx.device.create({
        data: {
          userId,
          nodeId: device.nodeId,
          name: `${device.name} (removed)`,
          clientPrivateKey: device.clientPrivateKey,
          clientPublicKey: device.clientPublicKey,
          clientIp: device.clientIp,
          syncStatus: 'delete_pending',
        },
      });
    }

    await tx.device.delete({ where: { id: device.id } });

    return tx.device.create({
      data: {
        userId,
        nodeId: node.id,
        name: device.name,
        clientPrivateKey: privateKey,
        clientPublicKey: publicKey,
        clientIp: null,
        syncStatus: 'idle',
      },
      include: { node: true },
    });
  }, TX_OPTS);
}

/**
 * Allocate a free IP on the device's node and queue peer add (server-controlled).
 * Idempotent if already pending/synced with an IP.
 */
export async function startDeviceSession(userId, deviceId) {
  const sub = await getActiveSubscription(userId);
  if (!sub) {
    const err = new Error('Subscription expired');
    err.status = 402;
    throw err;
  }

  const device = await prisma.device.findFirst({
    where: {
      id: deviceId,
      userId,
      syncStatus: { notIn: ['delete_pending'] },
    },
    include: { node: true },
  });
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }

  if (!device.node?.active) {
    const err = new Error('VPN node is offline');
    err.status = 503;
    throw err;
  }

  // Already has a live/queued session — keep the same IP.
  if (device.clientIp && (device.syncStatus === 'pending' || device.syncStatus === 'synced')) {
    return toClientConfig(device);
  }

  // Disconnect in flight: cancel release and re-add the same IP.
  if (device.clientIp && device.syncStatus === 'release_pending') {
    const updated = await prisma.device.update({
      where: { id: device.id },
      data: { syncStatus: 'pending' },
      include: { node: true },
    });
    return toClientConfig(updated);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const locked = await tx.vpnNode.findUnique({ where: { id: device.nodeId } });
    if (!locked) {
      const err = new Error('VPN node not found');
      err.status = 404;
      throw err;
    }
    const activePeers = await countActivePeersOnNode(tx, locked.id);
    if (activePeers >= locked.capacity) {
      const err = new Error('Selected node is full');
      err.status = 503;
      throw err;
    }

    const clientIp = await allocateClientIp(tx, locked);
    return tx.device.update({
      where: { id: device.id },
      data: { clientIp, syncStatus: 'pending' },
      include: { node: true },
    });
  }, TX_OPTS);

  return toClientConfig(updated);
}

/**
 * Drop this client from the node's peer/IP list. Device identity is kept (idle).
 */
export async function endDeviceSession(userId, deviceId) {
  const device = await prisma.device.findFirst({
    where: {
      id: deviceId,
      userId,
      syncStatus: { notIn: ['delete_pending'] },
    },
  });
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }

  if (!device.clientIp || device.syncStatus === 'idle') {
    if (device.syncStatus !== 'idle' || device.clientIp) {
      await prisma.device.update({
        where: { id: device.id },
        data: { clientIp: null, syncStatus: 'idle' },
      });
    }
    return { ok: true, released: false };
  }

  await prisma.device.update({
    where: { id: device.id },
    data: { syncStatus: 'release_pending' },
  });
  return { ok: true, released: true };
}

export async function deleteDevice(userId, deviceId) {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }
  await prisma.device.update({
    where: { id: device.id },
    data: { syncStatus: 'delete_pending' },
  });
  return { ok: true };
}

export function toClientConfig(device) {
  if (!device.clientIp) {
    const err = new Error('No VPN IP allocated yet. Connect to request an address from the server.');
    err.status = 409;
    throw err;
  }
  const endpoint = `${device.node.publicHost}:${device.node.publicPort}`;
  const conf = buildClientConfig({
    privateKey: device.clientPrivateKey,
    address: device.clientIp,
    serverPublicKey: device.node.publicKey,
    endpoint,
  });
  return {
    deviceId: device.id,
    name: device.name,
    region: device.node.region,
    nodeName: device.node.name,
    endpoint,
    address: device.clientIp,
    syncStatus: device.syncStatus,
    conf,
  };
}

export async function getDeviceConfig(userId, deviceId) {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId, syncStatus: { not: 'delete_pending' } },
    include: { node: true },
  });
  if (!device) {
    const err = new Error('Device not found');
    err.status = 404;
    throw err;
  }
  const sub = await getActiveSubscription(userId);
  if (!sub) {
    const err = new Error('Subscription expired');
    err.status = 402;
    throw err;
  }
  return toClientConfig(device);
}

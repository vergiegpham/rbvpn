import { prisma } from '../utils/db.js';
import { generateWireGuardKeyPair, ipFromIndex, buildClientConfig } from '../utils/wireguard.js';
import { getActiveSubscription } from './subscription.js';

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

export async function createDevice(userId, { name = 'Windows PC', nodeId } = {}) {
  const sub = await getActiveSubscription(userId);
  if (!sub) {
    const err = new Error('Active subscription required');
    err.status = 402;
    throw err;
  }

  const deviceCount = await prisma.device.count({
    where: { userId, syncStatus: { not: 'delete_pending' } },
  });
  if (deviceCount >= sub.plan.maxDevices) {
    const err = new Error(`Device limit reached (${sub.plan.maxDevices})`);
    err.status = 400;
    throw err;
  }

  // All plans (including Basic) may use any active node.
  const node = nodeId
    ? await prisma.vpnNode.findFirst({ where: { id: nodeId, active: true } })
    : await prisma.vpnNode.findFirst({ where: { active: true }, orderBy: { name: 'asc' } });

  if (!node) {
    const err = new Error('No VPN nodes available');
    err.status = 503;
    throw err;
  }

  const peerCount = await prisma.device.count({ where: { nodeId: node.id } });
  if (peerCount >= node.capacity) {
    const err = new Error('Selected node is full');
    err.status = 503;
    throw err;
  }

  const { privateKey, publicKey } = generateWireGuardKeyPair();

  const device = await prisma.$transaction(async (tx) => {
    const locked = await tx.vpnNode.findUnique({ where: { id: node.id } });
    const clientIpIndex = locked.nextClientIp;
    const clientIp = ipFromIndex(locked.gatewayIp, clientIpIndex);

    await tx.vpnNode.update({
      where: { id: node.id },
      data: { nextClientIp: clientIpIndex + 1 },
    });

    return tx.device.create({
      data: {
        userId,
        nodeId: node.id,
        name,
        clientPrivateKey: privateKey,
        clientPublicKey: publicKey,
        clientIp,
        syncStatus: 'pending',
      },
      include: { node: true },
    });
  });

  return device;
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

  const peerCount = await prisma.device.count({ where: { nodeId: node.id } });
  if (peerCount >= node.capacity) {
    const err = new Error('Selected node is full');
    err.status = 503;
    throw err;
  }

  const { privateKey, publicKey } = generateWireGuardKeyPair();

  return prisma.$transaction(async (tx) => {
    // Queue removal of old peer on previous node
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

    await tx.device.delete({ where: { id: device.id } });

    const locked = await tx.vpnNode.findUnique({ where: { id: node.id } });
    const clientIpIndex = locked.nextClientIp;
    const clientIp = ipFromIndex(locked.gatewayIp, clientIpIndex);
    await tx.vpnNode.update({
      where: { id: node.id },
      data: { nextClientIp: clientIpIndex + 1 },
    });

    return tx.device.create({
      data: {
        userId,
        nodeId: node.id,
        name: device.name,
        clientPrivateKey: privateKey,
        clientPublicKey: publicKey,
        clientIp,
        syncStatus: 'pending',
      },
      include: { node: true },
    });
  });
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

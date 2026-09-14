import { prisma } from '../utils/db.js';
import { generateWireGuardKeyPair, ipFromIndex, buildClientConfig } from '../utils/wireguard.js';
import { getActiveSubscription } from './subscription.js';

export async function listUserDevices(userId) {
  return prisma.device.findMany({
    where: { userId },
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

  const deviceCount = await prisma.device.count({ where: { userId } });
  if (deviceCount >= sub.plan.maxDevices) {
    const err = new Error(`Device limit reached (${sub.plan.maxDevices})`);
    err.status = 400;
    throw err;
  }

  const node = nodeId
    ? await prisma.vpnNode.findFirst({ where: { id: nodeId, active: true } })
    : await prisma.vpnNode.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });

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

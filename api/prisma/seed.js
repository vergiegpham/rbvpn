import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const basic = await prisma.plan.upsert({
    where: { code: 'basic' },
    update: {},
    create: {
      code: 'basic',
      name: 'Basic',
      description: '1 device · 1 region · full-speed WireGuard',
      priceCents: 999,
      currency: 'usd',
      durationDays: 30,
      maxDevices: 1,
      stripePriceId: process.env.STRIPE_PRICE_BASIC || null,
    },
  });

  const pro = await prisma.plan.upsert({
    where: { code: 'pro' },
    update: {},
    create: {
      code: 'pro',
      name: 'Pro',
      description: '3 devices · priority nodes · full-speed WireGuard',
      priceCents: 1999,
      currency: 'usd',
      durationDays: 30,
      maxDevices: 3,
      stripePriceId: process.env.STRIPE_PRICE_PRO || null,
    },
  });

  const passwordHash = await bcrypt.hash('admin123!', 10);
  await prisma.user.upsert({
    where: { email: 'admin@rbvpn.local' },
    update: {},
    create: {
      email: 'admin@rbvpn.local',
      passwordHash,
      name: 'Admin',
      role: 'admin',
    },
  });

  await prisma.vpnNode.upsert({
    where: { id: 'seed-node-us' },
    update: {
      name: 'US West 1',
      region: 'us-west',
      publicHost: process.env.SEED_NODE_HOST || 'vpn.example.com',
      publicPort: Number(process.env.SEED_NODE_PORT || 51820),
      publicKey: process.env.SEED_NODE_PUBLIC_KEY || 'REPLACE_WITH_SERVER_PUBLIC_KEY',
      active: true,
    },
    create: {
      id: 'seed-node-us',
      name: 'US West 1',
      region: 'us-west',
      publicHost: process.env.SEED_NODE_HOST || 'vpn.example.com',
      publicPort: Number(process.env.SEED_NODE_PORT || 51820),
      publicKey: process.env.SEED_NODE_PUBLIC_KEY || 'REPLACE_WITH_SERVER_PUBLIC_KEY',
      interfaceName: 'wg0',
      subnetCidr: '10.10.0.0/24',
      gatewayIp: '10.10.0.1',
      nextClientIp: 2,
      capacity: 250,
      active: true,
    },
  });

  console.log('Seeded plans:', basic.code, pro.code);
  console.log('Admin login: admin@rbvpn.local / admin123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

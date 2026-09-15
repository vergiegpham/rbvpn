import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const basicMonthly = await prisma.plan.upsert({
    where: { code: 'basic' },
    update: {
      name: 'Basic Monthly',
      description: '1 device · all nodes · billed monthly',
      priceCents: 999,
      durationDays: 30,
      maxDevices: 1,
      active: true,
    },
    create: {
      code: 'basic',
      name: 'Basic Monthly',
      description: '1 device · all nodes · billed monthly',
      priceCents: 999,
      currency: 'usd',
      durationDays: 30,
      maxDevices: 1,
      stripePriceId: process.env.STRIPE_PRICE_BASIC || null,
    },
  });

  const proMonthly = await prisma.plan.upsert({
    where: { code: 'pro' },
    update: {
      name: 'Pro Monthly',
      description: '3 devices · all nodes · billed monthly',
      priceCents: 1999,
      durationDays: 30,
      maxDevices: 3,
      active: true,
    },
    create: {
      code: 'pro',
      name: 'Pro Monthly',
      description: '3 devices · all nodes · billed monthly',
      priceCents: 1999,
      currency: 'usd',
      durationDays: 30,
      maxDevices: 3,
      stripePriceId: process.env.STRIPE_PRICE_PRO || null,
    },
  });

  const basicAnnual = await prisma.plan.upsert({
    where: { code: 'basic-annual' },
    update: {
      name: 'Basic Annual',
      description: '1 device · all nodes · billed yearly',
      priceCents: 10000,
      durationDays: 365,
      maxDevices: 1,
      active: true,
    },
    create: {
      code: 'basic-annual',
      name: 'Basic Annual',
      description: '1 device · all nodes · billed yearly',
      priceCents: 10000,
      currency: 'usd',
      durationDays: 365,
      maxDevices: 1,
      stripePriceId: process.env.STRIPE_PRICE_BASIC_ANNUAL || null,
    },
  });

  const proAnnual = await prisma.plan.upsert({
    where: { code: 'pro-annual' },
    update: {
      name: 'Pro Annual',
      description: '3 devices · all nodes · billed yearly',
      priceCents: 20000,
      durationDays: 365,
      maxDevices: 3,
      active: true,
    },
    create: {
      code: 'pro-annual',
      name: 'Pro Annual',
      description: '3 devices · all nodes · billed yearly',
      priceCents: 20000,
      currency: 'usd',
      durationDays: 365,
      maxDevices: 3,
      stripePriceId: process.env.STRIPE_PRICE_PRO_ANNUAL || null,
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

  console.log(
    'Seeded plans:',
    basicMonthly.code,
    proMonthly.code,
    basicAnnual.code,
    proAnnual.code
  );
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

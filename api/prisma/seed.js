// First-run data: plans, the first admin, and a starter node.
// Safe to re-run: existing plan prices and node settings are left as the admin set them.
import { PrismaClient } from '@prisma/client';
import { generatePassword, hashPassword } from '../src/utils/passwords.js';
import { isPlaceholder } from '../src/utils/env.js';

const prisma = new PrismaClient();

const PLANS = [
  {
    code: 'basic',
    name: 'Basic Monthly',
    description: '1 device · all nodes · billed monthly',
    priceCents: 999,
    durationDays: 30,
    maxDevices: 1,
    stripePriceEnv: 'STRIPE_PRICE_BASIC',
  },
  {
    code: 'pro',
    name: 'Pro Monthly',
    description: '3 devices · all nodes · billed monthly',
    priceCents: 1999,
    durationDays: 30,
    maxDevices: 3,
    stripePriceEnv: 'STRIPE_PRICE_PRO',
  },
  {
    code: 'basic-annual',
    name: 'Basic Annual',
    description: '1 device · all nodes · billed yearly',
    priceCents: 10000,
    durationDays: 365,
    maxDevices: 1,
    stripePriceEnv: 'STRIPE_PRICE_BASIC_ANNUAL',
  },
  {
    code: 'pro-annual',
    name: 'Pro Annual',
    description: '3 devices · all nodes · billed yearly',
    priceCents: 20000,
    durationDays: 365,
    maxDevices: 3,
    stripePriceEnv: 'STRIPE_PRICE_PRO_ANNUAL',
  },
];

function envValue(name) {
  const value = process.env[name];
  return isPlaceholder(value) ? null : value;
}

async function seedPlans() {
  const created = [];
  for (const { stripePriceEnv, ...plan } of PLANS) {
    const stripePriceId = envValue(stripePriceEnv);
    const existing = await prisma.plan.findUnique({ where: { code: plan.code } });
    if (!existing) {
      await prisma.plan.create({ data: { ...plan, currency: 'usd', active: true, stripePriceId } });
      created.push(plan.code);
    } else if (stripePriceId && existing.stripePriceId !== stripePriceId) {
      await prisma.plan.update({ where: { id: existing.id }, data: { stripePriceId } });
    } else if (!stripePriceId && isPlaceholder(existing.stripePriceId) && existing.stripePriceId) {
      await prisma.plan.update({ where: { id: existing.id }, data: { stripePriceId: null } });
    }
  }
  console.log(created.length ? `Created plans: ${created.join(', ')}` : 'Plans already present');
}

async function seedAdmin() {
  if ((await prisma.user.count({ where: { role: 'admin' } })) > 0) {
    console.log('Admin account already present');
    return;
  }

  const email = (process.env.ADMIN_EMAIL || 'admin@rbvpn.local').trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.warn(`No admin exists and ${email} is a regular user — promote that account in the database.`);
    return;
  }

  const fromEnv = process.env.ADMIN_PASSWORD;
  const password = fromEnv || generatePassword(16);
  await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), name: 'Admin', role: 'admin' },
  });
  console.log(
    fromEnv
      ? `Created admin ${email} (password from ADMIN_PASSWORD)`
      : `Created admin ${email} with password: ${password}  <- save it now; it is not shown again`
  );
}

async function seedNode() {
  const host = process.env.SEED_NODE_HOST || '';
  const key = process.env.SEED_NODE_PUBLIC_KEY || '';

  if ((await prisma.vpnNode.count()) === 0) {
    await prisma.vpnNode.create({
      data: {
        id: 'seed-node-us',
        name: 'US West 1',
        region: 'us-west',
        publicHost: host || 'vpn.example.com',
        publicPort: Number(process.env.SEED_NODE_PORT || 51820),
        publicKey: key || 'REPLACE_WITH_SERVER_PUBLIC_KEY',
        interfaceName: 'wg0',
        subnetCidr: '10.10.0.0/24',
        gatewayIp: '10.10.0.1',
        nextClientIp: 2,
        capacity: 250,
        active: Boolean(host && key),
      },
    });
    console.log('Created starter node seed-node-us');
    return;
  }

  const node = await prisma.vpnNode.findUnique({ where: { id: 'seed-node-us' } });
  if (!node) return;
  const data = {};
  if (host && node.publicHost === 'vpn.example.com') data.publicHost = host;
  if (key && isPlaceholder(node.publicKey)) data.publicKey = key;
  if (Object.keys(data).length) {
    await prisma.vpnNode.update({ where: { id: node.id }, data });
    console.log(`Filled starter node placeholders: ${Object.keys(data).join(', ')}`);
  }
}

async function main() {
  await seedPlans();
  await seedAdmin();
  await seedNode();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

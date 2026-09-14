import { prisma } from '../utils/db.js';

export async function getActiveSubscription(userId) {
  const now = new Date();
  return prisma.subscription.findFirst({
    where: {
      userId,
      status: 'active',
      endsAt: { gt: now },
    },
    include: { plan: true },
    orderBy: { endsAt: 'desc' },
  });
}

export async function activateSubscription(userId, planId) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found');

  const now = new Date();
  const endsAt = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

  await prisma.subscription.updateMany({
    where: { userId, status: 'active' },
    data: { status: 'replaced' },
  });

  return prisma.subscription.create({
    data: {
      userId,
      planId,
      status: 'active',
      startsAt: now,
      endsAt,
    },
    include: { plan: true },
  });
}

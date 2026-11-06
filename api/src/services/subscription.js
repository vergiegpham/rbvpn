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

/**
 * Activate or extend subscription.
 * If the user already has an active subscription, add duration from the current end date
 * (extend) instead of replacing it. Plan upgrades switch to the purchased plan while extending.
 */
export async function activateSubscription(userId, planId) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found');

  const now = new Date();
  const ms = plan.durationDays * 24 * 60 * 60 * 1000;
  const current = await getActiveSubscription(userId);

  if (current) {
    const base = current.endsAt > now ? current.endsAt : now;
    const endsAt = new Date(base.getTime() + ms);
    return prisma.subscription.update({
      where: { id: current.id },
      data: {
        planId,
        status: 'active',
        endsAt,
      },
      include: { plan: true },
    });
  }

  const endsAt = new Date(now.getTime() + ms);
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

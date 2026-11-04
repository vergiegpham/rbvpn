import { prisma } from '../utils/db.js';
import { env } from '../utils/env.js';

const LIVE_STATUSES = ['pending', 'synced'];
const SWEEP_INTERVAL_MS = 60 * 1000;
// Stale reaping relies on handshake reports, so only trust nodes whose agent reported recently.
const AGENT_FRESH_MS = 5 * 60 * 1000;

/** Queue peer removal for a user's live sessions; devices stay registered (idle after the agent acks). */
export async function releaseUserSessions(userId, db = prisma) {
  const result = await db.device.updateMany({
    where: { userId, clientIp: { not: null }, syncStatus: { in: LIVE_STATUSES } },
    data: { syncStatus: 'release_pending' },
  });
  return result.count;
}

/**
 * Release sessions that should no longer be on a node:
 * - user suspended, or no active subscription (expired / cancelled)
 * - no handshake for STALE_SESSION_HOURS (client crashed or uninstalled without disconnecting)
 * Also normalizes "pending without IP" rows left by older builds.
 */
export async function sweepSessions(now = new Date()) {
  await prisma.device.updateMany({
    where: { syncStatus: 'pending', clientIp: null },
    data: { syncStatus: 'idle' },
  });

  const live = await prisma.device.findMany({
    where: { clientIp: { not: null }, syncStatus: { in: LIVE_STATUSES } },
    select: {
      id: true,
      userId: true,
      lastSeenAt: true,
      updatedAt: true,
      user: { select: { suspended: true } },
      node: { select: { agentSeenAt: true } },
    },
  });
  if (!live.length) return { released: 0 };

  const userIds = [...new Set(live.map((d) => d.userId))];
  const entitled = new Set(
    (
      await prisma.subscription.findMany({
        where: { userId: { in: userIds }, status: 'active', endsAt: { gt: now } },
        select: { userId: true },
      })
    ).map((s) => s.userId)
  );

  const staleMs = env.staleSessionHours * 60 * 60 * 1000;
  const release = live
    .filter((d) => {
      if (d.user.suspended || !entitled.has(d.userId)) return true;
      if (!(staleMs > 0)) return false;
      const agentFresh =
        d.node?.agentSeenAt && now.getTime() - d.node.agentSeenAt.getTime() < AGENT_FRESH_MS;
      const lastActivity = d.lastSeenAt || d.updatedAt;
      return Boolean(agentFresh) && now.getTime() - lastActivity.getTime() > staleMs;
    })
    .map((d) => d.id);

  if (!release.length) return { released: 0 };
  const result = await prisma.device.updateMany({
    where: { id: { in: release }, syncStatus: { in: LIVE_STATUSES } },
    data: { syncStatus: 'release_pending' },
  });
  if (result.count) console.log(`[sessions] released ${result.count} session(s)`);
  return { released: result.count };
}

export function startSessionSweeper() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sweepSessions();
    } catch (err) {
      console.error('[sessions] sweep failed:', err.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5000).unref();
  setInterval(tick, SWEEP_INTERVAL_MS).unref();
}

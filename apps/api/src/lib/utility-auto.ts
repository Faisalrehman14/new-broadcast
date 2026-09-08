import { enqueue, QUEUE_NAMES } from './queues.js';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

/** Enqueue background Instant plain UTILITY ensure (+ Meta approval poll) for one Page. */
export async function enqueueUtilityEnsure(
  pageId: string,
  opts?: { waitForApproved?: boolean; delayMs?: number; userId?: string }
) {
  const wait = opts?.waitForApproved !== false;
  return enqueue(
    QUEUE_NAMES.UTILITY_ENSURE,
    {
      pageId,
      waitForApproved: wait,
      userId: opts?.userId || null,
    },
    {
      jobId: `ue-${pageId}-${Math.floor(Date.now() / 600_000)}`,
      delay: opts?.delayMs,
      attempts: 3,
    }
  );
}

/** Enqueue ensure for every connected Page of a user (deduped job ids). */
export async function enqueueUtilityEnsureForUser(
  userId: string,
  opts?: { waitForApproved?: boolean; delayMs?: number }
) {
  const connections = await prisma.pageConnection.findMany({
    where: {
      userId,
      status: { not: 'DISCONNECTED' },
    },
    select: { pageId: true, page: { select: { encryptedPageToken: true } } },
  });
  const ids = new Set<string>();
  for (const c of connections) {
    if (c.page.encryptedPageToken) ids.add(c.pageId);
  }

  let n = 0;
  for (const pageId of ids) {
    try {
      await enqueueUtilityEnsure(pageId, {
        waitForApproved: opts?.waitForApproved !== false,
        delayMs: (opts?.delayMs || 0) + n * 1500,
        userId,
      });
      n += 1;
    } catch (err) {
      logger.warn({ err, pageId, userId }, 'enqueue utility ensure failed');
    }
  }
  return { enqueued: n };
}

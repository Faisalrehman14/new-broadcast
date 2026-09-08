import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const QUEUE_NAMES = {
  FACEBOOK_SYNC: 'facebook-sync',
  WEBHOOK: 'webhook-processing',
  TEMPLATE_STATUS: 'template-status',
  BROADCAST: 'broadcast',
  MESSAGE_SEND: 'message-send',
  CAMPAIGN_RUN: 'campaign-run',
  CAMPAIGN_SEND: 'campaign-send',
  CAMPAIGN_RESUME: 'campaign-resume',
  ANALYTICS: 'analytics',
  NOTIFICATIONS: 'notifications',
} as const;

let connection: Redis | null = null;

export function getRedis(): Redis {
  if (!connection) {
    connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getRedis() });
    queues.set(name, q);
  }
  return q;
}

export async function enqueue(
  name: string,
  data: Record<string, unknown>,
  opts?: { delay?: number; jobId?: string; attempts?: number }
) {
  const queue = getQueue(name);
  return queue.add(name, data, {
    jobId: opts?.jobId,
    delay: opts?.delay,
    attempts: opts?.attempts ?? 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  if (connection) await connection.quit();
}

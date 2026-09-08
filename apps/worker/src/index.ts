import { loadWorkerConfig } from '@pagebroadcast/config';
import { createMetaProvider } from '@pagebroadcast/meta-provider';
import { renderTemplatePreview } from '@pagebroadcast/validation';
import { createDecipheriv } from 'node:crypto';
import pino from 'pino';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { Worker, Queue, type Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const config = loadWorkerConfig(process.env);
const logger = pino({ level: config.LOG_LEVEL, base: { service: 'castmepro-worker' } });
const prisma = new PrismaClient();
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const meta = createMetaProvider(config.META_PROVIDER, {
  appId: config.META_APP_ID,
  appSecret: config.META_APP_SECRET,
  graphVersion: config.META_GRAPH_VERSION,
  redirectUri: config.META_REDIRECT_URI,
});

function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload');
  const key = Buffer.from(config.ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

const QUEUE = {
  FACEBOOK_SYNC: 'facebook-sync',
  WEBHOOK: 'webhook-processing',
  TEMPLATE_STATUS: 'template-status',
  BROADCAST: 'broadcast',
  MESSAGE_SEND: 'message-send',
  NOTIFICATIONS: 'notifications',
  ANALYTICS: 'analytics',
} as const;

async function notify(
  userId: string,
  type: 'SYNC_COMPLETED' | 'SYNC_FAILED' | 'TEMPLATE_APPROVED' | 'TEMPLATE_REJECTED' | 'BROADCAST_COMPLETED' | 'BROADCAST_FAILED' | 'GENERIC',
  title: string,
  body: string,
  metadata?: object
) {
  await prisma.notification.create({
    data: { userId, type, title, body, metadata: metadata ?? undefined },
  });
}

async function handleFacebookSync(job: Job) {
  const { syncJobId, pageId, userId } = job.data as {
    syncJobId: string;
    pageId: string;
    userId: string;
  };
  const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: pageId } });
  const token = decryptSecret(page.encryptedPageToken);

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  await prisma.pageConnection.updateMany({
    where: { pageId, userId },
    data: { status: 'SYNCING' },
  });

  let cursor: string | undefined;
  let processed = 0;
  let estimated = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const batch = await meta.fetchContacts({
        pageId: page.platformPageId,
        pageAccessToken: token,
        cursor,
        limit: 50,
      });
      if (!estimated && batch.hasMore) estimated = processed + batch.contacts.length + 50;
      else estimated = Math.max(estimated, processed + batch.contacts.length);

      for (const c of batch.contacts) {
        await prisma.contact.upsert({
          where: {
            pageId_platformUserId: { pageId, platformUserId: c.platformUserId },
          },
          create: {
            pageId,
            platformUserId: c.platformUserId,
            name: c.name,
            profileImage: c.profileImage,
            lastInteractionAt: c.lastInteractionAt ? new Date(c.lastInteractionAt) : new Date(),
            status: 'ACTIVE',
          },
          update: {
            name: c.name ?? undefined,
            profileImage: c.profileImage ?? undefined,
            lastInteractionAt: c.lastInteractionAt ? new Date(c.lastInteractionAt) : undefined,
          },
        });
        processed += 1;
      }

      cursor = batch.nextCursor;
      hasMore = batch.hasMore;
      await prisma.syncJob.update({
        where: { id: syncJobId },
        data: { processedCount: processed, totalEstimated: estimated || processed, cursor },
      });
    }

    const contactCount = await prisma.contact.count({ where: { pageId } });
    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: 'COMPLETED',
        processedCount: processed,
        totalEstimated: processed,
        completedAt: new Date(),
      },
    });
    await prisma.pageConnection.updateMany({
      where: { pageId, userId },
      data: {
        status: 'CONNECTED',
        lastSyncedAt: new Date(),
        contactCount,
        healthStatus: 'Connected',
      },
    });
    await notify(userId, 'SYNC_COMPLETED', 'Sync completed', `Synced ${processed} contacts.`);
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'contacts.sync_completed',
        resource: 'sync_job',
        resourceId: syncJobId,
        metadata: { processed },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sync failed';
    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'FAILED', error: message, completedAt: new Date() },
    });
    await prisma.pageConnection.updateMany({
      where: { pageId, userId },
      data: { status: 'ERROR', healthStatus: 'Error' },
    });
    await notify(userId, 'SYNC_FAILED', 'Sync failed', 'Contact sync failed. Please try again.');
    throw err;
  }
}

async function handleWebhook(job: Job) {
  const { webhookEventId } = job.data as { webhookEventId: string };
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event || event.processed) return;

  try {
    const payload = event.payload as {
      entry?: Array<{
        id?: string;
        messaging?: Array<{
          sender?: { id?: string };
          recipient?: { id?: string };
          timestamp?: number;
          message?: { mid?: string; text?: string };
        }>;
      }>;
    };

    for (const entry of payload.entry ?? []) {
      const page = entry.id
        ? await prisma.facebookPage.findUnique({ where: { platformPageId: entry.id } })
        : event.pageId
          ? await prisma.facebookPage.findUnique({ where: { id: event.pageId } })
          : null;
      if (!page) continue;

      for (const msg of entry.messaging ?? []) {
        const psid = msg.sender?.id;
        if (!psid || psid === page.platformPageId) continue;
        const contact = await prisma.contact.upsert({
          where: {
            pageId_platformUserId: { pageId: page.id, platformUserId: psid },
          },
          create: {
            pageId: page.id,
            platformUserId: psid,
            name: `User ${psid.slice(-4)}`,
            lastInteractionAt: new Date(msg.timestamp ?? Date.now()),
            status: 'ACTIVE',
          },
          update: {
            lastInteractionAt: new Date(msg.timestamp ?? Date.now()),
            status: 'ACTIVE',
          },
        });
        await prisma.contactEvent.create({
          data: {
            contactId: contact.id,
            eventType: msg.message ? 'message' : 'messaging_event',
            payload: msg as object,
          },
        });
      }

      const count = await prisma.contact.count({ where: { pageId: page.id } });
      await prisma.pageConnection.updateMany({
        where: { pageId: page.id },
        data: { lastWebhookAt: new Date(), contactCount: count },
      });
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processed: true, processedAt: new Date() },
    });
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processingError: err instanceof Error ? err.message : 'error',
      },
    });
    throw err;
  }
}

async function handleTemplateStatus(job: Job) {
  const { approvalId } = job.data as { approvalId: string };
  const approval = await prisma.templateApproval.findUnique({
    where: { id: approvalId },
    include: { page: true, template: true },
  });
  if (!approval || !approval.externalTemplateId) return;
  if (['APPROVED', 'REJECTED', 'DISABLED'].includes(approval.status)) return;

  const token = decryptSecret(approval.page.encryptedPageToken);
  const status = await meta.getTemplateStatus({
    pageId: approval.page.platformPageId,
    pageAccessToken: token,
    externalTemplateId: approval.externalTemplateId,
    templateName: approval.template.metaName,
  });

  if (status.status === 'PENDING' || status.status === 'UNKNOWN') {
    const nextBackoff = Math.min(approval.pollBackoffSeconds * 2, 900);
    await prisma.templateApproval.update({
      where: { id: approvalId },
      data: {
        status: status.status === 'UNKNOWN' ? 'PENDING' : 'PENDING',
        pollBackoffSeconds: nextBackoff,
        nextPollAt: new Date(Date.now() + nextBackoff * 1000),
      },
    });
    const q = new Queue(QUEUE.TEMPLATE_STATUS, { connection });
    await q.add(
      QUEUE.TEMPLATE_STATUS,
      { approvalId },
      { delay: nextBackoff * 1000, jobId: `tpl-status-${approvalId}-${nextBackoff}` }
    );
    await q.close();
    return;
  }

  await prisma.templateApproval.update({
    where: { id: approvalId },
    data: {
      status: status.status,
      approvedAt: status.status === 'APPROVED' ? new Date() : undefined,
      rejectedAt: status.status === 'REJECTED' ? new Date() : undefined,
      rejectionReason: status.rejectionReason,
      nextPollAt: null,
    },
  });
  await prisma.template.update({
    where: { id: approval.templateId },
    data: { status: status.status },
  });

  const broadcasts = await prisma.broadcast.findMany({
    where: {
      templateId: approval.templateId,
      pageId: approval.pageId,
      status: 'PENDING_APPROVAL',
    },
  });

  for (const b of broadcasts) {
    if (status.status === 'APPROVED') {
      await prisma.broadcast.update({ where: { id: b.id }, data: { status: 'APPROVED' } });
      await notify(b.userId, 'TEMPLATE_APPROVED', 'Template approved', `${approval.template.title} was approved. You can start the broadcast.`);
    } else if (status.status === 'REJECTED') {
      await prisma.broadcast.update({ where: { id: b.id }, data: { status: 'REJECTED' } });
      await notify(
        b.userId,
        'TEMPLATE_REJECTED',
        'Template rejected',
        status.rejectionReason || 'Meta rejected the template.'
      );
    }
  }
}

async function handleBroadcast(job: Job) {
  const { broadcastId } = job.data as { broadcastId: string };
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    include: { user: { include: { settings: true } } },
  });
  if (!broadcast || !['QUEUED', 'RUNNING'].includes(broadcast.status)) return;

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: 'RUNNING', startedAt: broadcast.startedAt ?? new Date() },
  });

  const settings = broadcast.user.settings;
  const perSecond = settings?.messagesPerSecond ?? config.BROADCAST_MESSAGES_PER_SECOND;
  const delayMs = Math.ceil(1000 / perSecond);

  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: { in: ['PENDING', 'RETRYING'] } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const sendQueue = new Queue(QUEUE.MESSAGE_SEND, { connection });
  let i = 0;
  for (const r of recipients) {
    await sendQueue.add(
      QUEUE.MESSAGE_SEND,
      { recipientId: r.id, broadcastId },
      {
        jobId: `send-${r.id}`,
        delay: i * delayMs,
        attempts: settings?.maxRetries ?? 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      }
    );
    i += 1;
  }
  await sendQueue.close();
}

async function finalizeBroadcast(broadcastId: string) {
  const pending = await prisma.broadcastRecipient.count({
    where: {
      broadcastId,
      status: { in: ['PENDING', 'SENDING', 'RETRYING'] },
    },
  });
  if (pending > 0) return;

  const b = await prisma.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });
  if (['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED'].includes(b.status)) {
    return;
  }

  let status: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' = 'COMPLETED';
  if (b.failedCount > 0 && b.sentCount > 0) status = 'PARTIALLY_COMPLETED';
  else if (b.failedCount > 0 && b.sentCount === 0) status = 'FAILED';

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status, completedAt: new Date(), sendingCount: 0, queuedCount: 0 },
  });

  await notify(
    b.userId,
    status === 'FAILED' ? 'BROADCAST_FAILED' : 'BROADCAST_COMPLETED',
    status === 'FAILED' ? 'Broadcast failed' : 'Broadcast completed',
    `${b.name} finished with ${b.sentCount} sent and ${b.failedCount} failed.`
  );
}

async function handleMessageSend(job: Job) {
  const { recipientId, broadcastId } = job.data as { recipientId: string; broadcastId: string };

  const recipient = await prisma.broadcastRecipient.findUnique({
    where: { id: recipientId },
    include: {
      contact: true,
      broadcast: { include: { page: true, template: true } },
    },
  });
  if (!recipient) return;
  if (['SENT', 'DELIVERED', 'READ', 'SKIPPED'].includes(recipient.status)) return;

  const broadcast = recipient.broadcast;
  if (broadcast.status === 'PAUSED' || broadcast.status === 'CANCELLED') {
    return;
  }

  await prisma.broadcastRecipient.update({
    where: { id: recipientId },
    data: { status: 'SENDING', attemptCount: { increment: 1 } },
  });
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { sendingCount: { increment: 1 }, queuedCount: { decrement: 1 } },
  });

  try {
    const token = decryptSecret(broadcast.page.encryptedPageToken);
    const values = (broadcast.variableValues || {}) as Record<string, string>;
    const body = broadcast.template.body || broadcast.renderedBody || '';
    const orderedKeys = Object.keys(values).sort((a, b) => Number(a) - Number(b));
    const params = orderedKeys.map((k) => values[k] || '');

    // Prefer contact name for {{1}} if empty
    if ((!params[0] || params[0] === '') && recipient.contact.name) {
      params[0] = recipient.contact.name;
    }

    const result = await meta.sendTemplateMessage({
      pageId: broadcast.page.platformPageId,
      pageAccessToken: token,
      recipientPsid: recipient.contact.platformUserId,
      templateName: broadcast.template.metaName,
      bodyParameters: params.length
        ? params
        : [renderTemplatePreview(body, values)],
      idempotencyKey: recipient.idempotencyKey,
    });

    await prisma.$transaction([
      prisma.broadcastRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          deliveredAt: new Date(),
          externalMessageId: result.messageId,
        },
      }),
      prisma.messageDelivery.create({
        data: {
          broadcastId,
          recipientId,
          status: 'SENT',
          payload: { messageId: result.messageId },
        },
      }),
      prisma.broadcast.update({
        where: { id: broadcastId },
        data: {
          sentCount: { increment: 1 },
          deliveredCount: { increment: 1 },
          sendingCount: { decrement: 1 },
        },
      }),
      prisma.contact.update({
        where: { id: recipient.contactId },
        data: {
          broadcastsReceived: { increment: 1 },
          lastBroadcastAt: new Date(),
        },
      }),
    ]);
  } catch (err) {
    const e = err as Error & { status?: number; retryable?: boolean };
    const retryable = e.retryable || e.status === 429 || (e.status !== undefined && e.status >= 500);
    if (retryable) {
      await prisma.broadcastRecipient.update({
        where: { id: recipientId },
        data: { status: 'RETRYING', failureReason: e.message },
      });
      await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { sendingCount: { decrement: 1 }, queuedCount: { increment: 1 } },
      });
      throw err;
    }

    await prisma.$transaction([
      prisma.broadcastRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: e.message,
        },
      }),
      prisma.messageDelivery.create({
        data: {
          broadcastId,
          recipientId,
          status: 'FAILED',
          error: e.message,
        },
      }),
      prisma.broadcast.update({
        where: { id: broadcastId },
        data: { failedCount: { increment: 1 }, sendingCount: { decrement: 1 } },
      }),
    ]);
  }

  await finalizeBroadcast(broadcastId);
}

function makeWorker(name: string, processor: (job: Job) => Promise<void>, concurrency = 2) {
  const worker = new Worker(name, processor, {
    connection,
    concurrency,
  });
  worker.on('failed', (job, err) => {
    logger.error({ queue: name, jobId: job?.id, err }, 'job failed');
  });
  worker.on('completed', (job) => {
    logger.info({ queue: name, jobId: job.id }, 'job completed');
  });
  return worker;
}

const workers = [
  makeWorker(QUEUE.FACEBOOK_SYNC, handleFacebookSync, 2),
  makeWorker(QUEUE.WEBHOOK, handleWebhook, 5),
  makeWorker(QUEUE.TEMPLATE_STATUS, handleTemplateStatus, 2),
  makeWorker(QUEUE.BROADCAST, handleBroadcast, 1),
  makeWorker(QUEUE.MESSAGE_SEND, handleMessageSend, config.BROADCAST_CONCURRENT_SENDS),
  makeWorker(QUEUE.NOTIFICATIONS, async () => undefined, 1),
  makeWorker(QUEUE.ANALYTICS, async () => undefined, 1),
];

logger.info({ queues: Object.values(QUEUE), provider: config.META_PROVIDER }, 'workers started');

async function shutdown() {
  logger.info('shutting down workers');
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

import { loadWorkerConfig } from '@pagebroadcast/config';
import { createMetaProvider } from '@pagebroadcast/meta-provider';
import { renderTemplatePreview } from '@pagebroadcast/validation';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import pino from 'pino';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { Worker, Queue, type Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { personalizeBroadcastMessage } from './lib/personalize.js';
import { acquirePageSendSlot } from './lib/send-gate.js';
import { classifyMetaSendError } from './lib/meta-send-errors.js';

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

function encryptSecret(plaintext: string): string {
  const key = Buffer.from(config.ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

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

/** True Graph access-token death — not every Meta "OAuthException". */
function isAccessTokenDeadError(msg: string): boolean {
  return (
    /"code"\s*:\s*190\b/.test(msg) ||
    /\(#190\)/.test(msg) ||
    /session has expired/i.test(msg) ||
    /error validating access token/i.test(msg) ||
    /access token .* expired/i.test(msg)
  );
}

/** Remint /me/accounts once per campaign page (multi-page parallel was hammering Graph). */
const remintedPageTokens = new Map<string, { token: string; at: number }>();
const REMINT_TTL_MS = 10 * 60 * 1000;

async function resolveCampaignPageToken(cp: {
  id: string;
  pageId: string;
  platformPageId: string;
  encryptedPageToken: string | null;
}): Promise<string> {
  if (!cp.encryptedPageToken) throw new Error('Missing page token');
  const cached = remintedPageTokens.get(cp.id);
  if (cached && Date.now() - cached.at < REMINT_TTL_MS) return cached.token;

  let token = decryptSecret(cp.encryptedPageToken);
  const page = await prisma.facebookPage.findUnique({
    where: { id: cp.pageId },
    include: { facebookAccount: true },
  });
  if (page?.facebookAccount?.encryptedAccessToken && meta.remintPageTokensFromUserToken) {
    try {
      const pages = await meta.remintPageTokensFromUserToken(
        decryptSecret(page.facebookAccount.encryptedAccessToken)
      );
      const hit = pages.find((p) => p.id === page.platformPageId);
      if (hit?.accessToken) {
        token = hit.accessToken;
        const encrypted = encryptSecret(token);
        await prisma.$transaction([
          prisma.broadcastCampaignPage.update({
            where: { id: cp.id },
            data: { encryptedPageToken: encrypted },
          }),
          prisma.facebookPage.update({
            where: { id: page.id },
            data: { encryptedPageToken: encrypted },
          }),
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Keep snapshot token unless Graph proves the user token is dead.
      if (isAccessTokenDeadError(msg)) throw err;
      logger.warn({ err, pageId: cp.pageId }, 'page token remint skipped; using stored page token');
    }
  }
  remintedPageTokens.set(cp.id, { token, at: Date.now() });
  return token;
}

const QUEUE = {
  FACEBOOK_SYNC: 'facebook-sync',
  WEBHOOK: 'webhook-processing',
  TEMPLATE_STATUS: 'template-status',
  BROADCAST: 'broadcast',
  MESSAGE_SEND: 'message-send',
  CAMPAIGN_RUN: 'campaign-run',
  CAMPAIGN_SEND: 'campaign-send',
  CAMPAIGN_RESUME: 'campaign-resume',
  NOTIFICATIONS: 'notifications',
  ANALYTICS: 'analytics',
} as const;

const PLAIN_UTILITY_TEMPLATE_NAME = 'castme_plain_utility_v1';
const PLAIN_UTILITY_BODY = '{{1}}';
const MS_24H = 24 * 60 * 60 * 1000;

const campaignSendQueue = new Queue(QUEUE.CAMPAIGN_SEND, { connection });
const campaignRunQueue = new Queue(QUEUE.CAMPAIGN_RUN, { connection });


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
    const values = { ...((broadcast.variableValues || {}) as Record<string, string>) };
    const body = broadcast.template.body || broadcast.renderedBody || '';
    const orderedKeys = Object.keys(values)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));

    // Prefer contact name for {{1}} if empty
    if (orderedKeys.includes('1') && !values['1']?.trim() && recipient.contact.name) {
      values['1'] = recipient.contact.name;
    } else if (!values['1']?.trim() && recipient.contact.name && body.includes('{{1}}')) {
      values['1'] = recipient.contact.name;
    }

    const params = orderedKeys.map((k) => values[k] || '');
    const text = broadcast.template.isCustom
      ? String(values.text || broadcast.renderedBody || body || '').trim()
      : renderTemplatePreview(body, values);

    const result = await meta.sendTemplateMessage({
      pageId: broadcast.page.platformPageId,
      pageAccessToken: token,
      recipientPsid: recipient.contact.platformUserId,
      templateName: broadcast.template.metaName,
      text,
      bodyParameters: params,
      lastInteractionAt: recipient.contact.lastInteractionAt,
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

async function recordCampaignFailure(
  campaignId: string,
  code: string,
  message: string,
  pageId?: string,
  psid?: string
) {
  await prisma.broadcastCampaignFailure.create({
    data: { campaignId, code, message, pageId, psid },
  });
}

/** Per-page stagger so multiple Pages send in parallel (not one global serial queue). */
async function enqueueCampaignSends(
  campaignId: string,
  recipients: Array<{ id: string; campaignPageId: string }>,
  delayMs: number,
  jobIdSuffix = ''
) {
  const byPage = new Map<string, Array<{ id: string; campaignPageId: string }>>();
  for (const r of recipients) {
    const list = byPage.get(r.campaignPageId) || [];
    list.push(r);
    byPage.set(r.campaignPageId, list);
  }
  const delay = Math.max(0, delayMs);
  const adds: Promise<unknown>[] = [];
  for (const [, pageRecipients] of byPage) {
    for (let i = 0; i < pageRecipients.length; i++) {
      const r = pageRecipients[i]!;
      adds.push(
        campaignSendQueue.add(
          QUEUE.CAMPAIGN_SEND,
          { campaignId, recipientId: r.id },
          {
            delay: i * delay,
            jobId: `csend-${r.id}${jobIdSuffix}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }
        )
      );
    }
  }
  await Promise.all(adds);
}

async function assertAndConsumeQuota(userId: string, units: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.planExpiresAt && user.planExpiresAt.getTime() < Date.now()) {
    return false;
  }
  const updated = await prisma.userQuota.updateMany({
    where: { userId, creditsRemaining: { gte: units } },
    data: { creditsRemaining: { decrement: units } },
  });
  return updated.count > 0;
}

async function refundQuota(userId: string, units: number): Promise<void> {
  if (units <= 0) return;
  await prisma.userQuota.updateMany({
    where: { userId },
    data: { creditsRemaining: { increment: units } },
  });
}

async function handleCampaignRun(job: Job) {
  const { campaignId } = job.data as { campaignId: string };
  const campaign = await prisma.broadcastCampaign.findUnique({
    where: { id: campaignId },
    include: { pages: true },
  });
  if (!campaign) return;
  if (['completed', 'stopped', 'failed', 'paused'].includes(campaign.phase)) return;

  // Never wipe an in-progress audience — resume path owns PENDING requeues.
  const existingRecipients = await prisma.broadcastCampaignRecipient.count({ where: { campaignId } });
  if (existingRecipients > 0 && campaign.phase === 'sending') {
    await handleCampaignResume(job);
    return;
  }

  // Phase 1: setting_up_templates
  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      phase: 'setting_up_templates',
      phaseMessage: 'Still working — preparing UTILITY templates on each Page (not stuck).',
      startedAt: campaign.startedAt ?? new Date(),
    },
  });

  const utility = (campaign.utilityTemplate || {}) as {
    name?: string;
    body?: string;
    language?: string;
    parameters?: string[];
  };
  const templateName = utility.name || PLAIN_UTILITY_TEMPLATE_NAME;
  const templateBody = utility.body || (campaign.message ? PLAIN_UTILITY_BODY : PLAIN_UTILITY_BODY);
  const language = utility.language || 'en_US';

  for (const cp of campaign.pages) {
    if (campaign.phase === 'stopped') return;
    const fresh = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
    if (!fresh || fresh.phase === 'paused' || fresh.phase === 'stopped') return;

    if (cp.status !== 'ok' || !cp.encryptedPageToken) {
      await prisma.broadcastCampaignPage.update({
        where: { id: cp.id },
        data: { status: 'no_token', lastError: 'Missing page token' },
      });
      await recordCampaignFailure(campaignId, 'no_token', 'Page missing live token', cp.pageId);
      continue;
    }

    try {
      // Remint once per page before template work (avoids stale snapshot on multi-page).
      const token = await resolveCampaignPageToken(cp);
      // Prefer listing an existing approved template before creating.
      const listed = await meta.listMessageTemplates({
        pageId: cp.platformPageId,
        pageAccessToken: token,
        name: templateName,
      });
      const existing =
        listed.find((t) => t.name === templateName && t.status === 'APPROVED') ||
        listed.find((t) => t.name === templateName) ||
        listed.find((t) => t.name.toLowerCase() === templateName.toLowerCase());

      // Prefer Meta's stored language (often `en`) over campaign default `en_US`.
      const resolvedLanguage = existing?.language || language;

      let created: { externalTemplateId: string; status: string };
      if (existing) {
        // Never treat UNKNOWN as APPROVED — that caused multi-page UTILITY flops.
        created = {
          externalTemplateId: existing.id || `utility_${templateName}`,
          status: existing.status === 'UNKNOWN' ? 'PENDING' : existing.status,
        };
      } else {
        created = await meta.createUtilityTemplate({
          pageId: cp.platformPageId,
          pageAccessToken: token,
          name: templateName,
          category: 'UTILITY',
          language: resolvedLanguage,
          body: templateBody,
          exampleValues: utility.parameters?.length
            ? utility.parameters
            : [campaign.message || 'Example update'],
        });
      }

      // Wait until Meta reports a real APPROVED/REJECTED (incl. UNKNOWN/PENDING).
      if (created.status !== 'APPROVED' && created.status !== 'REJECTED') {
        await prisma.broadcastCampaign.update({
          where: { id: campaignId },
          data: {
            phaseMessage: `Still working — waiting for Meta to approve UTILITY on ${cp.pageName}…`,
          },
        });
        const waited = await meta.waitForUtilityTemplateApproved({
          pageId: cp.platformPageId,
          pageAccessToken: token,
          templateName,
          retries: 25,
          intervalMs: 3000,
        });
        created = {
          externalTemplateId: waited.externalTemplateId || created.externalTemplateId,
          status: waited.status === 'UNKNOWN' ? 'PENDING' : waited.status,
        };
      }

      await prisma.pageUtilityTemplate.upsert({
        where: {
          pageId_templateName_language: {
            pageId: cp.pageId,
            templateName,
            language: resolvedLanguage,
          },
        },
        create: {
          pageId: cp.pageId,
          templateName,
          language: resolvedLanguage,
          externalId: created.externalTemplateId,
          status: created.status === 'APPROVED' ? 'APPROVED' : created.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          body: templateBody,
          category: 'UTILITY',
        },
        update: {
          externalId: created.externalTemplateId,
          status: created.status === 'APPROVED' ? 'APPROVED' : created.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          body: templateBody,
        },
      });
      const ready = created.status === 'APPROVED';
      await prisma.broadcastCampaignPage.update({
        where: { id: cp.id },
        data: {
          templateReady: ready,
          utilityTemplateName: templateName,
          status: 'ok',
          lastError: ready
            ? null
            : created.status === 'REJECTED'
              ? 'UTILITY template rejected by Meta'
              : 'UTILITY template still pending Meta review',
        },
      });
      // Do NOT rewrite campaign-level language from one Page — other Pages keep their own
      // PageUtilityTemplate.language for sends.
      if (!ready) {
        await recordCampaignFailure(
          campaignId,
          created.status === 'REJECTED' ? 'template_rejected' : 'template_pending',
          created.status === 'REJECTED'
            ? `UTILITY template rejected on ${cp.pageName}`
            : `UTILITY template not APPROVED yet on ${cp.pageName} — outside-24h sends will fail until approved`,
          cp.pageId
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'template setup failed';
      // Keep page usable for in-24h RESPONSE sends; Utility may still be missing.
      await prisma.broadcastCampaignPage.update({
        where: { id: cp.id },
        data: {
          status: 'ok',
          lastError: message,
          templateReady: false,
          utilityTemplateName: templateName,
        },
      });
      await recordCampaignFailure(campaignId, 'template_setup', message, cp.pageId);
    }
  }

  // Phase 2: syncing_leads
  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      phase: 'syncing_leads',
      phaseMessage: 'Still working — syncing Messenger audience (PSIDs) for selected Pages.',
    },
  });

  const pagesNow = await prisma.broadcastCampaignPage.findMany({ where: { campaignId } });
  let totalRecipients = 0;
  await prisma.broadcastCampaignRecipient.deleteMany({ where: { campaignId } });

  for (const cp of pagesNow) {
    const fresh = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
    if (!fresh || fresh.phase === 'paused' || fresh.phase === 'stopped') return;
    if (cp.status !== 'ok' || !cp.encryptedPageToken) continue;

    let contacts = await prisma.contact.findMany({
      where: { pageId: cp.pageId, status: 'ACTIVE' },
      select: { platformUserId: true, name: true, lastInteractionAt: true },
    });

    const conn = await prisma.pageConnection.findFirst({
      where: { pageId: cp.pageId },
      orderBy: { updatedAt: 'desc' },
    });
    const stale =
      !conn?.lastSyncedAt || Date.now() - conn.lastSyncedAt.getTime() > 6 * 60 * 60 * 1000;
    if (!contacts.length || stale) {
      try {
        const token = await resolveCampaignPageToken(cp);
        let cursor: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const batch = await meta.fetchContacts({
            pageId: cp.platformPageId,
            pageAccessToken: token,
            cursor,
            limit: 50,
          });
          for (const c of batch.contacts) {
            await prisma.contact.upsert({
              where: {
                pageId_platformUserId: {
                  pageId: cp.pageId,
                  platformUserId: c.platformUserId,
                },
              },
              create: {
                pageId: cp.pageId,
                platformUserId: c.platformUserId,
                name: c.name,
                lastInteractionAt: c.lastInteractionAt ? new Date(c.lastInteractionAt) : null,
                status: 'ACTIVE',
              },
              update: {
                name: c.name ?? undefined,
                lastInteractionAt: c.lastInteractionAt ? new Date(c.lastInteractionAt) : undefined,
                // Do not force ACTIVE — blocked/invalid PSIDs stay suppressed until webhook re-engages.
              },
            });
          }
          cursor = batch.nextCursor;
          hasMore = batch.hasMore;
        }
        await prisma.pageConnection.updateMany({
          where: { pageId: cp.pageId },
          data: {
            lastSyncedAt: new Date(),
            contactCount: await prisma.contact.count({
              where: { pageId: cp.pageId, status: 'ACTIVE' },
            }),
            status: 'CONNECTED',
          },
        });
        contacts = await prisma.contact.findMany({
          where: { pageId: cp.pageId, status: 'ACTIVE' },
          select: { platformUserId: true, name: true, lastInteractionAt: true },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'audience sync failed';
        await recordCampaignFailure(campaignId, 'sync_failed', message, cp.pageId);
      }
    }

    if (contacts.length) {
      await prisma.broadcastCampaignRecipient.createMany({
        data: contacts.map((c) => ({
          campaignId,
          campaignPageId: cp.id,
          pageId: cp.pageId,
          psid: c.platformUserId,
          name: c.name,
          lastInteractionAt: c.lastInteractionAt,
          status: 'PENDING',
          idempotencyKey: createHash('sha256')
            .update(`${campaignId}:${cp.pageId}:${c.platformUserId}`)
            .digest('hex'),
        })),
        skipDuplicates: true,
      });
    }
    await prisma.broadcastCampaignPage.update({
      where: { id: cp.id },
      data: { recipientCount: contacts.length },
    });
    totalRecipients += contacts.length;
  }

  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      estimatedRecipients: totalRecipients,
      queuedCount: totalRecipients,
      phase: 'sending',
      phaseMessage: `Sending to ${totalRecipients} recipients…`,
    },
  });

  // Warm page tokens once (sequential) before parallel multi-page sends.
  const sendPages = await prisma.broadcastCampaignPage.findMany({
    where: { campaignId, status: 'ok' },
  });
  for (const cp of sendPages) {
    try {
      await resolveCampaignPageToken(cp);
    } catch (err) {
      logger.warn({ err, pageId: cp.pageId }, 'pre-send remint failed');
    }
  }

  const recipients = await prisma.broadcastCampaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });
  await enqueueCampaignSends(campaignId, recipients, campaign.delayMs || 500);

  if (!recipients.length) {
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: {
        phase: 'completed',
        completedAt: new Date(),
        phaseMessage: 'Completed — no eligible recipients found.',
      },
    });
  }
}

async function handleCampaignSend(job: Job) {
  const { campaignId, recipientId } = job.data as { campaignId: string; recipientId: string };
  const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;
  if (campaign.phase === 'paused') return;
  if (campaign.phase === 'stopped' || campaign.phase === 'completed' || campaign.phase === 'failed') {
    return;
  }

  const recipient = await prisma.broadcastCampaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaignPage: true },
  });
  if (!recipient || ['SENT', 'FAILED', 'SKIPPED'].includes(recipient.status)) return;

  const cp = recipient.campaignPage;
  if (cp.status !== 'ok' || !cp.encryptedPageToken) {
    await prisma.broadcastCampaignRecipient.update({
      where: { id: recipientId },
      data: { status: 'SKIPPED', failureReason: 'no_token' },
    });
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: { skippedCount: { increment: 1 }, queuedCount: { decrement: 1 } },
    });
    await maybeFinalizeCampaign(campaignId);
    return;
  }

  await prisma.broadcastCampaignRecipient.update({
    where: { id: recipientId },
    data: { status: 'SENDING', attemptCount: { increment: 1 } },
  });

  const quotaUnits = campaign.imageUrl || campaign.attachmentId ? 2 : 1;
  const reserved = await assertAndConsumeQuota(campaign.userId, quotaUnits);
  if (!reserved) {
    await prisma.$transaction([
      prisma.broadcastCampaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: 'quota_exceeded',
        },
      }),
      prisma.broadcastCampaign.update({
        where: { id: campaignId },
        data: { failedCount: { increment: 1 }, queuedCount: { decrement: 1 } },
      }),
    ]);
    await recordCampaignFailure(
      campaignId,
      'quota_exceeded',
      'Message quota exhausted or plan expired',
      cp.pageId,
      recipient.psid
    );
    await maybeFinalizeCampaign(campaignId);
    return;
  }

  const utility = (campaign.utilityTemplate || {}) as {
    name?: string;
    body?: string;
    language?: string;
    parameters?: string[];
  };
  const templateName = cp.utilityTemplateName || utility.name || PLAIN_UTILITY_TEMPLATE_NAME;
  const storedTpl = await prisma.pageUtilityTemplate.findFirst({
    where: {
      pageId: cp.pageId,
      templateName,
      status: 'APPROVED',
    },
    orderBy: { updatedAt: 'desc' },
  });
  const templateLanguage = storedTpl?.language || utility.language || 'en_US';
  const within24h =
    recipient.lastInteractionAt &&
    Date.now() - new Date(recipient.lastInteractionAt).getTime() <= MS_24H;
  const personalized = personalizeBroadcastMessage(campaign.message || 'Update', recipient.name);

  try {
    await acquirePageSendSlot(cp.platformPageId);

    const token = await resolveCampaignPageToken(cp);

    let result: { messageId: string };
    if (cp.templateReady) {
      // Prefer UTILITY first (reference Messenger tools) — not RESPONSE-first.
      const params =
        templateName === PLAIN_UTILITY_TEMPLATE_NAME
          ? [personalized]
          : (utility.parameters || []).map((p, idx) => {
              if (idx === 0) {
                return personalizeBroadcastMessage(p || personalized, recipient.name) ||
                  recipient.name ||
                  'Customer';
              }
              return personalizeBroadcastMessage(p, recipient.name) || p;
            });
      if (templateName !== PLAIN_UTILITY_TEMPLATE_NAME && params.length === 0) {
        params.push(recipient.name || personalized || 'Customer');
      }
      try {
        result = await meta.sendUtilityMessage({
          pageId: cp.platformPageId,
          pageAccessToken: token,
          recipientPsid: recipient.psid,
          templateName,
          languageCode: templateLanguage,
          bodyParameters: params.length ? params : [personalized],
          idempotencyKey: recipient.idempotencyKey,
        });
      } catch (utilErr) {
        // In-window fallback only — matches reference campaign-engine.
        if (!within24h) throw utilErr;
        result = await meta.sendResponseMessage({
          pageId: cp.platformPageId,
          pageAccessToken: token,
          recipientPsid: recipient.psid,
          text: personalized || undefined,
          imageUrl: campaign.imageUrl || undefined,
          attachmentId: campaign.attachmentId || undefined,
          idempotencyKey: `${recipient.idempotencyKey}:resp`,
        });
      }
    } else if (within24h) {
      result = await meta.sendResponseMessage({
        pageId: cp.platformPageId,
        pageAccessToken: token,
        recipientPsid: recipient.psid,
        text: personalized || undefined,
        imageUrl: campaign.imageUrl || undefined,
        attachmentId: campaign.attachmentId || undefined,
        idempotencyKey: recipient.idempotencyKey,
      });
    } else {
      await refundQuota(campaign.userId, quotaUnits);
      await prisma.broadcastCampaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: 'outside_24h_no_utility',
        },
      });
      await prisma.broadcastCampaign.update({
        where: { id: campaignId },
        data: { failedCount: { increment: 1 }, queuedCount: { decrement: 1 } },
      });
      await recordCampaignFailure(
        campaignId,
        'outside_24h_no_utility',
        'Recipient outside 24h window and UTILITY template not ready',
        cp.pageId,
        recipient.psid
      );
      await maybeFinalizeCampaign(campaignId);
      return;
    }

    await prisma.$transaction([
      prisma.broadcastCampaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          externalMessageId: result.messageId,
        },
      }),
      prisma.broadcastCampaignPage.update({
        where: { id: cp.id },
        data: { sentCount: { increment: 1 } },
      }),
      prisma.broadcastCampaign.update({
        where: { id: campaignId },
        data: { sentCount: { increment: 1 }, queuedCount: { decrement: 1 } },
      }),
    ]);
  } catch (err) {
    await refundQuota(campaign.userId, quotaUnits);
    const classified = classifyMetaSendError(err);

    if (classified.retryable) {
      await prisma.broadcastCampaignRecipient.update({
        where: { id: recipientId },
        data: { status: 'RETRYING', failureReason: classified.reason },
      });
      throw err;
    }

    // Permanent recipient issues — skip (not "failed send"), stop retrying, prune audience.
    if (
      classified.kind === 'recipient_unavailable' ||
      classified.kind === 'recipient_invalid'
    ) {
      if (classified.deactivateContact) {
        await prisma.contact.updateMany({
          where: { pageId: cp.pageId, platformUserId: recipient.psid },
          data: {
            status: classified.kind === 'recipient_unavailable' ? 'BLOCKED' : 'INACTIVE',
          },
        });
      }
      await prisma.$transaction([
        prisma.broadcastCampaignRecipient.update({
          where: { id: recipientId },
          data: {
            status: 'SKIPPED',
            failedAt: new Date(),
            failureReason: classified.reason,
          },
        }),
        prisma.broadcastCampaign.update({
          where: { id: campaignId },
          data: { skippedCount: { increment: 1 }, queuedCount: { decrement: 1 } },
        }),
      ]);
      // Sample only — avoid flooding failure list with expected unreachable PSIDs.
      if (Math.random() < 0.05) {
        await recordCampaignFailure(
          campaignId,
          classified.reason,
          classified.message,
          cp.pageId,
          recipient.psid
        );
      }
      await maybeFinalizeCampaign(campaignId);
      return;
    }

    await prisma.$transaction([
      prisma.broadcastCampaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: classified.reason,
        },
      }),
      prisma.broadcastCampaignPage.update({
        where: { id: cp.id },
        data: { failedCount: { increment: 1 } },
      }),
      prisma.broadcastCampaign.update({
        where: { id: campaignId },
        data: { failedCount: { increment: 1 }, queuedCount: { decrement: 1 } },
      }),
    ]);
    await recordCampaignFailure(
      campaignId,
      classified.reason,
      classified.message,
      cp.pageId,
      recipient.psid
    );
  }

  await maybeFinalizeCampaign(campaignId);
}

/** Resume: requeue PENDING only — never wipe audience / re-run full prepare. */
async function handleCampaignResume(job: Job) {
  const { campaignId } = job.data as { campaignId: string };
  const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;
  if (['completed', 'stopped', 'failed', 'paused'].includes(campaign.phase)) return;

  const recipients = await prisma.broadcastCampaignRecipient.findMany({
    where: { campaignId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  if (!recipients.length) {
    await maybeFinalizeCampaign(campaignId);
    return;
  }

  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      phase: 'sending',
      phaseMessage: `Resuming — ${recipients.length} pending sends…`,
      queuedCount: recipients.length,
    },
  });

  const delay = campaign.delayMs || 500;
  const stamp = Date.now();
  await enqueueCampaignSends(campaignId, recipients, delay, `-${stamp}`);
}

async function maybeFinalizeCampaign(campaignId: string) {
  const c = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
  if (!c || ['completed', 'stopped', 'failed', 'paused'].includes(c.phase)) return;
  const pending = await prisma.broadcastCampaignRecipient.count({
    where: { campaignId, status: { in: ['PENDING', 'SENDING', 'RETRYING'] } },
  });
  if (pending > 0) return;

  let phase: 'completed' | 'failed' = 'completed';
  // Skipped unreachable PSIDs are expected Meta noise — only fail when real send errors dominate.
  if (c.sentCount === 0 && c.failedCount > 0) phase = 'failed';
  const skipNote =
    c.skippedCount > 0
      ? ` ${c.skippedCount} skipped (unavailable/invalid recipients).`
      : '';
  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      phase,
      completedAt: new Date(),
      phaseMessage:
        phase === 'failed'
          ? `Failed — ${c.failedCount} failed, ${c.sentCount} sent.${skipNote}`
          : `Finished — ${c.sentCount} sent, ${c.failedCount} failed, ${c.skippedCount} skipped.${skipNote}`,
      queuedCount: 0,
    },
  });
  await notify(
    c.userId,
    phase === 'failed' ? 'BROADCAST_FAILED' : 'BROADCAST_COMPLETED',
    phase === 'failed' ? 'Campaign failed' : 'Campaign completed',
    `Campaign finished with ${c.sentCount} sent, ${c.failedCount} failed, ${c.skippedCount} skipped.`
  );
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
  makeWorker(QUEUE.CAMPAIGN_RUN, handleCampaignRun, 1),
  makeWorker(QUEUE.CAMPAIGN_SEND, handleCampaignSend, config.BROADCAST_CONCURRENT_SENDS),
  makeWorker(QUEUE.CAMPAIGN_RESUME, handleCampaignResume, 1),
  makeWorker(QUEUE.NOTIFICATIONS, async () => undefined, 1),
  makeWorker(QUEUE.ANALYTICS, async () => undefined, 1),
];

logger.info({ queues: Object.values(QUEUE), provider: config.META_PROVIDER }, 'workers started');

async function shutdown() {
  logger.info('shutting down workers');
  await Promise.all(workers.map((w) => w.close()));
  await campaignSendQueue.close();
  await campaignRunQueue.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

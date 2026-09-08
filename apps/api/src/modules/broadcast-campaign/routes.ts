import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../lib/auth.js';
import { requireCsrf } from '../../lib/csrf.js';
import {
  assertQuotaAvailable,
  estimateQuotaUnits,
  findActiveCampaign,
  PLAIN_UTILITY_BODY,
  PLAIN_UTILITY_TEMPLATE_NAME,
  requirePermission,
  speedToDelayMs,
  STARTER_UTILITY_TEMPLATES,
  ensureUserQuota,
  consumeQuota,
} from '../../lib/campaign.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { decryptSecret } from '../../lib/crypto.js';
import { metaProvider } from '../../lib/meta.js';
import { enqueue, QUEUE_NAMES } from '../../lib/queues.js';
import { writeAuditLog } from '../../lib/audit.js';
import { assertUserOwnsPage } from '../../lib/ownership.js';

const createCampaignSchema = z.object({
  pages: z.array(z.object({ id: z.string().min(1), name: z.string().optional() })).min(1),
  message: z.string().max(2000).optional(),
  image_url: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  speed_preset: z.enum(['safe', 'fast', 'turbo', 'custom']).optional(),
  delay_ms: z.number().int().min(0).max(60_000).optional(),
  utility_template: z
    .object({
      id: z.string().optional(),
      name: z.string().min(1),
      body: z.string().optional(),
      language: z.string().optional(),
      parameters: z.array(z.string()).optional(),
    })
    .optional(),
  delivery_mode: z.enum(['freeform_plain', 'named_utility']).optional(),
  per_page: z
    .record(
      z.object({
        message: z.string().optional(),
        image_url: z.string().optional(),
      })
    )
    .optional(),
  outside24h_image_mode: z.boolean().optional(),
});

function etaSeconds(remaining: number, delayMs: number) {
  return Math.ceil((remaining * Math.max(delayMs, 1)) / 1000);
}

export async function broadcastCampaignRoutes(app: FastifyInstance) {
  app.post('/api/broadcast/campaigns', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    await requirePermission(user, 'broadcast.send');

    const body = createCampaignSchema.parse(request.body);
    if (!body.message?.trim() && !body.image_url && !body.utility_template) {
      throw new AppError('VALIDATION', 'Provide a message, image, or utility template.', 400);
    }

    const active = await findActiveCampaign(user.id);
    if (active) {
      throw new AppError(
        'CONFLICT',
        'Another campaign is already running. Pause/stop it before starting a new one.',
        409
      );
    }

    const account = await prisma.facebookAccount.findFirst({
      where: { userId: user.id, status: 'CONNECTED' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!account?.encryptedAccessToken) {
      throw new AppError('FACEBOOK_EXPIRED', 'Reconnect Facebook to send broadcasts.', 403);
    }

    const pageInputs = body.pages;
    const resolvedPages = [];
    for (const p of pageInputs) {
      // Accept either internal UUID pageId or platform page id
      const page =
        (await prisma.facebookPage.findFirst({
          where: {
            OR: [{ id: p.id }, { platformPageId: p.id }],
            connections: { some: { userId: user.id, status: { not: 'DISCONNECTED' } } },
          },
        })) || null;

      if (!page) {
        resolvedPages.push({
          inputId: p.id,
          status: 'no_token' as const,
          page: null,
        });
        continue;
      }
      if (!page.encryptedPageToken) {
        resolvedPages.push({ inputId: p.id, status: 'no_token' as const, page });
        continue;
      }
      resolvedPages.push({ inputId: p.id, status: 'ok' as const, page });
    }

    const okPages = resolvedPages.filter((p) => p.status === 'ok' && p.page);
    if (!okPages.length) {
      throw new AppError(
        'FACEBOOK_EXPIRED',
        'No selected pages have a live page token. Reconnect Facebook and tick your Pages.',
        403
      );
    }

    const pageIds = okPages.map((p) => p.page!.id);
    const contactCounts = await prisma.contact.groupBy({
      by: ['pageId'],
      where: { pageId: { in: pageIds }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    const estimatedRecipients = contactCounts.reduce((sum, c) => sum + c._count._all, 0);
    const speed = speedToDelayMs(body.speed_preset, body.delay_ms);
    const estimatedQuota = estimateQuotaUnits({
      recipients: Math.max(estimatedRecipients, 1),
      hasImage: Boolean(body.image_url),
      outside24hImageMode: body.outside24h_image_mode,
    });
    await assertQuotaAvailable(user.id, estimatedQuota);

    const utilityTemplate =
      body.utility_template ||
      (body.delivery_mode === 'freeform_plain' || body.message
        ? {
            name: PLAIN_UTILITY_TEMPLATE_NAME,
            body: PLAIN_UTILITY_BODY,
            language: 'en_US',
            parameters: ['message'],
          }
        : undefined);

    const campaign = await prisma.broadcastCampaign.create({
      data: {
        userId: user.id,
        phase: 'queued',
        message: body.message || null,
        imageUrl: body.image_url || null,
        speedPreset: speed.speedPreset,
        delayMs: speed.delayMs,
        deliveryMode: body.delivery_mode || (body.utility_template ? 'named_utility' : 'freeform_plain'),
        utilityTemplate: utilityTemplate as object | undefined,
        outside24hImageMode: Boolean(body.outside24h_image_mode),
        estimatedRecipients,
        estimatedQuota,
        phaseMessage: 'Queued — worker will set up templates next.',
        pages: {
          create: resolvedPages
            .filter((p) => p.page)
            .map((p) => ({
              pageId: p.page!.id,
              platformPageId: p.page!.platformPageId,
              pageName: p.page!.name,
              encryptedPageToken: p.status === 'ok' ? p.page!.encryptedPageToken : null,
              status: p.status === 'ok' ? 'ok' : 'no_token',
              utilityTemplateName: utilityTemplate?.name,
            })),
        },
      },
      include: { pages: true },
    });

    await enqueue(QUEUE_NAMES.CAMPAIGN_RUN, { campaignId: campaign.id }, { jobId: `campaign-${campaign.id}` });
    await writeAuditLog({
      actorId: user.id,
      action: 'campaign.created',
      resource: 'broadcast_campaign',
      resourceId: campaign.id,
      ip: request.ip,
      metadata: { estimatedRecipients, pages: okPages.length },
    });

    return {
      success: true,
      campaignId: campaign.id,
      estimatedRecipients,
      estimatedQuota,
      speed: speed.speedPreset,
      skippedPages: resolvedPages.filter((p) => p.status !== 'ok').map((p) => p.inputId),
    };
  });

  app.get('/api/broadcast/campaigns/active', async (request) => {
    const user = await requireUser(request);
    const campaign = await findActiveCampaign(user.id);
    if (!campaign) return { campaign: null };
    return { campaign: await loadCampaign(campaign.id, user.id) };
  });

  app.get('/api/broadcast/campaigns', async (request) => {
    const user = await requireUser(request);
    const rows = await prisma.broadcastCampaign.findMany({
      where: { userId: user.id, dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { pages: { select: { pageName: true, status: true } } },
    });
    return { campaigns: rows };
  });

  app.get('/api/broadcast/campaigns/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    return { campaign: await loadCampaign(id, user.id) };
  });

  app.get('/api/broadcast/campaigns/:id/failures', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    await loadCampaign(id, user.id);
    const q = request.query as { page?: string; pageSize?: string };
    const page = Number(q.page || 1);
    const pageSize = Math.min(Number(q.pageSize || 50), 100);
    const [total, data] = await Promise.all([
      prisma.broadcastCampaignFailure.count({ where: { campaignId: id } }),
      prisma.broadcastCampaignFailure.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  });

  for (const action of ['pause', 'resume', 'stop', 'dismiss'] as const) {
    app.post(`/api/broadcast/campaigns/:id/${action}`, async (request) => {
      const user = await requireUser(request);
      requireCsrf(request);
      await requirePermission(user, 'broadcast.send');
      const { id } = request.params as { id: string };
      const campaign = await prisma.broadcastCampaign.findFirst({
        where: { id, userId: user.id },
      });
      if (!campaign) throw new AppError('NOT_FOUND', 'Campaign not found.', 404);

      if (action === 'pause') {
        if (!['sending', 'syncing_leads', 'setting_up_templates', 'queued'].includes(campaign.phase)) {
          throw new AppError('INVALID_TRANSITION', `Cannot pause from ${campaign.phase}.`, 409);
        }
        // Reset in-flight sends so resume can requeue without wiping audience.
        await prisma.broadcastCampaignRecipient.updateMany({
          where: { campaignId: id, status: { in: ['SENDING', 'RETRYING'] } },
          data: { status: 'PENDING', failureReason: null },
        });
        const updated = await prisma.broadcastCampaign.update({
          where: { id },
          data: { phase: 'paused', phaseMessage: 'Paused by user.' },
        });
        return { campaign: updated };
      }
      if (action === 'resume') {
        if (campaign.phase !== 'paused') {
          throw new AppError('INVALID_TRANSITION', 'Only paused campaigns can be resumed.', 409);
        }
        const pendingLeft = await prisma.broadcastCampaignRecipient.count({
          where: { campaignId: id, status: 'PENDING' },
        });
        const anyRecipients = await prisma.broadcastCampaignRecipient.count({
          where: { campaignId: id },
        });
        const updated = await prisma.broadcastCampaign.update({
          where: { id },
          data: {
            phase: anyRecipients > 0 ? 'sending' : 'queued',
            phaseMessage:
              anyRecipients > 0
                ? `Resuming ${pendingLeft} pending sends…`
                : 'Resuming — finishing prepare then send…',
          },
        });
        // Never re-run full prepare when recipients already exist (wipes progress).
        if (anyRecipients > 0) {
          await enqueue(
            QUEUE_NAMES.CAMPAIGN_RESUME,
            { campaignId: id },
            { jobId: `campaign-resume-${id}-${Date.now()}` }
          );
        } else {
          await enqueue(
            QUEUE_NAMES.CAMPAIGN_RUN,
            { campaignId: id },
            { jobId: `campaign-rerun-${id}-${Date.now()}` }
          );
        }
        return { campaign: updated };
      }
      if (action === 'stop') {
        const updated = await prisma.broadcastCampaign.update({
          where: { id },
          data: {
            phase: 'stopped',
            completedAt: new Date(),
            phaseMessage: 'Stopped by user.',
          },
        });
        return { campaign: updated };
      }
      const updated = await prisma.broadcastCampaign.update({
        where: { id },
        data: { dismissedAt: new Date() },
      });
      return { campaign: updated };
    });
  }

  app.get('/api/broadcast/outside24h-status', async (request) => {
    const user = await requireUser(request);
    const q = request.query as { page_ids?: string; template_name?: string };
    const ids = (q.page_ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const templateName = q.template_name || PLAIN_UTILITY_TEMPLATE_NAME;
    const pages = [];
    for (const raw of ids) {
      const page = await prisma.facebookPage.findFirst({
        where: {
          OR: [{ id: raw }, { platformPageId: raw }],
          connections: { some: { userId: user.id } },
        },
        include: {
          utilityTemplates: {
            where: { templateName },
            take: 1,
          },
        },
      });
      if (!page) {
        pages.push({ page_id: raw, status: 'no_token' });
        continue;
      }
      if (!page.encryptedPageToken) {
        pages.push({ page_id: page.id, platform_page_id: page.platformPageId, status: 'no_token' });
        continue;
      }
      const tpl = page.utilityTemplates[0];
      if (!tpl) pages.push({ page_id: page.id, platform_page_id: page.platformPageId, status: 'pending' });
      else if (tpl.status === 'APPROVED')
        pages.push({ page_id: page.id, platform_page_id: page.platformPageId, status: 'ready', template: tpl });
      else if (tpl.status === 'REJECTED' || tpl.status === 'DISABLED')
        pages.push({
          page_id: page.id,
          platform_page_id: page.platformPageId,
          status: 'ineligible',
          template: tpl,
        });
      else
        pages.push({ page_id: page.id, platform_page_id: page.platformPageId, status: 'pending', template: tpl });
    }
    return { pages, template_name: templateName };
  });

  app.post('/api/broadcast/prepare-outside24h', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    await requirePermission(user, 'broadcast.send');
    const body = z
      .object({
        page_id: z.string().min(1),
        template_name: z.string().optional(),
        body: z.string().optional(),
        language: z.string().optional(),
        example_values: z.array(z.string()).optional(),
      })
      .parse(request.body);

    await assertUserOwnsPage(user.id, body.page_id);
    const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: body.page_id } });
    const name = body.template_name || PLAIN_UTILITY_TEMPLATE_NAME;
    const tplBody = body.body || PLAIN_UTILITY_BODY;
    const created = await metaProvider.createUtilityTemplate({
      pageId: page.platformPageId,
      pageAccessToken: decryptSecret(page.encryptedPageToken),
      name,
      category: 'UTILITY',
      language: body.language || 'en_US',
      body: tplBody,
      exampleValues: body.example_values || ['Hello from CastMe Pro'],
    });
    const row = await prisma.pageUtilityTemplate.upsert({
      where: {
        pageId_templateName_language: {
          pageId: page.id,
          templateName: name,
          language: body.language || 'en_US',
        },
      },
      create: {
        pageId: page.id,
        templateName: name,
        language: body.language || 'en_US',
        externalId: created.externalTemplateId,
        status: created.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
        body: tplBody,
        category: 'UTILITY',
      },
      update: {
        externalId: created.externalTemplateId,
        status: created.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
        body: tplBody,
      },
    });
    return { template: row };
  });

  app.post('/api/broadcast/prepare-starter-pack', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    await requirePermission(user, 'broadcast.send');
    const body = z.object({ page_id: z.string().min(1) }).parse(request.body);
    await assertUserOwnsPage(user.id, body.page_id);
    const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: body.page_id } });
    const token = decryptSecret(page.encryptedPageToken);
    const results = [];
    for (const starter of STARTER_UTILITY_TEMPLATES) {
      const created = await metaProvider.createUtilityTemplate({
        pageId: page.platformPageId,
        pageAccessToken: token,
        name: starter.name,
        category: 'UTILITY',
        language: 'en_US',
        body: starter.body,
        exampleValues: starter.parameters.map((p, i) => `example_${i + 1}_${p}`),
      });
      const row = await prisma.pageUtilityTemplate.upsert({
        where: {
          pageId_templateName_language: {
            pageId: page.id,
            templateName: starter.name,
            language: 'en_US',
          },
        },
        create: {
          pageId: page.id,
          templateName: starter.name,
          language: 'en_US',
          externalId: created.externalTemplateId,
          status: created.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
          body: starter.body,
          category: 'UTILITY',
        },
        update: {
          externalId: created.externalTemplateId,
          status: created.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
          body: starter.body,
        },
      });
      results.push(row);
    }
    // Also prepare plain freeform wrapper
    const plain = await metaProvider.createUtilityTemplate({
      pageId: page.platformPageId,
      pageAccessToken: token,
      name: PLAIN_UTILITY_TEMPLATE_NAME,
      category: 'UTILITY',
      language: 'en_US',
      body: PLAIN_UTILITY_BODY,
      exampleValues: ['Your update message here'],
    });
    results.push(
      await prisma.pageUtilityTemplate.upsert({
        where: {
          pageId_templateName_language: {
            pageId: page.id,
            templateName: PLAIN_UTILITY_TEMPLATE_NAME,
            language: 'en_US',
          },
        },
        create: {
          pageId: page.id,
          templateName: PLAIN_UTILITY_TEMPLATE_NAME,
          language: 'en_US',
          externalId: plain.externalTemplateId,
          status: plain.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
          body: PLAIN_UTILITY_BODY,
          category: 'UTILITY',
        },
        update: {
          externalId: plain.externalTemplateId,
          status: plain.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
        },
      })
    );
    return { templates: results, starters: STARTER_UTILITY_TEMPLATES };
  });

  app.post('/api/broadcast/prepare-image', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    const body = z
      .object({ page_id: z.string().min(1), image_url: z.string().url() })
      .parse(request.body);
    await assertUserOwnsPage(user.id, body.page_id);
    const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: body.page_id } });
    if (!metaProvider.uploadMessageAttachment) {
      throw new AppError('FACEBOOK_ERROR', 'Image upload is not available.', 502);
    }
    const uploaded = await metaProvider.uploadMessageAttachment({
      pageId: page.platformPageId,
      pageAccessToken: decryptSecret(page.encryptedPageToken),
      imageUrl: body.image_url,
    });
    return { attachment_id: uploaded.attachmentId, image_url: body.image_url };
  });

  app.post('/api/broadcast/prepare-message-card', async (request) => {
    await requireUser(request);
    requireCsrf(request);
    const body = z.object({ message: z.string().min(1).max(2000) }).parse(request.body);
    return {
      utility_template: {
        name: PLAIN_UTILITY_TEMPLATE_NAME,
        body: PLAIN_UTILITY_BODY,
        language: 'en_US',
        parameters: [body.message],
        message: body.message,
      },
    };
  });

  app.get('/api/broadcast/audience/status', async (request) => {
    const user = await requireUser(request);
    const connections = await prisma.pageConnection.findMany({
      where: { userId: user.id, status: { not: 'DISCONNECTED' } },
      include: { page: true },
    });
    return {
      pages: connections.map((c) => ({
        page_id: c.pageId,
        name: c.page.name,
        contact_count: c.contactCount,
        last_synced_at: c.lastSyncedAt,
        status: c.status,
      })),
    };
  });

  app.post('/api/broadcast/audience/sync', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    const body = z.object({ page_id: z.string().uuid() }).parse(request.body);
    await assertUserOwnsPage(user.id, body.page_id);
    const syncJob = await prisma.syncJob.create({
      data: { pageId: body.page_id, status: 'PENDING' },
    });
    await prisma.pageConnection.updateMany({
      where: { userId: user.id, pageId: body.page_id },
      data: { status: 'SYNCING' },
    });
    await enqueue(QUEUE_NAMES.FACEBOOK_SYNC, {
      syncJobId: syncJob.id,
      pageId: body.page_id,
      userId: user.id,
    });
    return { syncJobId: syncJob.id, status: 'PENDING' };
  });

  app.get('/api/broadcast/audience/sync/status', async (request) => {
    const user = await requireUser(request);
    const q = request.query as { sync_job_id?: string; page_id?: string };
    if (q.sync_job_id) {
      const job = await prisma.syncJob.findUnique({ where: { id: q.sync_job_id } });
      if (!job) throw new AppError('NOT_FOUND', 'Sync job not found.', 404);
      await assertUserOwnsPage(user.id, job.pageId);
      return { job };
    }
    if (q.page_id) {
      await assertUserOwnsPage(user.id, q.page_id);
      const job = await prisma.syncJob.findFirst({
        where: { pageId: q.page_id },
        orderBy: { createdAt: 'desc' },
      });
      return { job };
    }
    throw new AppError('VALIDATION', 'sync_job_id or page_id required.', 400);
  });

  app.get('/api/broadcast/recipients', async (request) => {
    const user = await requireUser(request);
    const q = request.query as { page_id?: string; page?: string; pageSize?: string };
    if (!q.page_id) throw new AppError('VALIDATION', 'page_id is required.', 400);
    await assertUserOwnsPage(user.id, q.page_id);
    const page = Number(q.page || 1);
    const pageSize = Math.min(Number(q.pageSize || 50), 100);
    const [total, data] = await Promise.all([
      prisma.contact.count({ where: { pageId: q.page_id, status: 'ACTIVE' } }),
      prisma.contact.findMany({
        where: { pageId: q.page_id, status: 'ACTIVE' },
        orderBy: { lastInteractionAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          platformUserId: true,
          name: true,
          lastInteractionAt: true,
          profileImage: true,
        },
      }),
    ]);
    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  });

  app.get('/api/user/quota', async (request) => {
    const user = await requireUser(request);
    const quota = await ensureUserQuota(user.id);
    return { quota };
  });

  app.get('/api/broadcast/capacity', async (request) => {
    const user = await requireUser(request);
    const [quota, settings, active] = await Promise.all([
      ensureUserQuota(user.id),
      prisma.userSettings.findUnique({ where: { userId: user.id } }),
      findActiveCampaign(user.id),
    ]);
    return {
      quota,
      settings: {
        messagesPerSecond: settings?.messagesPerSecond ?? 5,
        messagesPerMinute: settings?.messagesPerMinute ?? 200,
        concurrentSends: settings?.concurrentSends ?? 3,
      },
      hasActiveCampaign: Boolean(active),
      activeCampaignId: active?.id ?? null,
    };
  });

  app.post('/api/broadcast/send-one', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    await requirePermission(user, 'broadcast.send');
    const body = z
      .object({
        page_id: z.string().uuid(),
        psid: z.string().min(1),
        message: z.string().min(1).max(2000),
      })
      .parse(request.body);
    await assertUserOwnsPage(user.id, body.page_id);
    await assertQuotaAvailable(user.id, 1);
    const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: body.page_id } });
    const result = await metaProvider.sendResponseMessage({
      pageId: page.platformPageId,
      pageAccessToken: decryptSecret(page.encryptedPageToken),
      recipientPsid: body.psid,
      text: body.message,
      idempotencyKey: createHash('sha256').update(`one:${page.id}:${body.psid}:${Date.now()}`).digest('hex'),
    });
    await consumeQuota(user.id, 1);
    return { success: true, message_id: result.messageId };
  });

  app.get('/api/broadcast/templates', async (request) => {
    const user = await requireUser(request);
    const drafts = await prisma.broadcastTemplateDraft.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return { drafts, starters: STARTER_UTILITY_TEMPLATES };
  });

  app.post('/api/broadcast/templates', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    const body = z
      .object({
        name: z.string().min(1).max(120),
        body: z.string().min(1).max(5000),
        image_url: z.string().url().optional(),
        meta: z.record(z.unknown()).optional(),
      })
      .parse(request.body);
    const draft = await prisma.broadcastTemplateDraft.create({
      data: {
        userId: user.id,
        name: body.name,
        body: body.body,
        imageUrl: body.image_url,
        meta: body.meta as object | undefined,
      },
    });
    return { draft };
  });

  app.get('/api/schedules', async (request) => {
    const user = await requireUser(request);
    const schedules = await prisma.scheduledBroadcast.findMany({
      where: { userId: user.id },
      orderBy: { scheduledAt: 'asc' },
    });
    return { schedules };
  });

  app.post('/api/schedules', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    const body = z
      .object({
        scheduled_at: z.string().datetime(),
        payload: z.record(z.unknown()),
      })
      .parse(request.body);
    const schedule = await prisma.scheduledBroadcast.create({
      data: {
        userId: user.id,
        scheduledAt: new Date(body.scheduled_at),
        payload: body.payload as object,
        status: 'SCHEDULED',
      },
    });
    return { schedule };
  });
}

async function loadCampaign(id: string, userId: string) {
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, userId },
    include: {
      pages: true,
    },
  });
  if (!campaign) throw new AppError('NOT_FOUND', 'Campaign not found.', 404);
  const remaining = Math.max(
    0,
    campaign.estimatedRecipients - campaign.sentCount - campaign.failedCount - campaign.skippedCount
  );
  return {
    ...campaign,
    etaSeconds: etaSeconds(remaining, campaign.delayMs),
    remaining,
    active: ['queued', 'setting_up_templates', 'syncing_leads', 'sending', 'paused'].includes(
      campaign.phase
    ),
  };
}

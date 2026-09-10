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
import { AppError, mapMetaError } from '../../lib/errors.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { metaProvider } from '../../lib/meta.js';
import { enqueue, QUEUE_NAMES } from '../../lib/queues.js';
import { writeAuditLog } from '../../lib/audit.js';
import { assertUserOwnsPage } from '../../lib/ownership.js';
import { logger } from '../../lib/logger.js';
import { enqueueUtilityEnsure, enqueueUtilityEnsureForUser } from '../../lib/utility-auto.js';

/** HTTP handlers must stay well under Railway/proxy timeouts (~30s). */
const HTTP_TEMPLATE_WAIT = { waitRetries: 2, waitIntervalMs: 1500 } as const; // ~3s
const WORKER_TEMPLATE_WAIT = { waitRetries: 40, waitIntervalMs: 3000 } as const; // ~2min

async function remintPageAccessToken(page: {
  id: string;
  platformPageId: string;
  encryptedPageToken: string;
  facebookAccountId: string;
}): Promise<string> {
  let token = decryptSecret(page.encryptedPageToken);
  try {
    const account = await prisma.facebookAccount.findUnique({
      where: { id: page.facebookAccountId },
    });
    if (account?.encryptedAccessToken && metaProvider.remintPageTokensFromUserToken) {
      const pages = await metaProvider.remintPageTokensFromUserToken(
        decryptSecret(account.encryptedAccessToken)
      );
      const hit = pages.find((p) => p.id === page.platformPageId);
      if (hit?.accessToken) {
        token = hit.accessToken;
        await prisma.facebookPage.update({
          where: { id: page.id },
          data: { encryptedPageToken: encryptSecret(token) },
        });
      }
    }
  } catch (err) {
    logger.warn({ err, pageId: page.id }, 'prepare: page token remint skipped');
  }
  return token;
}

/** Ensure Instant plain UTILITY exists on a Page — list first, create only if missing. */
async function ensurePlainUtilityOnPage(
  pageId: string,
  opts?: { waitForApproved?: boolean; waitRetries?: number; waitIntervalMs?: number }
): Promise<{
  pageId: string;
  status: string;
  language: string;
  externalId: string;
  error?: string;
}> {
  const waitForApproved = opts?.waitForApproved ?? false;
  const waitRetries = opts?.waitRetries ?? HTTP_TEMPLATE_WAIT.waitRetries;
  const waitIntervalMs = opts?.waitIntervalMs ?? HTTP_TEMPLATE_WAIT.waitIntervalMs;
  const name = PLAIN_UTILITY_TEMPLATE_NAME;
  const tplBody = PLAIN_UTILITY_BODY;

  const dbApproved = await prisma.pageUtilityTemplate.findFirst({
    where: { pageId, templateName: name, status: 'APPROVED' },
    orderBy: { updatedAt: 'desc' },
  });
  if (dbApproved) {
    return {
      pageId,
      status: 'APPROVED',
      language: dbApproved.language || 'en',
      externalId: dbApproved.externalId || `utility_${name}`,
    };
  }

  const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: pageId } });
  const token = await remintPageAccessToken(page);

  const persist = async (
    status: 'APPROVED' | 'PENDING' | 'REJECTED',
    language: string,
    externalId: string
  ) => {
    return prisma.pageUtilityTemplate.upsert({
      where: {
        pageId_templateName_language: {
          pageId: page.id,
          templateName: name,
          language,
        },
      },
      create: {
        pageId: page.id,
        templateName: name,
        language,
        externalId,
        status,
        body: tplBody,
        category: 'UTILITY',
      },
      update: {
        externalId,
        status,
        body: tplBody,
      },
    });
  };

  const waitIfNeeded = async (
    status: 'APPROVED' | 'PENDING' | 'REJECTED',
    language: string,
    externalId: string
  ) => {
    if (status !== 'PENDING' || !waitForApproved) {
      const row = await persist(status, language, externalId);
      return {
        pageId: page.id,
        status: row.status,
        language: row.language,
        externalId: row.externalId || externalId,
      };
    }
    const waited = await metaProvider.waitForUtilityTemplateApproved({
      pageId: page.platformPageId,
      pageAccessToken: token,
      templateName: name,
      retries: waitRetries,
      intervalMs: waitIntervalMs,
    });
    const next: 'APPROVED' | 'PENDING' | 'REJECTED' =
      waited.status === 'APPROVED'
        ? 'APPROVED'
        : waited.status === 'REJECTED'
          ? 'REJECTED'
          : 'PENDING';
    const row = await persist(next, language, waited.externalTemplateId || externalId);
    return {
      pageId: page.id,
      status: row.status,
      language: row.language,
      externalId: row.externalId || waited.externalTemplateId || externalId,
    };
  };

  const langs = ['en', 'en_US'] as const;
  try {
    for (const language of langs) {
      const listed = await metaProvider.listMessageTemplates({
        pageId: page.platformPageId,
        pageAccessToken: token,
        name,
        deepScan: true,
      });
      const hit =
        listed.find((t) => t.name === name && t.status === 'APPROVED') ||
        listed.find((t) => t.name === name) ||
        listed.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (hit) {
        const status: 'APPROVED' | 'PENDING' | 'REJECTED' =
          hit.status === 'APPROVED' ? 'APPROVED' : hit.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
        return waitIfNeeded(status, hit.language || language, hit.id || `utility_${name}`);
      }
    }
  } catch (err) {
    logger.warn({ err, pageId }, 'plain UTILITY list failed — trying create');
  }

  let lastErr = 'create failed';
  for (const language of langs) {
    try {
      const created = await metaProvider.createUtilityTemplate({
        pageId: page.platformPageId,
        pageAccessToken: token,
        name,
        category: 'UTILITY',
        language,
        body: tplBody,
        exampleValues: ['Hello from CastMe Pro'],
      });
      const status: 'APPROVED' | 'PENDING' | 'REJECTED' =
        created.status === 'APPROVED'
          ? 'APPROVED'
          : created.status === 'REJECTED'
            ? 'REJECTED'
            : 'PENDING';
      return waitIfNeeded(status, language, created.externalTemplateId);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      logger.warn({ err, pageId, language }, 'prepare plain UTILITY create attempt failed');
    }
  }

  return {
    pageId: page.id,
    status: 'error',
    language: 'en',
    externalId: '',
    error: lastErr.slice(0, 400),
  };
}

/** Page Instant–style: pull Meta message_templates into page_utility_templates. */
async function syncPageUtilityTemplates(
  pageId: string,
  opts?: { templateName?: string }
): Promise<{ upserted: number }> {
  const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: pageId } });
  const token = await remintPageAccessToken(page);
  const listed = await metaProvider.listMessageTemplates({
    pageId: page.platformPageId,
    pageAccessToken: token,
    name: opts?.templateName,
    // Name-scoped: light. Full inventory: bounded deep scan.
    deepScan: !opts?.templateName,
  });
  let upserted = 0;
  for (const t of listed) {
    const status =
      t.status === 'APPROVED' ? 'APPROVED' : t.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    const language = t.language || 'en';
    await prisma.pageUtilityTemplate.upsert({
      where: {
        pageId_templateName_language: {
          pageId: page.id,
          templateName: t.name,
          language,
        },
      },
      create: {
        pageId: page.id,
        templateName: t.name,
        language,
        externalId: t.id || `utility_${t.name}`,
        status,
        category: t.category || 'UTILITY',
      },
      update: {
        externalId: t.id || `utility_${t.name}`,
        status,
        category: t.category || 'UTILITY',
      },
    });
    upserted += 1;
  }
  return { upserted };
}

/**
 * Warm: reuse APPROVED Meta template (DB first — no full Meta inventory on every pick).
 * Cold: create UTILITY + short wait; long poll continues in background.
 */
async function ensureNamedUtilityOnPage(params: {
  pageId: string;
  templateName: string;
  body: string;
  language?: string;
  exampleValues?: string[];
  waitForApproved?: boolean;
  waitRetries?: number;
  waitIntervalMs?: number;
  /** Skip expensive full inventory sync (default true for HTTP library path). */
  skipFullSync?: boolean;
}): Promise<{
  pageId: string;
  status: string;
  language: string;
  externalId: string;
  name: string;
  path: 'warm' | 'cold' | 'error';
  error?: string;
}> {
  const waitForApproved = params.waitForApproved ?? true;
  const waitRetries = params.waitRetries ?? HTTP_TEMPLATE_WAIT.waitRetries;
  const waitIntervalMs = params.waitIntervalMs ?? HTTP_TEMPLATE_WAIT.waitIntervalMs;
  const name = params.templateName;
  const tplBody = params.body;
  const preferred = (params.language || 'en').trim() || 'en';
  const langs = Array.from(new Set([preferred, 'en', 'en_US']));
  const skipFullSync = params.skipFullSync !== false;

  // Fast path: library already approved this name on this Page.
  const dbApproved = await prisma.pageUtilityTemplate.findFirst({
    where: { pageId: params.pageId, templateName: name, status: 'APPROVED' },
    orderBy: { updatedAt: 'desc' },
  });
  if (dbApproved) {
    return {
      pageId: params.pageId,
      status: 'APPROVED',
      language: dbApproved.language || preferred,
      externalId: dbApproved.externalId || `utility_${name}`,
      name,
      path: 'warm',
    };
  }

  if (!skipFullSync) {
    try {
      await syncPageUtilityTemplates(params.pageId);
    } catch (err) {
      logger.warn({ err, pageId: params.pageId }, 'utility sync before ensure failed');
    }
  } else {
    try {
      await syncPageUtilityTemplates(params.pageId, { templateName: name });
    } catch (err) {
      logger.warn({ err, pageId: params.pageId, name }, 'named utility light sync failed');
    }
  }

  const again = await prisma.pageUtilityTemplate.findFirst({
    where: { pageId: params.pageId, templateName: name, status: 'APPROVED' },
    orderBy: { updatedAt: 'desc' },
  });
  if (again) {
    return {
      pageId: params.pageId,
      status: 'APPROVED',
      language: again.language || preferred,
      externalId: again.externalId || `utility_${name}`,
      name,
      path: 'warm',
    };
  }

  const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: params.pageId } });
  const token = await remintPageAccessToken(page);

  let existing:
    | {
        id?: string;
        name: string;
        status: string;
        language?: string;
      }
    | undefined;
  try {
    const listed = await metaProvider.listMessageTemplates({
      pageId: page.platformPageId,
      pageAccessToken: token,
      name,
      deepScan: true,
    });
    existing =
      listed.find((t) => t.name === name && t.status === 'APPROVED') ||
      listed.find((t) => t.name === name) ||
      listed.find((t) => t.name.toLowerCase() === name.toLowerCase());
  } catch (err) {
    logger.warn({ err, pageId: params.pageId, name }, 'named UTILITY list failed — trying create');
  }

  const persist = async (
    status: 'APPROVED' | 'PENDING' | 'REJECTED',
    lang: string,
    externalId: string
  ) => {
    return prisma.pageUtilityTemplate.upsert({
      where: {
        pageId_templateName_language: {
          pageId: page.id,
          templateName: name,
          language: lang,
        },
      },
      create: {
        pageId: page.id,
        templateName: name,
        language: lang,
        externalId,
        status,
        body: tplBody,
        category: 'UTILITY',
      },
      update: {
        externalId,
        status,
        body: tplBody,
      },
    });
  };

  if (existing) {
    let status: 'APPROVED' | 'PENDING' | 'REJECTED' =
      existing.status === 'APPROVED'
        ? 'APPROVED'
        : existing.status === 'REJECTED'
          ? 'REJECTED'
          : 'PENDING';
    let externalId = existing.id || `utility_${name}`;
    const lang = existing.language || preferred;

    if (status === 'PENDING' && waitForApproved) {
      const waited = await metaProvider.waitForUtilityTemplateApproved({
        pageId: page.platformPageId,
        pageAccessToken: token,
        templateName: name,
        retries: waitRetries,
        intervalMs: waitIntervalMs,
      });
      status =
        waited.status === 'APPROVED'
          ? 'APPROVED'
          : waited.status === 'REJECTED'
            ? 'REJECTED'
            : 'PENDING';
      externalId = waited.externalTemplateId || externalId;
    }

    const row = await persist(status, lang, externalId);
    return {
      pageId: page.id,
      status: row.status,
      language: row.language,
      externalId: row.externalId || externalId,
      name,
      path: 'warm',
    };
  }

  let lastErr = 'create failed';
  for (const language of langs) {
    try {
      const created = await metaProvider.createUtilityTemplate({
        pageId: page.platformPageId,
        pageAccessToken: token,
        name,
        category: 'UTILITY',
        language,
        body: tplBody,
        exampleValues: params.exampleValues?.length
          ? params.exampleValues
          : ['Hello from CastMe Pro'],
      });
      let status: 'APPROVED' | 'PENDING' | 'REJECTED' =
        created.status === 'APPROVED'
          ? 'APPROVED'
          : created.status === 'REJECTED'
            ? 'REJECTED'
            : 'PENDING';
      let externalId = created.externalTemplateId;

      if (status === 'PENDING' && waitForApproved) {
        const waited = await metaProvider.waitForUtilityTemplateApproved({
          pageId: page.platformPageId,
          pageAccessToken: token,
          templateName: name,
          retries: waitRetries,
          intervalMs: waitIntervalMs,
        });
        status =
          waited.status === 'APPROVED'
            ? 'APPROVED'
            : waited.status === 'REJECTED'
              ? 'REJECTED'
              : 'PENDING';
        externalId = waited.externalTemplateId || externalId;
      }

      try {
        await syncPageUtilityTemplates(params.pageId, { templateName: name });
      } catch {
        /* best-effort re-sync */
      }

      const row = await persist(status, language, externalId);
      return {
        pageId: page.id,
        status: row.status,
        language: row.language,
        externalId: row.externalId || externalId,
        name,
        path: 'cold',
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      logger.warn({ err, pageId: params.pageId, language, name }, 'named UTILITY create attempt failed');
    }
  }

  return {
    pageId: page.id,
    status: 'error',
    language: preferred,
    externalId: '',
    name,
    path: 'error',
    error: lastErr.slice(0, 400),
  };
}

const createCampaignSchema = z.object({
  pages: z.array(z.object({ id: z.string().min(1), name: z.string().optional() })).min(1),
  message: z.string().max(2000).optional(),
  image_url: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  speed_preset: z.enum(['safe', 'balanced', 'fast', 'turbo', 'custom']).optional(),
  delay_ms: z.number().int().min(100).max(60_000).optional(),
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
            language: 'en',
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

    // Kick Instant plain UTILITY ensure/poll on every campaign Page (background).
    for (const [i, p] of okPages.entries()) {
      void enqueueUtilityEnsure(p.page!.id, {
        waitForApproved: true,
        userId: user.id,
        delayMs: i * 800,
      });
    }

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

    // Instant / plain path — never create multi-slot Instant copy as the Meta template body.
    const wantsPlain =
      !body.template_name ||
      body.template_name === PLAIN_UTILITY_TEMPLATE_NAME ||
      body.body === PLAIN_UTILITY_BODY ||
      body.body === '{{1}}';

    if (wantsPlain) {
      const result = await ensurePlainUtilityOnPage(body.page_id, {
        waitForApproved: true,
        ...HTTP_TEMPLATE_WAIT,
      });
      if (result.status === 'PENDING') {
        void ensurePlainUtilityOnPage(body.page_id, {
          waitForApproved: true,
          ...WORKER_TEMPLATE_WAIT,
        }).catch((err) => logger.warn({ err, pageId: body.page_id }, 'bg plain utility wait failed'));
        void enqueueUtilityEnsure(body.page_id, {
          waitForApproved: true,
          userId: user.id,
          delayMs: 500,
        }).catch(() => undefined);
      }
      if (result.status === 'error') {
        throw new AppError(
          'FACEBOOK_ERROR',
          result.error ||
            'Could not prepare Instant UTILITY on this Page. Reconnect Facebook, tick this Page, grant Utility Messaging, then try again.',
          502,
          { pageId: body.page_id, snippet: result.error }
        );
      }
      return { template: result, instant: true };
    }

    const page = await prisma.facebookPage.findUniqueOrThrow({ where: { id: body.page_id } });
    const name = body.template_name!;
    const tplBody = body.body || PLAIN_UTILITY_BODY;
    const token = await remintPageAccessToken(page);
    const language = body.language || 'en';
    try {
      const listed = await metaProvider.listMessageTemplates({
        pageId: page.platformPageId,
        pageAccessToken: token,
        name,
      });
      const existing =
        listed.find((t) => t.name === name && t.status === 'APPROVED') ||
        listed.find((t) => t.name === name);
      let created = existing
        ? {
            externalTemplateId: existing.id || `utility_${name}`,
            status: (existing.status === 'UNKNOWN' ? 'PENDING' : existing.status) as string,
          }
        : await metaProvider.createUtilityTemplate({
            pageId: page.platformPageId,
            pageAccessToken: token,
            name,
            category: 'UTILITY',
            language,
            body: tplBody,
            exampleValues: body.example_values || ['Hello from CastMe Pro'],
          });

      let status: 'APPROVED' | 'PENDING' | 'REJECTED' =
        created.status === 'APPROVED'
          ? 'APPROVED'
          : created.status === 'REJECTED'
            ? 'REJECTED'
            : 'PENDING';

      if (status === 'PENDING') {
        const waited = await metaProvider.waitForUtilityTemplateApproved({
          pageId: page.platformPageId,
          pageAccessToken: token,
          templateName: name,
          retries: HTTP_TEMPLATE_WAIT.waitRetries,
          intervalMs: HTTP_TEMPLATE_WAIT.waitIntervalMs,
        });
        created = {
          externalTemplateId: waited.externalTemplateId || created.externalTemplateId,
          status: waited.status,
        };
        status =
          waited.status === 'APPROVED'
            ? 'APPROVED'
            : waited.status === 'REJECTED'
              ? 'REJECTED'
              : 'PENDING';
      }

      const lang = existing?.language || language;
      const row = await prisma.pageUtilityTemplate.upsert({
        where: {
          pageId_templateName_language: {
            pageId: page.id,
            templateName: name,
            language: lang,
          },
        },
        create: {
          pageId: page.id,
          templateName: name,
          language: lang,
          externalId: created.externalTemplateId,
          status,
          body: tplBody,
          category: 'UTILITY',
        },
        update: {
          externalId: created.externalTemplateId,
          status,
          body: tplBody,
        },
      });
      return { template: row, instant: false };
    } catch (err) {
      throw mapMetaError(err);
    }
  });

  /** Batch prepare Instant plain UTILITY — waits for Meta APPROVED (~1 min) like Page Instant. */
  app.post('/api/broadcast/prepare-instant', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    await requirePermission(user, 'broadcast.send');
    const body = z.object({ page_ids: z.array(z.string().min(1)).min(1).max(50) }).parse(request.body);

    const results: Array<{
      page_id: string;
      page_name?: string;
      status: string;
      error?: string;
      queued?: boolean;
      path?: string;
    }> = [];

    for (const [i, pageId] of body.page_ids.entries()) {
      try {
        await assertUserOwnsPage(user.id, pageId);
        const page = await prisma.facebookPage.findUnique({ where: { id: pageId } });
        try {
          await syncPageUtilityTemplates(pageId, { templateName: PLAIN_UTILITY_TEMPLATE_NAME });
        } catch (err) {
          logger.warn({ err, pageId }, 'prepare-instant sync skipped');
        }
        const result = await ensurePlainUtilityOnPage(pageId, {
          waitForApproved: true,
          ...HTTP_TEMPLATE_WAIT,
        });
        if (result.status === 'PENDING') {
          void ensurePlainUtilityOnPage(pageId, {
            waitForApproved: true,
            ...WORKER_TEMPLATE_WAIT,
          }).catch((err) => logger.warn({ err, pageId }, 'bg prepare-instant wait failed'));
          void enqueueUtilityEnsure(pageId, {
            waitForApproved: true,
            userId: user.id,
            delayMs: 1000 + i * 500,
          });
        }
        results.push({
          page_id: pageId,
          page_name: page?.name,
          status: result.status,
          error: result.error,
          queued: result.status === 'PENDING',
          path: result.status === 'APPROVED' ? 'warm_or_cold' : undefined,
        });
      } catch (err) {
        results.push({
          page_id: pageId,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const approved = results.filter((r) => r.status === 'APPROVED').length;
    const ok = results.filter((r) => r.status === 'APPROVED' || r.status === 'PENDING').length;
    const failed = results.filter((r) => r.status === 'error' || r.status === 'REJECTED').length;
    return {
      results,
      ok,
      approved,
      failed,
      template_name: PLAIN_UTILITY_TEMPLATE_NAME,
      message:
        approved > 0
          ? `Instant UTILITY approved on ${approved} Page(s).`
          : 'Instant UTILITY submitted — still waiting on Meta approval.',
    };
  });

  /**
   * Page Instant–style library approve:
   * 1) sync Meta templates
   * 2) warm reuse if APPROVED
   * 3) else create + wait + re-sync
   */
  app.post('/api/broadcast/ensure-library', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    await requirePermission(user, 'broadcast.send');
    const body = z
      .object({
        page_ids: z.array(z.string().min(1)).min(1).max(20),
        template_name: z.string().min(1).max(120),
        body: z.string().min(1).max(5000),
        language: z.string().optional(),
        example_values: z.array(z.string()).optional(),
        instant: z.boolean().optional(),
      })
      .parse(request.body);

    const usePlain =
      body.instant ||
      body.template_name === PLAIN_UTILITY_TEMPLATE_NAME ||
      body.body === PLAIN_UTILITY_BODY ||
      body.body === '{{1}}';

    const results = await Promise.all(
      body.page_ids.map(async (pageId) => {
        try {
          await assertUserOwnsPage(user.id, pageId);
          const page = await prisma.facebookPage.findUnique({ where: { id: pageId } });

        if (usePlain) {
          let upserted = 0;
          try {
            upserted = (await syncPageUtilityTemplates(pageId, {
              templateName: PLAIN_UTILITY_TEMPLATE_NAME,
            })).upserted;
          } catch (err) {
            logger.warn({ err, pageId }, 'ensure-library plain sync failed');
          }
          const result = await ensurePlainUtilityOnPage(pageId, {
            waitForApproved: true,
            ...HTTP_TEMPLATE_WAIT,
          });
          if (result.status === 'PENDING') {
            void ensurePlainUtilityOnPage(pageId, {
              waitForApproved: true,
              ...WORKER_TEMPLATE_WAIT,
            }).catch((err) => logger.warn({ err, pageId }, 'bg ensure-library plain wait failed'));
          }
          return {
            page_id: pageId,
            page_name: page?.name,
            status: result.status,
            name: PLAIN_UTILITY_TEMPLATE_NAME,
            path:
              result.status === 'APPROVED' ? 'warm' : result.status === 'error' ? 'error' : 'cold',
            error: result.error,
            upserted,
          };
        }

          const result = await ensureNamedUtilityOnPage({
            pageId,
            templateName: body.template_name,
            body: body.body,
            language: body.language || 'en',
            exampleValues: body.example_values,
            waitForApproved: true,
            skipFullSync: true,
            ...HTTP_TEMPLATE_WAIT,
          });
          if (result.status === 'PENDING') {
            void ensureNamedUtilityOnPage({
              pageId,
              templateName: body.template_name,
              body: body.body,
              language: body.language || 'en',
              exampleValues: body.example_values,
              waitForApproved: true,
              skipFullSync: true,
              ...WORKER_TEMPLATE_WAIT,
            }).catch((err) =>
              logger.warn(
                { err, pageId, name: body.template_name },
                'bg ensure-library named wait failed'
              )
            );
          }
          return {
            page_id: pageId,
            page_name: page?.name,
            status: result.status,
            name: result.name,
            path: result.path,
            error: result.error,
          };
        } catch (err) {
          return {
            page_id: pageId,
            status: 'error',
            name: body.template_name,
            path: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    const approved = results.filter((r) => r.status === 'APPROVED').length;
    const pending = results.filter((r) => r.status === 'PENDING').length;
    const failed = results.filter((r) => r.status === 'error' || r.status === 'REJECTED').length;
    const firstError = results.find((r) => r.error)?.error;
    // Keep Instant ensure polling in background when Meta is still reviewing.
    if (usePlain && pending > 0) {
      for (const [i, pageId] of body.page_ids.entries()) {
        const hit = results.find((r) => r.page_id === pageId);
        if (hit?.status === 'PENDING') {
          void enqueueUtilityEnsure(pageId, {
            waitForApproved: true,
            userId: user.id,
            delayMs: 500 + i * 400,
          }).catch(() => undefined);
        }
      }
    }
    return {
      results,
      approved,
      pending,
      failed,
      template_name: usePlain ? PLAIN_UTILITY_TEMPLATE_NAME : body.template_name,
      message:
        approved > 0
          ? `Approved on ${approved} of ${body.page_ids.length} page${body.page_ids.length === 1 ? '' : 's'}.`
          : pending > 0
            ? 'Meta is still reviewing this template — keep this window open. Reconnect is not required while status is Pending.'
            : firstError ||
              'Could not approve template on selected pages. Check the Meta error below.',
    };
  });

  /** Auto-approve Instant UTILITY on every connected Page (background). */
  app.post('/api/broadcast/auto-utility', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    await requirePermission(user, 'broadcast.send');
    const queued = await enqueueUtilityEnsureForUser(user.id, {
      waitForApproved: true,
      delayMs: 500,
    });
    return {
      success: true,
      ...queued,
      message: `Queued Instant UTILITY auto-approve on ${queued.enqueued} Page(s). Meta approval is polled in the background.`,
    };
  });

  app.get('/api/broadcast/utility-status', async (request) => {
    const user = await requireUser(request);
    const q = request.query as { template_name?: string; refresh?: string };
    const templateName = (q.template_name || PLAIN_UTILITY_TEMPLATE_NAME).trim() || PLAIN_UTILITY_TEMPLATE_NAME;
    const connections = await prisma.pageConnection.findMany({
      where: { userId: user.id, status: { not: 'DISCONNECTED' } },
      include: {
        page: {
          include: {
            utilityTemplates: {
              where: { templateName },
              orderBy: { updatedAt: 'desc' },
              take: 3,
            },
          },
        },
      },
    });

    // During library poll, refresh Meta status so PENDING → APPROVED without another long ensure call.
    if (q.refresh === '1' || q.refresh === 'true') {
      await Promise.all(
        connections.slice(0, 20).map(async (c) => {
          const approved = c.page.utilityTemplates.some((t) => t.status === 'APPROVED');
          if (approved) return;
          try {
            await syncPageUtilityTemplates(c.pageId, { templateName });
          } catch (err) {
            logger.warn({ err, pageId: c.pageId }, 'utility-status refresh sync failed');
          }
        })
      );
      const refreshed = await prisma.pageConnection.findMany({
        where: { userId: user.id, status: { not: 'DISCONNECTED' } },
        include: {
          page: {
            include: {
              utilityTemplates: {
                where: { templateName },
                orderBy: { updatedAt: 'desc' },
                take: 3,
              },
            },
          },
        },
      });
      return {
        template_name: templateName,
        pages: refreshed.map((c) => {
          const approvedRow = c.page.utilityTemplates.find((t) => t.status === 'APPROVED');
          const latest = approvedRow || c.page.utilityTemplates[0];
          return {
            page_id: c.pageId,
            name: c.page.name,
            status: latest?.status || 'missing',
            language: latest?.language || null,
            ready: Boolean(approvedRow),
          };
        }),
      };
    }

    return {
      template_name: templateName,
      pages: connections.map((c) => {
        const approved = c.page.utilityTemplates.find((t) => t.status === 'APPROVED');
        const latest = approved || c.page.utilityTemplates[0];
        return {
          page_id: c.pageId,
          name: c.page.name,
          status: latest?.status || 'missing',
          language: latest?.language || null,
          ready: Boolean(approved),
        };
      }),
    };
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
      const exampleValues = [...starter.examples];
      const created = await metaProvider.createUtilityTemplate({
        pageId: page.platformPageId,
        pageAccessToken: token,
        name: starter.name,
        category: 'UTILITY',
        language: 'en_US',
        body: starter.body,
        exampleValues,
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
    const pageIds = connections.map((c) => c.pageId);
    const activeCounts = pageIds.length
      ? await prisma.contact.groupBy({
          by: ['pageId'],
          where: { pageId: { in: pageIds }, status: 'ACTIVE' },
          _count: { _all: true },
        })
      : [];
    const byPage = new Map(activeCounts.map((r) => [r.pageId, r._count._all]));
    return {
      pages: connections.map((c) => ({
        page_id: c.pageId,
        name: c.page.name,
        // Reachable Messenger leads only — never include BLOCKED / INACTIVE.
        contact_count: byPage.get(c.pageId) ?? 0,
        contact_count_all: c.contactCount,
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

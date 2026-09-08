import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createBroadcastSchema, validateTemplateValues, renderTemplatePreview } from '@pagebroadcast/validation';
import type { BroadcastStatus } from '@pagebroadcast/types';
import { requireUser } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { assertUserOwnsBroadcast, assertUserOwnsPage } from '../../lib/ownership.js';
import { assertBroadcastTransition } from '../../lib/broadcast-state.js';
import { estimateRecipients, listEligibleContactIds, type RecipientSelection } from '../../lib/recipients.js';
import { enqueue, QUEUE_NAMES } from '../../lib/queues.js';
import { writeAuditLog } from '../../lib/audit.js';
import { notifyUser } from '../../lib/notify.js';
import { ensureTemplateApprovedForPage } from '../../lib/template-activation.js';

export async function broadcastRoutes(app: FastifyInstance) {
  app.get('/api/broadcasts', async (request) => {
    const user = await requireUser(request);
    const q = request.query as { page?: string; pageSize?: string; status?: string; pageId?: string };
    const page = Number(q.page || 1);
    const pageSize = Math.min(Number(q.pageSize || 25), 100);
    const where: Record<string, unknown> = { userId: user.id };
    if (q.status) where.status = q.status;
    if (q.pageId) where.pageId = q.pageId;

    const [total, data] = await Promise.all([
      prisma.broadcast.count({ where }),
      prisma.broadcast.findMany({
        where,
        include: {
          template: { select: { id: true, title: true, metaName: true, isCustom: true } },
          page: { select: { id: true, name: true, profileImage: true } },
        },
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

  app.post('/api/broadcasts', async (request) => {
    const user = await requireUser(request);
    const body = createBroadcastSchema.parse(request.body);
    await assertUserOwnsPage(user.id, body.pageId);

    const template = await prisma.template.findUnique({ where: { id: body.templateId } });
    if (!template) throw new AppError('NOT_FOUND', 'Template not found.', 404);
    if (template.bodyStatus === 'requires_import' || template.body === null) {
      throw new AppError('TEMPLATE_BODY_MISSING', 'Template body requires import.', 400);
    }

    const bodyText = template.isCustom ? (template.body || '') : template.body;
    if (!template.isCustom) {
      const validation = validateTemplateValues(bodyText, body.variableValues);
      if (!validation.ok) throw new AppError('VALIDATION', validation.errors.join('; '), 400);
    } else if (!bodyText.trim() && !Object.keys(body.variableValues).length) {
      // custom may store freeform in variableValues.custom or body
    }

    const selection: RecipientSelection = {
      mode: body.recipientMode,
      contactIds: body.contactIds,
      tagIds: body.tagIds,
      filters: body.filters,
    };
    const estimated = await estimateRecipients(body.pageId, selection);
    const rendered = template.isCustom
      ? bodyText || String((body.variableValues as Record<string, string>).text ?? '')
      : renderTemplatePreview(bodyText, body.variableValues);

    // Messenger model: ready library templates activate instantly for the Page.
    if (!template.isCustom) {
      await ensureTemplateApprovedForPage(template.id, body.pageId);
    }

    const approval = await prisma.templateApproval.findUnique({
      where: {
        templateId_pageId: { templateId: template.id, pageId: body.pageId },
      },
    });

    let status: BroadcastStatus = 'DRAFT';
    if (!template.isCustom && approval?.status === 'APPROVED') status = 'APPROVED';
    if (template.isCustom) status = 'DRAFT';

    const broadcast = await prisma.broadcast.create({
      data: {
        userId: user.id,
        pageId: body.pageId,
        templateId: template.id,
        name: body.name,
        status,
        variableValues: body.variableValues,
        recipientMode: body.recipientMode,
        recipientFilter: selection as object,
        totalRecipients: estimated,
        renderedBody: rendered,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      },
      include: { template: true, page: true },
    });

    await writeAuditLog({
      actorId: user.id,
      action: 'broadcast.created',
      resource: 'broadcast',
      resourceId: broadcast.id,
      ip: request.ip,
    });

    return { broadcast, estimatedRecipients: estimated };
  });

  app.get('/api/broadcasts/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const broadcast = await assertUserOwnsBroadcast(user.id, id);
    const full = await prisma.broadcast.findUniqueOrThrow({
      where: { id: broadcast.id },
      include: {
        template: { include: { approvals: true, variables: true } },
        page: { select: { id: true, name: true, profileImage: true } },
      },
    });
    return { broadcast: full };
  });

  app.get('/api/broadcasts/:id/progress', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const b = await assertUserOwnsBroadcast(user.id, id);
    const total = b.totalRecipients || 1;
    const done = b.sentCount + b.failedCount;
    return {
      status: b.status,
      total: b.totalRecipients,
      queued: b.queuedCount,
      sending: b.sendingCount,
      sent: b.sentCount,
      delivered: b.deliveredCount,
      failed: b.failedCount,
      read: b.readCount,
      responses: b.responseCount,
      percent: Math.min(100, Math.round((done / total) * 100)),
    };
  });

  app.get('/api/broadcasts/:id/recipients', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    await assertUserOwnsBroadcast(user.id, id);
    const q = request.query as { page?: string; pageSize?: string };
    const page = Number(q.page || 1);
    const pageSize = Math.min(Number(q.pageSize || 50), 100);
    const [total, data] = await Promise.all([
      prisma.broadcastRecipient.count({ where: { broadcastId: id } }),
      prisma.broadcastRecipient.findMany({
        where: { broadcastId: id },
        include: {
          contact: { select: { id: true, name: true, profileImage: true, platformUserId: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  });

  app.get('/api/broadcasts/:id/export', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    await assertUserOwnsBroadcast(user.id, id);
    const rows = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: id },
      include: { contact: true },
      orderBy: { createdAt: 'asc' },
    });
    const header = 'customer,platform_user_id,status,sent_at,delivered_at,failure_reason\n';
    const csv =
      header +
      rows
        .map((r) =>
          [
            JSON.stringify(r.contact.name ?? ''),
            r.contact.platformUserId,
            r.status,
            r.sentAt?.toISOString() ?? '',
            r.deliveredAt?.toISOString() ?? '',
            JSON.stringify(r.failureReason ?? ''),
          ].join(',')
        )
        .join('\n');
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="broadcast-${id}.csv"`);
    return csv;
  });

  app.post('/api/broadcasts/:id/submit-approval', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const broadcast = await assertUserOwnsBroadcast(user.id, id);

    const template = await prisma.template.findUniqueOrThrow({ where: { id: broadcast.templateId } });
    if (template.isCustom) {
      throw new AppError(
        'VALIDATION',
        'Custom messages are not submitted as Meta templates. Validate eligibility, then start when ready.',
        400
      );
    }

    if (!['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(broadcast.status)) {
      throw new AppError(
        'INVALID_TRANSITION',
        `Cannot approve from status ${broadcast.status}.`,
        409
      );
    }

    await ensureTemplateApprovedForPage(template.id, broadcast.pageId);

    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'APPROVED' },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'broadcast.template_activated',
      resource: 'broadcast',
      resourceId: id,
      ip: request.ip,
    });
    return {
      broadcast: updated,
      message:
        'Template activated for Messenger on this Page. You can start the broadcast now.',
    };
  });

  app.post('/api/broadcasts/:id/start', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const broadcast = await assertUserOwnsBroadcast(user.id, id);

    if (broadcast.status === 'PENDING_APPROVAL') {
      throw new AppError(
        'TEMPLATE_NOT_APPROVED',
        'Cannot start while waiting for Meta template approval.',
        409
      );
    }
    if (broadcast.status !== 'APPROVED' && broadcast.status !== 'SCHEDULED') {
      // Allow DRAFT only for custom templates with explicit eligibility note
      const template = await prisma.template.findUniqueOrThrow({ where: { id: broadcast.templateId } });
      if (!(template.isCustom && broadcast.status === 'DRAFT')) {
        throw new AppError(
          'TEMPLATE_NOT_APPROVED',
          'Broadcast must be approved before starting.',
          409
        );
      }
      assertBroadcastTransition('DRAFT', 'QUEUED');
    } else {
      assertBroadcastTransition(broadcast.status as BroadcastStatus, 'QUEUED');
    }

    const selection = (broadcast.recipientFilter || {
      mode: broadcast.recipientMode,
    }) as RecipientSelection;
    if (!selection.mode) selection.mode = broadcast.recipientMode as RecipientSelection['mode'];

    const contactIds = await listEligibleContactIds(broadcast.pageId, selection);

    await prisma.$transaction(async (tx) => {
      await tx.broadcastRecipient.deleteMany({ where: { broadcastId: id } });
      if (contactIds.length) {
        await tx.broadcastRecipient.createMany({
          data: contactIds.map((contactId) => ({
            broadcastId: id,
            contactId,
            status: 'PENDING',
            idempotencyKey: createHash('sha256')
              .update(`${id}:${contactId}`)
              .digest('hex'),
            queuedAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }
      await tx.broadcast.update({
        where: { id },
        data: {
          status: 'QUEUED',
          totalRecipients: contactIds.length,
          queuedCount: contactIds.length,
          sendingCount: 0,
          sentCount: 0,
          deliveredCount: 0,
          failedCount: 0,
          startedAt: null,
          completedAt: null,
        },
      });
    });

    await enqueue(QUEUE_NAMES.BROADCAST, { broadcastId: id });
    await notifyUser({
      userId: user.id,
      type: 'BROADCAST_STARTED',
      title: 'Broadcast queued',
      body: `${broadcast.name} is queued for sending.`,
      metadata: { broadcastId: id },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'broadcast.started',
      resource: 'broadcast',
      resourceId: id,
      ip: request.ip,
      metadata: { recipients: contactIds.length },
    });

    return { ok: true, recipients: contactIds.length };
  });

  app.post('/api/broadcasts/:id/pause', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const broadcast = await assertUserOwnsBroadcast(user.id, id);
    assertBroadcastTransition(broadcast.status as BroadcastStatus, 'PAUSING');
    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'broadcast.paused',
      resource: 'broadcast',
      resourceId: id,
      ip: request.ip,
    });
    return { broadcast: updated };
  });

  app.post('/api/broadcasts/:id/cancel', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const broadcast = await assertUserOwnsBroadcast(user.id, id);
    assertBroadcastTransition(broadcast.status as BroadcastStatus, 'CANCELLED');
    const updated = await prisma.broadcast.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'broadcast.cancelled',
      resource: 'broadcast',
      resourceId: id,
      ip: request.ip,
    });
    return { broadcast: updated };
  });
}

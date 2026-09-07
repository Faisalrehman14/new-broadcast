import type { FastifyInstance } from 'fastify';
import { contactsQuerySchema } from '@pagebroadcast/validation';
import { requireUser } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { assertUserOwnsContact, assertUserOwnsPage } from '../../lib/ownership.js';
import { AppError } from '../../lib/errors.js';
import { enqueue, QUEUE_NAMES } from '../../lib/queues.js';
import { writeAuditLog } from '../../lib/audit.js';

export async function contactRoutes(app: FastifyInstance) {
  app.get('/api/contacts', async (request) => {
    const user = await requireUser(request);
    const query = contactsQuerySchema.parse(request.query);
    const pageIds = (
      await prisma.pageConnection.findMany({
        where: { userId: user.id, status: { not: 'DISCONNECTED' } },
        select: { pageId: true },
      })
    ).map((p) => p.pageId);

    const where: Record<string, unknown> = {
      pageId: query.pageId && pageIds.includes(query.pageId) ? query.pageId : { in: pageIds },
    };
    if (query.status) where.status = query.status;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { platformUserId: { contains: query.q } },
      ];
    }
    if (query.tagId) where.tags = { some: { tagId: query.tagId } };
    if (query.neverContacted) where.broadcastsReceived = 0;
    if (query.previouslyContacted) where.broadcastsReceived = { gt: 0 };
    if (query.from || query.to) {
      where.lastInteractionAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, data] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        include: {
          page: { select: { id: true, name: true, profileImage: true } },
          tags: { include: { tag: true } },
        },
        orderBy: { lastInteractionAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: data.map((c) => ({
        id: c.id,
        name: c.name,
        profileImage: c.profileImage,
        page: c.page,
        platformUserId: c.platformUserId,
        firstSeenAt: c.firstSeenAt,
        lastInteractionAt: c.lastInteractionAt,
        status: c.status,
        broadcastsReceived: c.broadcastsReceived,
        lastBroadcastAt: c.lastBroadcastAt,
        tags: c.tags.map((t) => t.tag),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize) || 1,
      },
    };
  });

  app.get('/api/contacts/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    await assertUserOwnsContact(user.id, id);
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id },
      include: {
        page: { select: { id: true, name: true, profileImage: true } },
        tags: { include: { tag: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 50 },
        recipients: {
          include: { broadcast: { select: { id: true, name: true, status: true, createdAt: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    return { contact };
  });

  app.post('/api/contacts/sync', async (request) => {
    const user = await requireUser(request);
    const body = request.body as { pageId?: string };
    if (!body.pageId) throw new AppError('VALIDATION', 'pageId is required.', 400);
    await assertUserOwnsPage(user.id, body.pageId);

    const syncJob = await prisma.syncJob.create({
      data: { pageId: body.pageId, status: 'PENDING' },
    });
    await prisma.pageConnection.updateMany({
      where: { userId: user.id, pageId: body.pageId },
      data: { status: 'SYNCING' },
    });
    await enqueue(QUEUE_NAMES.FACEBOOK_SYNC, {
      syncJobId: syncJob.id,
      pageId: body.pageId,
      userId: user.id,
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'contacts.sync_started',
      resource: 'sync_job',
      resourceId: syncJob.id,
      ip: request.ip,
    });
    return { syncJobId: syncJob.id };
  });

  app.get('/api/contacts/sync/:jobId', async (request) => {
    const user = await requireUser(request);
    const { jobId } = request.params as { jobId: string };
    const job = await prisma.syncJob.findUnique({
      where: { id: jobId },
      include: { page: { include: { connections: { where: { userId: user.id } } } } },
    });
    if (!job || !job.page.connections.length) {
      throw new AppError('NOT_FOUND', 'Sync job not found.', 404);
    }
    return {
      id: job.id,
      status: job.status,
      processedCount: job.processedCount,
      totalEstimated: job.totalEstimated,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  });
}

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { supportTicketSchema } from '@pagebroadcast/validation';
import { writeAuditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (request) => {
    const user = await requireUser(request);
    const connections = await prisma.pageConnection.findMany({
      where: { userId: user.id, status: { not: 'DISCONNECTED' } },
      include: { page: true },
    });
    const pageIds = connections.map((c) => c.pageId);

    const [totalContacts, activeContacts, broadcasts] = await Promise.all([
      prisma.contact.count({ where: { pageId: { in: pageIds } } }),
      prisma.contact.count({ where: { pageId: { in: pageIds }, status: 'ACTIVE' } }),
      prisma.broadcast.findMany({ where: { userId: user.id } }),
    ]);

    const broadcastsSent = broadcasts.filter((b) =>
      ['COMPLETED', 'PARTIALLY_COMPLETED', 'RUNNING', 'QUEUED'].includes(b.status)
    ).length;
    const delivered = broadcasts.reduce((s, b) => s + b.deliveredCount, 0);
    const failed = broadcasts.reduce((s, b) => s + b.failedCount, 0);
    const sent = broadcasts.reduce((s, b) => s + b.sentCount, 0);
    const responses = broadcasts.reduce((s, b) => s + b.responseCount, 0);

    const lastSyncedAt = connections
      .map((c) => c.lastSyncedAt)
      .filter(Boolean)
      .sort((a, b) => (b!.getTime() - a!.getTime()))[0] ?? null;

    const recentBroadcasts = await prisma.broadcast.findMany({
      where: { userId: user.id },
      include: {
        template: { select: { title: true } },
        page: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    const activity = await prisma.auditLog.findMany({
      where: { actorId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    return {
      kpis: {
        totalContacts,
        activeContacts,
        broadcastsSent,
        delivered,
        failed,
        responseRate: delivered ? responses / delivered : 0,
        sent,
      },
      lastSyncedAt,
      pages: connections.map((c) => ({
        pageId: c.pageId,
        name: c.page.name,
        profileImage: c.page.profileImage,
        status: c.status,
        contactCount: c.contactCount,
      })),
      recentBroadcasts,
      activity,
    };
  });
}

export async function supportRoutes(app: FastifyInstance) {
  app.get('/api/support/tickets', async (request) => {
    const user = await requireUser(request);
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { tickets };
  });

  app.post('/api/support/tickets', async (request) => {
    const user = await requireUser(request);
    const body = supportTicketSchema.parse(request.body);
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject: body.subject,
        category: body.category,
        description: body.description,
        priority: body.priority,
      },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'support.ticket_created',
      resource: 'support_ticket',
      resourceId: ticket.id,
      ip: request.ip,
    });
    return { ticket };
  });
}

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications', async (request) => {
    const user = await requireUser(request);
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unread = await prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { notifications, unread };
  });

  app.post('/api/notifications/read-all', async (request) => {
    const user = await requireUser(request);
    await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  app.post('/api/notifications/:id/read', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    await prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (request) => {
    const user = await requireUser(request);
    let settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    if (!settings) {
      settings = await prisma.userSettings.create({ data: { userId: user.id } });
    }
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const loginHistory = await prisma.loginHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { settings, sessions, loginHistory };
  });

  app.put('/api/settings', async (request) => {
    const user = await requireUser(request);
    const body = request.body as Record<string, unknown>;
    const settings = await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...(body as object) },
      update: body as object,
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'settings.updated',
      resource: 'user_settings',
      resourceId: settings.id,
      ip: request.ip,
    });
    return { settings };
  });

  app.post('/api/settings/logout-all', async (request) => {
    const user = await requireUser(request);
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });
}

export async function searchRoutes(app: FastifyInstance) {
  app.get('/api/search', async (request) => {
    const user = await requireUser(request);
    const q = String((request.query as { q?: string }).q || '').trim();
    if (!q) return { contacts: [], broadcasts: [], templates: [] };
    const pageIds = (
      await prisma.pageConnection.findMany({ where: { userId: user.id }, select: { pageId: true } })
    ).map((p) => p.pageId);

    const [contacts, broadcasts, templates] = await Promise.all([
      prisma.contact.findMany({
        where: {
          pageId: { in: pageIds },
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { platformUserId: { contains: q } },
          ],
        },
        take: 10,
      }),
      prisma.broadcast.findMany({
        where: { userId: user.id, name: { contains: q, mode: 'insensitive' } },
        take: 10,
      }),
      prisma.template.findMany({
        where: {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { metaName: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 10,
      }),
    ]);
    return { contacts, broadcasts, templates };
  });
}

export async function activityRoutes(app: FastifyInstance) {
  app.get('/api/activity', async (request) => {
    const user = await requireUser(request);
    const activity = await prisma.auditLog.findMany({
      where: { actorId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { activity };
  });

  app.get('/api/audit-logs', async (request) => {
    const user = await requireUser(request);
    const logs = await prisma.auditLog.findMany({
      where: { actorId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { logs };
  });
}

export async function adminRoutes(app: FastifyInstance) {
  const { requireAdmin } = await import('../../lib/auth.js');

  app.get('/api/admin/overview', async (request) => {
    await requireAdmin(request);
    const [users, pages, broadcasts, webhooks, failed] = await Promise.all([
      prisma.user.count(),
      prisma.pageConnection.count(),
      prisma.broadcast.count(),
      prisma.webhookEvent.count(),
      prisma.broadcastRecipient.count({ where: { status: 'FAILED' } }),
    ]);
    return { users, pages, broadcasts, webhooks, failedMessages: failed };
  });

  app.get('/api/admin/users', async (request) => {
    await requireAdmin(request);
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { users };
  });

  app.get('/api/admin/pages', async (request) => {
    await requireAdmin(request);
    const pages = await prisma.facebookPage.findMany({
      select: {
        id: true,
        name: true,
        platformPageId: true,
        status: true,
        createdAt: true,
        connections: { select: { userId: true, status: true, contactCount: true } },
      },
      take: 100,
    });
    return { pages };
  });

  app.get('/api/admin/sync-jobs', async (request) => {
    await requireAdmin(request);
    return {
      jobs: await prisma.syncJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    };
  });

  app.get('/api/admin/broadcasts', async (request) => {
    await requireAdmin(request);
    return {
      broadcasts: await prisma.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          name: true,
          status: true,
          userId: true,
          totalRecipients: true,
          sentCount: true,
          failedCount: true,
          createdAt: true,
        },
      }),
    };
  });

  app.get('/api/admin/webhooks', async (request) => {
    await requireAdmin(request);
    return {
      events: await prisma.webhookEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          eventType: true,
          externalEventId: true,
          processed: true,
          processingError: true,
          createdAt: true,
          pageId: true,
          // payload available but truncated in list
        },
      }),
    };
  });

  app.get('/api/admin/failed-messages', async (request) => {
    await requireAdmin(request);
    return {
      recipients: await prisma.broadcastRecipient.findMany({
        where: { status: 'FAILED' },
        orderBy: { failedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          broadcastId: true,
          contactId: true,
          failureReason: true,
          attemptCount: true,
          failedAt: true,
        },
      }),
    };
  });

  app.get('/api/admin/api-errors', async (request) => {
    await requireAdmin(request);
    return {
      logs: await prisma.apiLog.findMany({
        where: { statusCode: { gte: 500 } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    };
  });
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', service: 'castmepro-api' }));

  app.get('/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const { getRedis } = await import('../../lib/queues.js');
      const pong = await getRedis().ping();
      if (pong !== 'PONG') throw new Error('redis');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
}

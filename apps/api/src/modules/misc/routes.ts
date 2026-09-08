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
  const { requireCsrf } = await import('../../lib/csrf.js');
  const {
    activatePlanForUser,
    grantMessages,
    listActivePlans,
    reclaimPendingAlbyOrders,
    resetQuotaToPlan,
    syncCanonicalPlans,
    tryActivateOrder,
  } = await import('../../lib/billing.js');
  const { isAlbyConfigured } = await import('../../lib/alby.js');
  const { emailDeliveryConfigured } = await import('../../lib/email-otp.js');
  const { writeAuditLog } = await import('../../lib/audit.js');
  const { z } = await import('zod');

  app.get('/api/admin/overview', async (request) => {
    await requireAdmin(request);
    const [users, pages, broadcasts, campaigns, webhooks, failed, settledOrders] =
      await Promise.all([
        prisma.user.count(),
        prisma.pageConnection.count(),
        prisma.broadcast.count(),
        prisma.broadcastCampaign.count(),
        prisma.webhookEvent.count(),
        prisma.broadcastCampaignRecipient.count({ where: { status: 'FAILED' } }),
        prisma.paymentOrder.findMany({
          where: { status: 'activated' },
          select: { amountCents: true },
        }),
      ]);
    const revenueCents = settledOrders.reduce((s, o) => s + o.amountCents, 0);
    return {
      users,
      pages,
      broadcasts,
      campaigns,
      webhooks,
      failedMessages: failed,
      activatedOrders: settledOrders.length,
      revenueCents,
      revenueUsd: (revenueCents / 100).toFixed(2),
      albyConfigured: isAlbyConfigured(),
      email: emailDeliveryConfigured(),
    };
  });

  app.get('/api/admin/users', async (request) => {
    await requireAdmin(request);
    const q = (request.query as { q?: string }).q?.trim();
    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        planKey: true,
        planExpiresAt: true,
        emailVerifiedAt: true,
        createdAt: true,
        quota: {
          select: { creditsRemaining: true, creditsMonthly: true, resetAt: true },
        },
        settings: { select: { broadcastSend: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { users };
  });

  app.post('/api/admin/users/:id/plan', async (request) => {
    const admin = await requireAdmin(request);
    requireCsrf(request);
    const { id } = request.params as { id: string };
    const body = z
      .object({
        planKey: z.string().min(1),
        extend: z.boolean().optional(),
      })
      .parse(request.body);
    if (body.planKey === 'free') {
      const { ensureTrialQuota } = await import('../../lib/billing.js');
      await ensureTrialQuota(id);
    } else {
      await activatePlanForUser({
        userId: id,
        planKey: body.planKey,
        extendSamePlan: body.extend,
      });
    }
    await writeAuditLog({
      actorId: admin.id,
      action: 'admin.user.plan',
      resource: 'user',
      resourceId: id,
      ip: request.ip,
      metadata: body,
    });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/grant-messages', async (request) => {
    const admin = await requireAdmin(request);
    requireCsrf(request);
    const { id } = request.params as { id: string };
    const body = z.object({ amount: z.number().int().min(1).max(10_000_000) }).parse(request.body);
    await grantMessages(id, body.amount);
    await writeAuditLog({
      actorId: admin.id,
      action: 'admin.user.grant_messages',
      resource: 'user',
      resourceId: id,
      ip: request.ip,
      metadata: body,
    });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/reset-quota', async (request) => {
    const admin = await requireAdmin(request);
    requireCsrf(request);
    const { id } = request.params as { id: string };
    await resetQuotaToPlan(id);
    await writeAuditLog({
      actorId: admin.id,
      action: 'admin.user.reset_quota',
      resource: 'user',
      resourceId: id,
      ip: request.ip,
    });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/broadcast-send', async (request) => {
    const admin = await requireAdmin(request);
    requireCsrf(request);
    const { id } = request.params as { id: string };
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    await prisma.userSettings.upsert({
      where: { userId: id },
      create: { userId: id, broadcastSend: body.enabled },
      update: { broadcastSend: body.enabled },
    });
    await writeAuditLog({
      actorId: admin.id,
      action: 'admin.user.broadcast_send',
      resource: 'user',
      resourceId: id,
      ip: request.ip,
      metadata: body,
    });
    return { ok: true };
  });

  app.get('/api/admin/plans', async (request) => {
    await requireAdmin(request);
    await syncCanonicalPlans();
    return { plans: await listActivePlans() };
  });

  app.patch('/api/admin/plans/:key', async (request) => {
    const admin = await requireAdmin(request);
    requireCsrf(request);
    const { key } = request.params as { key: string };
    const body = z
      .object({
        name: z.string().min(1).optional(),
        amountCents: z.number().int().min(0).optional(),
        messageLimit: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
      })
      .parse(request.body);
    const plan = await prisma.subscriptionPlan.update({
      where: { key },
      data: body,
    });
    await writeAuditLog({
      actorId: admin.id,
      action: 'admin.plan.update',
      resource: 'subscription_plan',
      resourceId: plan.id,
      ip: request.ip,
      metadata: body,
    });
    return { plan };
  });

  app.get('/api/admin/payment-orders', async (request) => {
    await requireAdmin(request);
    const orders = await prisma.paymentOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { email: true, name: true } } },
    });
    return { orders };
  });

  app.post('/api/admin/payment-orders/:id/activate', async (request) => {
    const admin = await requireAdmin(request);
    requireCsrf(request);
    const { id } = request.params as { id: string };
    const result = await tryActivateOrder(id, { force: true });
    await writeAuditLog({
      actorId: admin.id,
      action: 'admin.payment.activate',
      resource: 'payment_order',
      resourceId: id,
      ip: request.ip,
    });
    return result;
  });

  app.post('/api/admin/billing/reclaim', async (request) => {
    await requireAdmin(request);
    requireCsrf(request);
    return reclaimPendingAlbyOrders(50);
  });

  app.get('/api/admin/system', async (request) => {
    await requireAdmin(request);
    return {
      albyConfigured: isAlbyConfigured(),
      email: emailDeliveryConfigured(),
      nodeEnv: process.env.NODE_ENV || 'development',
      recentAudit: await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: {
          id: true,
          action: true,
          resource: true,
          resourceId: true,
          actorId: true,
          createdAt: true,
          metadata: true,
        },
      }),
    };
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
      campaigns: await prisma.broadcastCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          phase: true,
          userId: true,
          estimatedRecipients: true,
          sentCount: true,
          failedCount: true,
          skippedCount: true,
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
      campaignFailures: await prisma.broadcastCampaignFailure.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
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

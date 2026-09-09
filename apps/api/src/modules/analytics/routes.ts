import type { FastifyInstance } from 'fastify';
import { analyticsQuerySchema } from '@pagebroadcast/validation';
import { requireUser } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';

function rangeToDates(range: string, from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  let start: Date;
  if (range === 'custom' && from) start = new Date(from);
  else if (range === '7d') start = new Date(Date.now() - 7 * 864e5);
  else if (range === '90d') start = new Date(Date.now() - 90 * 864e5);
  else start = new Date(Date.now() - 30 * 864e5);
  return { start, end };
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics/overview', async (request) => {
    const user = await requireUser(request);
    const query = analyticsQuerySchema.parse(request.query);
    const { start, end } = rangeToDates(query.range, query.from, query.to);

    const campaigns = await prisma.broadcastCampaign.findMany({
      where: {
        userId: user.id,
        dismissedAt: null,
        createdAt: { gte: start, lte: end },
        ...(query.pageId
          ? { pages: { some: { pageId: query.pageId } } }
          : {}),
      },
      include: {
        pages: { select: { pageName: true, pageId: true, sentCount: true, failedCount: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const totalBroadcasts = campaigns.length;
    const totalRecipients = campaigns.reduce((s, c) => s + c.estimatedRecipients, 0);
    const sent = campaigns.reduce((s, c) => s + c.sentCount, 0);
    const failed = campaigns.reduce((s, c) => s + c.failedCount, 0);
    const skipped = campaigns.reduce((s, c) => s + c.skippedCount, 0);
    const processed = sent + failed + skipped;

    const pageIds = (
      await prisma.pageConnection.findMany({
        where: { userId: user.id },
        select: { pageId: true },
      })
    ).map((p) => p.pageId);

    const contactScope =
      query.pageId && pageIds.includes(query.pageId) ? query.pageId : { in: pageIds };

    const [activeContacts, blockedContacts, newContacts, contactGrowthRaw] = await Promise.all([
      prisma.contact.count({ where: { pageId: contactScope, status: 'ACTIVE' } }),
      prisma.contact.count({ where: { pageId: contactScope, status: 'BLOCKED' } }),
      prisma.contact.count({
        where: { pageId: contactScope, firstSeenAt: { gte: start, lte: end } },
      }),
      prisma.contact.findMany({
        where: { pageId: contactScope, firstSeenAt: { gte: start, lte: end } },
        select: { firstSeenAt: true },
        orderBy: { firstSeenAt: 'asc' },
        take: 5000,
      }),
    ]);

    const growthByDay = new Map<string, number>();
    for (const c of contactGrowthRaw) {
      const key = c.firstSeenAt.toISOString().slice(0, 10);
      growthByDay.set(key, (growthByDay.get(key) || 0) + 1);
    }

    return {
      kpis: {
        totalBroadcasts,
        totalRecipients,
        messagesSent: sent,
        deliveryRate: processed ? sent / processed : 0,
        failureRate: processed ? failed / processed : 0,
        skipRate: processed ? skipped / processed : 0,
        responseRate: 0,
        averageResponseTime: null as number | null,
        activeContacts,
        blockedContacts,
        newContacts,
      },
      series: {
        broadcastVolume: campaigns.map((c) => ({
          date: c.createdAt,
          name: c.message?.slice(0, 40) || c.id.slice(0, 8),
          sent: c.sentCount,
          delivered: c.sentCount,
          failed: c.failedCount,
          skipped: c.skippedCount,
        })),
        contactGrowth: Array.from(growthByDay.entries()).map(([date, count]) => ({
          date,
          count,
        })),
      },
    };
  });

  app.get('/api/analytics/broadcasts', async (request) => {
    const user = await requireUser(request);
    const query = analyticsQuerySchema.parse(request.query);
    const { start, end } = rangeToDates(query.range, query.from, query.to);
    const data = await prisma.broadcastCampaign.findMany({
      where: {
        userId: user.id,
        dismissedAt: null,
        createdAt: { gte: start, lte: end },
        ...(query.pageId ? { pages: { some: { pageId: query.pageId } } } : {}),
      },
      include: {
        pages: { select: { pageName: true, sentCount: true, failedCount: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      data: data.map((c) => ({
        id: c.id,
        phase: c.phase,
        message: c.message,
        estimatedRecipients: c.estimatedRecipients,
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        skippedCount: c.skippedCount,
        createdAt: c.createdAt,
        pages: c.pages,
      })),
    };
  });

  app.get('/api/analytics/contacts', async (request) => {
    const user = await requireUser(request);
    const query = analyticsQuerySchema.parse(request.query);
    const { start, end } = rangeToDates(query.range, query.from, query.to);
    const pageIds = (
      await prisma.pageConnection.findMany({ where: { userId: user.id }, select: { pageId: true } })
    ).map((p) => p.pageId);
    const scope =
      query.pageId && pageIds.includes(query.pageId) ? query.pageId : { in: pageIds };
    const total = await prisma.contact.count({ where: { pageId: scope } });
    const newContacts = await prisma.contact.count({
      where: { pageId: scope, firstSeenAt: { gte: start, lte: end } },
    });
    const active = await prisma.contact.count({
      where: { pageId: scope, status: 'ACTIVE' },
    });
    const blocked = await prisma.contact.count({
      where: { pageId: scope, status: 'BLOCKED' },
    });
    return { total, newContacts, active, blocked };
  });
}

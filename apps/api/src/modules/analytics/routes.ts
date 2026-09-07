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
    const pageFilter = query.pageId ? { pageId: query.pageId } : {};

    const broadcasts = await prisma.broadcast.findMany({
      where: {
        userId: user.id,
        ...pageFilter,
        createdAt: { gte: start, lte: end },
      },
    });

    const totalBroadcasts = broadcasts.length;
    const totalRecipients = broadcasts.reduce((s, b) => s + b.totalRecipients, 0);
    const sent = broadcasts.reduce((s, b) => s + b.sentCount, 0);
    const delivered = broadcasts.reduce((s, b) => s + b.deliveredCount, 0);
    const failed = broadcasts.reduce((s, b) => s + b.failedCount, 0);
    const responses = broadcasts.reduce((s, b) => s + b.responseCount, 0);

    const pageIds = (
      await prisma.pageConnection.findMany({
        where: { userId: user.id },
        select: { pageId: true },
      })
    ).map((p) => p.pageId);

    const contactGrowth = await prisma.contact.groupBy({
      by: ['firstSeenAt'],
      where: {
        pageId: query.pageId && pageIds.includes(query.pageId) ? query.pageId : { in: pageIds },
        firstSeenAt: { gte: start, lte: end },
      },
      _count: true,
    });

    return {
      kpis: {
        totalBroadcasts,
        totalRecipients,
        messagesSent: sent,
        deliveryRate: sent ? delivered / sent : 0,
        failureRate: sent + failed ? failed / (sent + failed) : 0,
        responseRate: delivered ? responses / delivered : 0,
        averageResponseTime: null as number | null,
      },
      series: {
        broadcastVolume: broadcasts.map((b) => ({
          date: b.createdAt,
          name: b.name,
          sent: b.sentCount,
          delivered: b.deliveredCount,
          failed: b.failedCount,
        })),
        contactGrowth: contactGrowth.map((c) => ({
          date: c.firstSeenAt,
          count: c._count,
        })),
      },
    };
  });

  app.get('/api/analytics/broadcasts', async (request) => {
    const user = await requireUser(request);
    const query = analyticsQuerySchema.parse(request.query);
    const { start, end } = rangeToDates(query.range, query.from, query.to);
    const data = await prisma.broadcast.findMany({
      where: {
        userId: user.id,
        ...(query.pageId ? { pageId: query.pageId } : {}),
        createdAt: { gte: start, lte: end },
      },
      include: { template: { select: { title: true } }, page: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { data };
  });

  app.get('/api/analytics/contacts', async (request) => {
    const user = await requireUser(request);
    const query = analyticsQuerySchema.parse(request.query);
    const { start, end } = rangeToDates(query.range, query.from, query.to);
    const pageIds = (
      await prisma.pageConnection.findMany({ where: { userId: user.id }, select: { pageId: true } })
    ).map((p) => p.pageId);
    const total = await prisma.contact.count({
      where: {
        pageId: query.pageId && pageIds.includes(query.pageId) ? query.pageId : { in: pageIds },
      },
    });
    const newContacts = await prisma.contact.count({
      where: {
        pageId: query.pageId && pageIds.includes(query.pageId) ? query.pageId : { in: pageIds },
        firstSeenAt: { gte: start, lte: end },
      },
    });
    const active = await prisma.contact.count({
      where: {
        pageId: query.pageId && pageIds.includes(query.pageId) ? query.pageId : { in: pageIds },
        status: 'ACTIVE',
      },
    });
    return { total, newContacts, active };
  });
}

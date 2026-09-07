import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { connectPagesSchema } from '@pagebroadcast/validation';
import { requireUser } from '../../lib/auth.js';
import { config } from '../../lib/config.js';
import { encryptSecret } from '../../lib/crypto.js';
import { AppError, mapMetaError } from '../../lib/errors.js';
import { metaProvider } from '../../lib/meta.js';
import { prisma } from '../../lib/prisma.js';
import { writeAuditLog } from '../../lib/audit.js';
import { enqueue, QUEUE_NAMES } from '../../lib/queues.js';
import { notifyUser } from '../../lib/notify.js';
import { assertUserOwnsPage } from '../../lib/ownership.js';

const OAUTH_STATE_COOKIE = 'pb_oauth_state';

export async function facebookRoutes(app: FastifyInstance) {
  app.get('/api/facebook/connect', async (request, reply) => {
    const user = await requireUser(request);
    const state = `${user.id}.${randomBytes(16).toString('hex')}`;
    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: 600,
    });
    const url = metaProvider.getOAuthUrl(state, config.META_REDIRECT_URI);
    return reply.redirect(url);
  });

  app.get('/api/facebook/mock-authorize', async (request, reply) => {
    if (config.META_PROVIDER !== 'mock') {
      throw new AppError('FORBIDDEN', 'Mock authorize is only available in mock mode.', 403);
    }
    const q = request.query as { code?: string; state?: string; redirect_uri?: string };
    const redirectUri = q.redirect_uri || config.META_REDIRECT_URI;
    const params = new URLSearchParams({
      code: q.code || 'mock_dev_code',
      state: q.state || '',
    });
    return reply.redirect(`${redirectUri}?${params}`);
  });

  app.get('/api/facebook/callback', async (request, reply) => {
    const user = await requireUser(request);
    const q = request.query as { code?: string; state?: string; error?: string };
    if (q.error) {
      return reply.redirect(`${config.APP_URL}/connect?error=denied`);
    }
    const expected = request.cookies[OAUTH_STATE_COOKIE];
    if (!q.code || !q.state || !expected || q.state !== expected) {
      return reply.redirect(`${config.APP_URL}/connect?error=invalid_state`);
    }
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    try {
      const token = await metaProvider.exchangeCodeForToken(q.code, config.META_REDIRECT_URI);
      const fbUser = await metaProvider.getAuthorizedUser(token.accessToken);
      const expiresAt = token.expiresIn
        ? new Date(Date.now() + token.expiresIn * 1000)
        : null;

      await prisma.facebookAccount.upsert({
        where: {
          userId_platformUserId: { userId: user.id, platformUserId: fbUser.id },
        },
        create: {
          userId: user.id,
          platformUserId: fbUser.id,
          encryptedAccessToken: encryptSecret(token.accessToken),
          tokenExpiresAt: expiresAt,
          status: 'CONNECTED',
          lastApiSuccessAt: new Date(),
        },
        update: {
          encryptedAccessToken: encryptSecret(token.accessToken),
          tokenExpiresAt: expiresAt,
          status: 'CONNECTED',
          lastApiSuccessAt: new Date(),
          lastError: null,
        },
      });

      await notifyUser({
        userId: user.id,
        type: 'FACEBOOK_CONNECTED',
        title: 'Facebook connected',
        body: 'Your Facebook account was connected successfully.',
      });
      await writeAuditLog({
        actorId: user.id,
        action: 'facebook.connected',
        resource: 'facebook_account',
        resourceId: fbUser.id,
        ip: request.ip,
      });

      return reply.redirect(`${config.APP_URL}/pages/select`);
    } catch (err) {
      throw mapMetaError(err);
    }
  });

  app.get('/api/facebook/pages', async (request) => {
    const user = await requireUser(request);
    const account = await prisma.facebookAccount.findFirst({
      where: { userId: user.id, status: 'CONNECTED' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!account) {
      return { pages: [], connected: false };
    }

    const { decryptSecret } = await import('../../lib/crypto.js');
    let pages;
    try {
      const accessToken = decryptSecret(account.encryptedAccessToken);
      pages = await metaProvider.getPages(accessToken);
      await prisma.facebookAccount.update({
        where: { id: account.id },
        data: { lastApiSuccessAt: new Date() },
      });
    } catch (err) {
      await prisma.facebookAccount.update({
        where: { id: account.id },
        data: {
          status: 'NEEDS_REAUTH',
          lastError: err instanceof Error ? err.message : 'unknown',
        },
      });
      throw mapMetaError(err);
    }

    const connections = await prisma.pageConnection.findMany({
      where: { userId: user.id },
      include: { page: true },
    });
    const byPlatform = new Map(connections.map((c) => [c.page.platformPageId, c]));

    return {
      connected: true,
      pages: pages.map((p) => {
        const conn = byPlatform.get(p.id);
        return {
          platformPageId: p.id,
          name: p.name,
          profileImage: p.pictureUrl,
          category: p.category,
          connectionStatus: conn?.status ?? 'AVAILABLE',
          pageId: conn?.pageId ?? null,
          contactCount: conn?.contactCount ?? 0,
          connected: Boolean(conn),
        };
      }),
    };
  });

  app.post('/api/facebook/pages/connect', async (request) => {
    const user = await requireUser(request);
    const body = connectPagesSchema.parse(request.body);
    const account = await prisma.facebookAccount.findFirst({
      where: { userId: user.id, status: 'CONNECTED' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!account) throw new AppError('FACEBOOK_EXPIRED', 'Connect Facebook first.', 400);

    const { decryptSecret } = await import('../../lib/crypto.js');
    const userToken = decryptSecret(account.encryptedAccessToken);
    let metaPages;
    try {
      metaPages = await metaProvider.getPages(userToken);
    } catch (err) {
      throw mapMetaError(err);
    }

    const selected = metaPages.filter((p) => body.pageIds.includes(p.id));
    if (!selected.length) throw new AppError('VALIDATION', 'No valid pages selected.', 400);

    const results = [];
    for (const p of selected) {
      const page = await prisma.facebookPage.upsert({
        where: { platformPageId: p.id },
        create: {
          facebookAccountId: account.id,
          platformPageId: p.id,
          name: p.name,
          profileImage: p.pictureUrl,
          category: p.category,
          encryptedPageToken: encryptSecret(p.accessToken),
        },
        update: {
          facebookAccountId: account.id,
          name: p.name,
          profileImage: p.pictureUrl,
          category: p.category,
          encryptedPageToken: encryptSecret(p.accessToken),
        },
      });

      const existing = await prisma.pageConnection.findUnique({
        where: { userId_pageId: { userId: user.id, pageId: page.id } },
      });
      if (existing) {
        results.push({ pageId: page.id, status: 'already_connected' });
        continue;
      }

      let webhookSubscribed = false;
      try {
        await metaProvider.subscribeWebhooks(p.id, p.accessToken);
        webhookSubscribed = true;
      } catch {
        webhookSubscribed = false;
      }

      const conn = await prisma.pageConnection.create({
        data: {
          userId: user.id,
          pageId: page.id,
          status: 'SYNCING',
          webhookSubscribed,
          healthStatus: 'Connected',
        },
      });

      const syncJob = await prisma.syncJob.create({
        data: { pageId: page.id, status: 'PENDING', totalEstimated: 0 },
      });
      await enqueue(QUEUE_NAMES.FACEBOOK_SYNC, {
        syncJobId: syncJob.id,
        pageId: page.id,
        userId: user.id,
      });

      await writeAuditLog({
        actorId: user.id,
        action: 'page.connected',
        resource: 'facebook_page',
        resourceId: page.id,
        ip: request.ip,
        metadata: { platformPageId: p.id, name: p.name },
      });

      results.push({
        pageId: page.id,
        connectionId: conn.id,
        syncJobId: syncJob.id,
        status: 'connected',
      });
    }

    return { results };
  });

  app.post('/api/facebook/reconnect', async (request, reply) => {
    await requireUser(request);
    return reply.redirect('/api/facebook/connect');
  });

  app.delete('/api/facebook/pages/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const conn = await assertUserOwnsPage(user.id, id);
    await prisma.pageConnection.update({
      where: { id: conn.id },
      data: { status: 'DISCONNECTED', healthStatus: 'Disconnected' },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'page.disconnected',
      resource: 'facebook_page',
      resourceId: id,
      ip: request.ip,
    });
    await notifyUser({
      userId: user.id,
      type: 'FACEBOOK_DISCONNECTED',
      title: 'Page disconnected',
      body: `${conn.page.name} was disconnected. Historical data was retained.`,
    });
    return { ok: true };
  });

  app.get('/api/facebook/connection-health', async (request) => {
    const user = await requireUser(request);
    const account = await prisma.facebookAccount.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    const connections = await prisma.pageConnection.findMany({
      where: { userId: user.id },
      include: { page: true },
    });
    const lastWebhook = await prisma.webhookEvent.findFirst({
      where: { pageId: { in: connections.map((c) => c.pageId) } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      facebook: account
        ? {
            status: account.status,
            platformUserId: account.platformUserId,
            tokenExpiresAt: account.tokenExpiresAt,
            lastApiSuccessAt: account.lastApiSuccessAt,
            // never expose tokens
          }
        : null,
      pages: connections.map((c) => ({
        pageId: c.pageId,
        name: c.page.name,
        profileImage: c.page.profileImage,
        status: c.status,
        healthStatus: c.healthStatus,
        lastSyncedAt: c.lastSyncedAt,
        lastWebhookAt: c.lastWebhookAt,
        webhookSubscribed: c.webhookSubscribed,
      })),
      lastWebhookEventAt: lastWebhook?.createdAt ?? null,
    };
  });
}

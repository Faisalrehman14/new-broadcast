import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { connectPagesSchema } from '@pagebroadcast/validation';
import { requireUser } from '../../lib/auth.js';
import { config } from '../../lib/config.js';
import { encryptSecret } from '../../lib/crypto.js';
import { AppError, mapMetaError, oauthConnectErrorSlug } from '../../lib/errors.js';
import { metaProvider } from '../../lib/meta.js';
import { prisma } from '../../lib/prisma.js';
import { writeAuditLog } from '../../lib/audit.js';
import { enqueue, QUEUE_NAMES } from '../../lib/queues.js';
import { notifyUser } from '../../lib/notify.js';
import { assertUserOwnsPage } from '../../lib/ownership.js';
import { requireCsrf } from '../../lib/csrf.js';
import { logger } from '../../lib/logger.js';
import { enqueueUtilityEnsure, enqueueUtilityEnsureForUser } from '../../lib/utility-auto.js';

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
    const url = metaProvider.getOAuthUrl(state, config.META_REDIRECT_URI, { rerequest: true });
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
    const q = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    if (q.error) {
      logger.warn({ error: q.error, desc: q.error_description }, 'facebook oauth denied');
      const denied =
        /access_denied|user_denied|cancelled|canceled/i.test(`${q.error} ${q.error_description || ''}`)
          ? 'denied'
          : 'facebook';
      return reply.redirect(`${config.APP_URL}/connect?error=${denied}`);
    }
    const expected = request.cookies[OAUTH_STATE_COOKIE];
    if (!q.code || !q.state || !expected || q.state !== expected) {
      return reply.redirect(`${config.APP_URL}/connect?error=invalid_state`);
    }
    // Bind OAuth state to the logged-in user (prevents session fixation / cross-user replay).
    if (!q.state.startsWith(`${user.id}.`)) {
      return reply.redirect(`${config.APP_URL}/connect?error=invalid_state`);
    }
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    try {
      const token = await metaProvider.exchangeCodeForToken(q.code, config.META_REDIRECT_URI);
      let fbUser: { id: string; name: string; email?: string };
      try {
        fbUser = await metaProvider.getAuthorizedUser(token.accessToken);
      } catch (profileErr) {
        // Reconnect resilience: /me + public_profile can fail after Business Login;
        // still persist the new token onto an existing FacebookAccount when possible.
        logger.warn(
          { err: profileErr, requestId: request.id },
          'facebook /me failed; trying reconnect fallback'
        );
        const existing = await prisma.facebookAccount.findFirst({
          where: { userId: user.id },
          orderBy: { updatedAt: 'desc' },
        });
        let pages: Awaited<ReturnType<typeof metaProvider.getPages>> = [];
        try {
          pages = await metaProvider.getPages(token.accessToken);
        } catch {
          pages = [];
        }

        if (existing) {
          // Prefer known app-scoped id even when Page picker returned empty.
          fbUser = { id: existing.platformUserId, name: 'Facebook User' };
          logger.info(
            {
              requestId: request.id,
              platformUserId: existing.platformUserId,
              pageCount: pages.length,
            },
            'facebook reconnect fallback used existing account'
          );
        } else if (pages.length > 0) {
          // Brand-new connect without /me: cannot invent a stable Facebook user id.
          throw new Error(
            'Meta getAuthorizedUser failed: could not resolve Facebook user id (public_profile / debug_token). Reconnect as App admin/tester and approve public_profile.'
          );
        } else {
          throw profileErr;
        }
      }
      const expiresAt = token.expiresIn
        ? new Date(Date.now() + token.expiresIn * 1000)
        : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      const longLived = (token as { longLived?: boolean }).longLived !== false;

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
          oauthFreshAt: new Date(),
          lastError: longLived ? null : 'short_lived_token_fallback',
        },
        update: {
          encryptedAccessToken: encryptSecret(token.accessToken),
          tokenExpiresAt: expiresAt,
          status: 'CONNECTED',
          lastApiSuccessAt: new Date(),
          lastError: longLived ? null : 'short_lived_token_fallback',
          oauthFreshAt: new Date(),
        },
      });

      // Remint Page tokens while the user token is fresh (fixes "no live token" after reconnect).
      let metaPageCount = -1;
      let reminted = 0;
      try {
        const metaPages = await metaProvider.getPages(token.accessToken);
        metaPageCount = metaPages.length;
        for (const mp of metaPages) {
          if (!mp.accessToken) continue;
          const updated = await prisma.facebookPage.updateMany({
            where: {
              platformPageId: mp.id,
              facebookAccount: { userId: user.id },
            },
            data: {
              encryptedPageToken: encryptSecret(mp.accessToken),
              name: mp.name,
              profileImage: mp.pictureUrl,
              category: mp.category,
            },
          });
          reminted += updated.count;
        }
        logger.info(
          { requestId: request.id, metaPageCount, reminted },
          'facebook oauth reminted page tokens'
        );
      } catch (remintErr) {
        metaPageCount = 0;
        logger.warn(
          { err: remintErr, requestId: request.id },
          'facebook oauth page remint skipped (empty picker or Graph error)'
        );
      }

      await notifyUser({
        userId: user.id,
        type: 'FACEBOOK_CONNECTED',
        title: 'Facebook connected',
        body: longLived
          ? metaPageCount > 0
            ? `Facebook connected — refreshed ${reminted} Page token(s).`
            : 'Facebook connected. If Select Pages is empty, reconnect and tick every Page in the Facebook picker.'
          : 'Facebook connected, but long-lived token exchange failed — reconnect again soon or verify META_APP_SECRET.',
      });
      await writeAuditLog({
        actorId: user.id,
        action: 'facebook.connected',
        resource: 'facebook_account',
        resourceId: fbUser.id,
        ip: request.ip,
        metadata: { longLived, reminted, metaPageCount },
      });

      // Auto-submit Instant plain UTILITY on every connected Page and poll Meta approval.
      void enqueueUtilityEnsureForUser(user.id, { waitForApproved: true, delayMs: 3000 }).catch(
        (err) => logger.warn({ err, userId: user.id }, 'auto utility ensure enqueue failed')
      );

      const warn =
        metaPageCount === 0
          ? longLived
            ? 'no_pages'
            : 'short_token'
          : longLived
            ? null
            : 'short_token';
      return reply.redirect(
        warn
          ? `${config.APP_URL}/pages/select?warn=${warn}`
          : `${config.APP_URL}/pages/select`
      );
    } catch (err) {
      const mapped = mapMetaError(err);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          err,
          code: mapped.code,
          requestId: request.id,
          metaRedirect: config.META_REDIRECT_URI,
          snippet: msg.slice(0, 400),
        },
        'facebook oauth callback failed'
      );
      return reply.redirect(`${config.APP_URL}/connect?error=${oauthConnectErrorSlug(err)}`);
    }
  });

  app.get('/api/facebook/pages', async (request) => {
    const user = await requireUser(request);
    const account = await prisma.facebookAccount.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    if (!account || !account.encryptedAccessToken) {
      return { pages: [], connected: false };
    }

    const { decryptSecret } = await import('../../lib/crypto.js');
    const connections = await prisma.pageConnection.findMany({
      where: { userId: user.id },
      include: { page: true },
    });
    const byPlatform = new Map(connections.map((c) => [c.page.platformPageId, c]));

    let pages: Awaited<ReturnType<typeof metaProvider.getPages>> = [];
    let metaError: string | null = null;
    try {
      const accessToken = decryptSecret(account.encryptedAccessToken);
      pages = await metaProvider.getPages(accessToken);
      await prisma.facebookAccount.update({
        where: { id: account.id },
        data: {
          status: 'CONNECTED',
          lastApiSuccessAt: new Date(),
          lastError: pages.length ? null : 'me_accounts_empty',
        },
      });
    } catch (err) {
      metaError = err instanceof Error ? err.message : 'getPages failed';
      const expired = mapMetaError(err).code === 'FACEBOOK_EXPIRED';
      // Only force reauth on real token expiry — empty/partial picker must not blank the UI.
      if (expired) {
        await prisma.facebookAccount.update({
          where: { id: account.id },
          data: { status: 'NEEDS_REAUTH', lastError: metaError },
        });
        throw mapMetaError(err);
      }
      logger.warn({ err, userId: user.id }, 'facebook getPages soft-fail; serving DB connections');
      await prisma.facebookAccount.update({
        where: { id: account.id },
        data: {
          status: account.status === 'NEEDS_REAUTH' ? 'NEEDS_REAUTH' : 'CONNECTED',
          lastError: metaError.slice(0, 500),
        },
      });
    }

    const fromMeta = pages.map((p) => {
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
        hasLivePageToken: Boolean(p.accessToken),
        source: 'meta' as const,
      };
    });

    // When Meta returns nothing (picker empty), still show already-linked Pages from DB.
    const fromDb =
      fromMeta.length > 0
        ? []
        : connections
            .filter((c) => c.status !== 'DISCONNECTED')
            .map((c) => ({
              platformPageId: c.page.platformPageId,
              name: c.page.name,
              profileImage: c.page.profileImage || undefined,
              category: c.page.category || undefined,
              connectionStatus: c.status,
              pageId: c.pageId,
              contactCount: c.contactCount,
              connected: true,
              hasLivePageToken: Boolean(c.page.encryptedPageToken),
              source: 'db' as const,
            }));

    return {
      connected: true,
      metaPageCount: pages.length,
      metaError,
      pages: fromMeta.length ? fromMeta : fromDb,
    };
  });

  app.post('/api/facebook/pages/connect', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    const body = connectPagesSchema.parse(request.body);
    const account = await prisma.facebookAccount.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    if (!account?.encryptedAccessToken) {
      throw new AppError('FACEBOOK_EXPIRED', 'Connect Facebook first.', 400);
    }

    const { decryptSecret } = await import('../../lib/crypto.js');
    const userToken = decryptSecret(account.encryptedAccessToken);
    let metaPages;
    try {
      metaPages = await metaProvider.getPages(userToken);
      if (account.status !== 'CONNECTED') {
        await prisma.facebookAccount.update({
          where: { id: account.id },
          data: { status: 'CONNECTED', lastApiSuccessAt: new Date(), lastError: null },
        });
      }
    } catch (err) {
      throw mapMetaError(err);
    }

    const selected = metaPages.filter((p) => body.pageIds.includes(p.id));
    if (!selected.length) {
      throw new AppError(
        'VALIDATION',
        'No valid Pages in this Facebook token. Reconnect, tick every Page in the picker, then try again.',
        400
      );
    }

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

      let webhookSubscribed = false;
      try {
        await metaProvider.subscribeWebhooks(p.id, p.accessToken);
        webhookSubscribed = true;
      } catch {
        webhookSubscribed = existing?.webhookSubscribed ?? false;
      }

      const { activateMessengerTemplatesForPage } = await import('../../lib/template-activation.js');

      if (existing) {
        // Reconnect repair: refresh token already done on page row; restore connection + sync.
        await prisma.pageConnection.update({
          where: { id: existing.id },
          data: {
            status: 'SYNCING',
            healthStatus: 'Connected',
            webhookSubscribed,
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
        const activated = await activateMessengerTemplatesForPage({ pageId: page.id });
        void enqueueUtilityEnsure(page.id, { waitForApproved: true, userId: user.id, delayMs: 2000 });
        results.push({
          pageId: page.id,
          status: 'reconnected',
          syncJobId: syncJob.id,
          templatesActivated: activated.activated,
          utilityEnsureQueued: true,
        });
        continue;
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

      const activated = await activateMessengerTemplatesForPage({ pageId: page.id });
      void enqueueUtilityEnsure(page.id, { waitForApproved: true, userId: user.id, delayMs: 2000 });

      await writeAuditLog({
        actorId: user.id,
        action: 'page.connected',
        resource: 'facebook_page',
        resourceId: page.id,
        ip: request.ip,
        metadata: {
          platformPageId: p.id,
          name: p.name,
          templatesActivated: activated.activated,
        },
      });

      results.push({
        pageId: page.id,
        connectionId: conn.id,
        syncJobId: syncJob.id,
        status: 'connected',
        templatesActivated: activated.activated,
        utilityEnsureQueued: true,
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
    requireCsrf(request);
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

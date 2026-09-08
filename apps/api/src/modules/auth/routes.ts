import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema } from '@pagebroadcast/validation';
import { z } from 'zod';
import {
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  requireUser,
  verifyPassword,
} from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { writeAuditLog } from '../../lib/audit.js';
import { ensureCsrfCookie } from '../../lib/csrf.js';
import { ensureUserQuota } from '../../lib/campaign.js';
import { ensureTrialQuota, getBillingStatus } from '../../lib/billing.js';
import {
  emailDeliveryConfigured,
  issueEmailOtp,
  verifyAndConsumeEmailOtp,
} from '../../lib/email-otp.js';

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/register/send-otp',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request) => {
    const body = z.object({ email: z.string().email().max(320) }).parse(request.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    // Anti-enumeration: always succeed
    if (!existing) {
      try {
        await issueEmailOtp(email, 'signup');
      } catch (err) {
        if (err instanceof AppError && err.code === 'OTP_COOLDOWN') throw err;
        throw err;
      }
    }
    return { ok: true, message: 'If this email can be used, a verification code was sent.' };
  });

  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('CONFLICT', 'An account with this email already exists.', 409);

    await verifyAndConsumeEmailOtp(email, 'signup', body.otp);

    const user = await prisma.user.create({
      data: {
        email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        emailVerifiedAt: new Date(),
        planKey: 'free',
        settings: { create: { broadcastSend: true } },
      },
    });
    await ensureTrialQuota(user.id);

    await createSession(user.id, reply, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    const csrfToken = ensureCsrfCookie(reply);
    await writeAuditLog({
      actorId: user.id,
      action: 'user.registered',
      resource: 'user',
      resourceId: user.id,
      ip: request.ip,
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      csrfToken,
    };
  });

  app.post(
    '/api/auth/forgot-password/send-otp',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request) => {
    const body = z.object({ email: z.string().email().max(320) }).parse(request.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      try {
        await issueEmailOtp(email, 'password_reset');
      } catch (err) {
        if (err instanceof AppError && err.code === 'OTP_COOLDOWN') throw err;
        throw err;
      }
    }
    return { ok: true, message: 'If an account exists, a reset code was sent.' };
  });

  app.post(
    '/api/auth/forgot-password/reset',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request) => {
    const body = z
      .object({
        email: z.string().email().max(320),
        otp: z.string().min(4).max(12),
        password: z.string().min(8).max(128),
      })
      .parse(request.body);
    const email = body.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('NOT_FOUND', 'Account not found.', 404);
    await verifyAndConsumeEmailOtp(email, 'password_reset', body.otp);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.password) },
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'user.password_reset',
      resource: 'user',
      resourceId: user.id,
      ip: request.ip,
    });
    return { ok: true };
  });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;

    if (!user || !ok) {
      if (user) {
        await prisma.loginHistory.create({
          data: {
            userId: user.id,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            success: false,
          },
        });
      }
      throw new AppError('UNAUTHORIZED', 'Invalid email or password.', 401);
    }

    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        success: true,
      },
    });

    await createSession(user.id, reply, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    await ensureUserQuota(user.id);
    const csrfToken = ensureCsrfCookie(reply);
    await writeAuditLog({
      actorId: user.id,
      action: 'user.login',
      resource: 'user',
      resourceId: user.id,
      ip: request.ip,
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      csrfToken,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const user = await getSessionUser(request);
    await destroySession(request, reply);
    if (user) {
      await writeAuditLog({
        actorId: user.id,
        action: 'user.logout',
        resource: 'user',
        resourceId: user.id,
        ip: request.ip,
      });
    }
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = await requireUser(request);
    const csrfToken = ensureCsrfCookie(reply, request.cookies.pb_csrf);
    const [connections, account, settings, quota, billing] = await Promise.all([
      prisma.pageConnection.findMany({
        where: { userId: user.id },
        include: { page: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.facebookAccount.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.userSettings.findUnique({ where: { userId: user.id } }),
      ensureUserQuota(user.id),
      getBillingStatus(user.id),
    ]);
    const facebookConnected = Boolean(
      account && (account.status === 'CONNECTED' || account.status === 'NEEDS_REAUTH')
    );
    const hasUserToken = Boolean(account?.encryptedAccessToken);
    const hasAnyPageToken = connections.some((c) => Boolean(c.page.encryptedPageToken));
    // Broadcast can send with Page tokens even if /me/accounts is temporarily empty after OAuth.
    const hasLiveToken = Boolean(
      hasUserToken &&
        (account?.status === 'CONNECTED' || (account?.status === 'NEEDS_REAUTH' && hasAnyPageToken))
    );
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
      },
      csrfToken,
      facebookConnected,
      hasLiveToken,
      permissions: { 'broadcast.send': settings?.broadcastSend !== false },
      planKey: billing.planKey,
      planName: billing.planName,
      planExpiresAt: billing.planExpiresAt,
      planExpired: billing.expired,
      messagesRemaining: billing.messagesRemaining,
      messagesLimit: billing.messagesLimit,
      quota: {
        creditsRemaining: quota.creditsRemaining,
        creditsMonthly: quota.creditsMonthly,
        resetAt: quota.resetAt,
      },
      emailDelivery: emailDeliveryConfigured(),
      pages: connections.map((c) => ({
        connectionId: c.id,
        pageId: c.pageId,
        name: c.page.name,
        profileImage: c.page.profileImage,
        status: c.status,
        healthStatus: c.healthStatus,
        contactCount: c.contactCount,
        lastSyncedAt: c.lastSyncedAt,
        platformPageId: c.page.platformPageId,
        hasPageToken: Boolean(c.page.encryptedPageToken),
      })),
    };
  });
}

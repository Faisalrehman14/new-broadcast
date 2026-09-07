import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema } from '@pagebroadcast/validation';
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

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) throw new AppError('CONFLICT', 'An account with this email already exists.', 409);

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash: await hashPassword(body.password),
        settings: { create: {} },
      },
    });

    await createSession(user.id, reply, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    await writeAuditLog({
      actorId: user.id,
      action: 'user.registered',
      resource: 'user',
      resourceId: user.id,
      ip: request.ip,
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  });

  app.post('/api/auth/login', async (request, reply) => {
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
    await writeAuditLog({
      actorId: user.id,
      action: 'user.login',
      resource: 'user',
      resourceId: user.id,
      ip: request.ip,
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
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

  app.get('/api/auth/me', async (request) => {
    const user = await requireUser(request);
    const connections = await prisma.pageConnection.findMany({
      where: { userId: user.id },
      include: { page: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
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
      })),
    };
  });
}

import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { config } from './lib/config.js';
import { AppError, toFriendlyMessage } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { authRoutes } from './modules/auth/routes.js';
import { facebookRoutes } from './modules/facebook/routes.js';
import { contactRoutes } from './modules/contacts/routes.js';
import { templateRoutes } from './modules/templates/routes.js';
import { broadcastRoutes } from './modules/broadcasts/routes.js';
import { broadcastCampaignRoutes } from './modules/broadcast-campaign/routes.js';
import { webhookRoutes } from './modules/webhooks/routes.js';
import { analyticsRoutes } from './modules/analytics/routes.js';
import {
  activityRoutes,
  adminRoutes,
  dashboardRoutes,
  healthRoutes,
  notificationRoutes,
  searchRoutes,
  settingsRoutes,
  supportRoutes,
} from './modules/misc/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  await app.register(sensible);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // Allow POST/PUT with Content-Type: application/json and an empty body (common for action buttons).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const raw = typeof body === 'string' ? body : body?.toString?.() ?? '';
      if (!raw || !raw.trim()) {
        done(null, {});
        return;
      }
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.addHook('onRequest', async (request) => {
    (request as { startTime?: number }).startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const start = (request as { startTime?: number }).startTime ?? Date.now();
    const durationMs = Date.now() - start;
    if (request.url.startsWith('/api')) {
      prisma.apiLog
        .create({
          data: {
            requestId: request.id,
            method: request.method,
            path: request.url.split('?')[0]!,
            statusCode: reply.statusCode,
            durationMs,
            error: reply.statusCode >= 400 ? `HTTP ${reply.statusCode}` : null,
          },
        })
        .catch(() => undefined);
    }
    logger.info({
      request_id: request.id,
      method: request.method,
      path: request.url,
      status: reply.statusCode,
      duration_ms: durationMs,
    });
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION',
          message: toFriendlyMessage('VALIDATION'),
          details: err.flatten(),
          requestId: request.id,
        },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          details: config.NODE_ENV === 'development' ? err.details : undefined,
          requestId: request.id,
        },
      });
    }
    // Fastify JSON body parse failures (FST_ERR_CTP_EMPTY_JSON_BODY / unexpected token)
    const anyErr = err as Error & { code?: string; statusCode?: number };
    if (
      anyErr.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      anyErr.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      /Unexpected end of JSON|Body cannot be empty/i.test(anyErr.message || '')
    ) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION',
          message: 'Invalid request body.',
          requestId: request.id,
        },
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      logger.error({ err, request_id: request.id, code: err.code }, 'prisma error');
      if (err.code === 'P2021' || err.code === 'P2022') {
        return reply.code(503).send({
          error: {
            code: 'DB_NOT_READY',
            message:
              'Database tables are missing. The API is applying migrations — retry in a minute.',
            requestId: request.id,
          },
        });
      }
    }
    logger.error({ err, request_id: request.id }, 'unhandled error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong. Please try again.',
        requestId: request.id,
      },
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(facebookRoutes);
  await app.register(contactRoutes);
  await app.register(templateRoutes);
  await app.register(broadcastRoutes);
  await app.register(broadcastCampaignRoutes);
  await app.register(webhookRoutes);
  await app.register(analyticsRoutes);
  await app.register(dashboardRoutes);
  await app.register(supportRoutes);
  await app.register(notificationRoutes);
  await app.register(settingsRoutes);
  await app.register(searchRoutes);
  await app.register(activityRoutes);
  await app.register(adminRoutes);

  return app;
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../../lib/config.js';
import { prisma } from '../../lib/prisma.js';
import { enqueue, QUEUE_NAMES } from '../../lib/queues.js';
import { logger } from '../../lib/logger.js';

function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (config.META_PROVIDER === 'mock') return true;
  if (!signatureHeader || !config.META_APP_SECRET) return false;
  const expected =
    'sha256=' +
    createHmac('sha256', config.META_APP_SECRET).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function webhookRoutes(app: FastifyInstance) {
  app.get('/api/webhooks/facebook', async (request, reply) => {
    const q = request.query as {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
    if (
      q['hub.mode'] === 'subscribe' &&
      q['hub.verify_token'] === config.META_WEBHOOK_VERIFY_TOKEN
    ) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send('Forbidden');
  });

  app.post('/api/webhooks/facebook', async (request, reply) => {
    const raw =
      typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body ?? {});
    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    if (!verifySignature(raw, signature)) {
      logger.warn({ requestId: request.id }, 'webhook signature invalid');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const payload = typeof request.body === 'object' ? request.body : JSON.parse(raw);
    const entries = (payload as { entry?: Array<{ id?: string; time?: number }> })?.entry ?? [];

    // Acknowledge quickly — process async
    for (const entry of entries) {
      const externalEventId = entry.id
        ? `${entry.id}:${entry.time ?? Date.now()}:${createHmac('sha256', 'pb')
            .update(JSON.stringify(entry))
            .digest('hex')
            .slice(0, 16)}`
        : undefined;

      try {
        const page = entry.id
          ? await prisma.facebookPage.findUnique({ where: { platformPageId: entry.id } })
          : null;

        const event = await prisma.webhookEvent.create({
          data: {
            pageId: page?.id,
            eventType: (payload as { object?: string }).object ?? 'page',
            externalEventId,
            payload: payload as object,
            processed: false,
          },
        });
        await enqueue(QUEUE_NAMES.WEBHOOK, { webhookEventId: event.id });
      } catch (err) {
        // Unique constraint = duplicate event — ignore
        logger.info({ err }, 'webhook event store skipped/duplicate');
      }
    }

    return reply.code(200).send('EVENT_RECEIVED');
  });
}

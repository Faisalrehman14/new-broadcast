import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../lib/auth.js';
import { requireCsrf } from '../../lib/csrf.js';
import {
  createCheckoutOrder,
  getBillingStatus,
  listActivePlans,
  tryActivateOrder,
} from '../../lib/billing.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { writeAuditLog } from '../../lib/audit.js';

export async function billingRoutes(app: FastifyInstance) {
  app.get('/api/billing/plans', async () => {
    const plans = await listActivePlans();
    return {
      plans: plans.map((p) => ({
        key: p.key,
        name: p.name,
        amountCents: p.amountCents,
        messageLimit: p.messageLimit,
        interval: p.interval,
        priceUsd: (p.amountCents / 100).toFixed(2),
      })),
      trial: { key: 'free', messageLimit: 2000, days: 7 },
    };
  });

  app.get('/api/billing/status', async (request) => {
    const user = await requireUser(request);
    return getBillingStatus(user.id);
  });

  app.post('/api/billing/checkout', async (request) => {
    const user = await requireUser(request);
    requireCsrf(request);
    const body = z.object({ plan: z.string().min(1) }).parse(request.body);
    const order = await createCheckoutOrder(user.id, body.plan);
    await writeAuditLog({
      actorId: user.id,
      action: 'billing.checkout',
      resource: 'payment_order',
      resourceId: order.id,
      ip: request.ip,
      metadata: { planKey: order.planKey, amountCents: order.amountCents },
    });
    return {
      orderId: order.id,
      planKey: order.planKey,
      amountCents: order.amountCents,
      bolt11: order.bolt11,
      qrDataUrl: order.qrDataUrl,
      sats: order.sats,
      expiresAt: order.expiresAt,
      status: order.status,
    };
  });

  app.get('/api/billing/orders/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const order = await prisma.paymentOrder.findFirst({
      where: { id, userId: user.id },
    });
    if (!order) throw new AppError('NOT_FOUND', 'Order not found.', 404);
    const result = await tryActivateOrder(order.id);
    return {
      orderId: result.order.id,
      status: result.order.status,
      activated: result.activated,
      planKey: result.order.planKey,
      bolt11: result.order.bolt11,
      qrDataUrl: result.order.qrDataUrl,
      sats: result.order.sats,
      expiresAt: result.order.expiresAt,
      settledAt: result.order.settledAt,
      activatedAt: result.order.activatedAt,
    };
  });
}

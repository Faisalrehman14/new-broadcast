import { prisma } from './prisma.js';
import { AppError } from './errors.js';
import {
  ALL_PLANS,
  FREE_TRIAL,
  PAID_PLANS,
  addDays,
  addMonths,
  getCanonicalPlan,
  type PlanKey,
} from './plans.js';
import { createLightningInvoice, isAlbyConfigured, isInvoiceSettled } from './alby.js';
import { logger } from './logger.js';

export async function syncCanonicalPlans() {
  for (const plan of ALL_PLANS) {
    if (plan.key === 'free') continue;
    await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      create: {
        key: plan.key,
        name: plan.name,
        amountCents: plan.amountCents,
        messageLimit: plan.messageLimit,
        interval: plan.interval,
        active: true,
        sortOrder: plan.sortOrder,
      },
      update: {
        name: plan.name,
        amountCents: plan.amountCents,
        messageLimit: plan.messageLimit,
        interval: plan.interval,
        sortOrder: plan.sortOrder,
      },
    });
  }
}

export async function listActivePlans() {
  await syncCanonicalPlans();
  const rows = await prisma.subscriptionPlan.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (rows.length) return rows;
  return PAID_PLANS.map((p) => ({
    id: p.key,
    key: p.key,
    name: p.name,
    amountCents: p.amountCents,
    messageLimit: p.messageLimit,
    interval: p.interval,
    active: true,
    sortOrder: p.sortOrder,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

export async function ensureTrialQuota(userId: string) {
  const expires = addDays(new Date(), FREE_TRIAL.trialDays || 7);
  await prisma.user.update({
    where: { id: userId },
    data: {
      planKey: 'free',
      planExpiresAt: expires,
    },
  });
  await prisma.userQuota.upsert({
    where: { userId },
    create: {
      userId,
      creditsRemaining: FREE_TRIAL.messageLimit,
      creditsMonthly: FREE_TRIAL.messageLimit,
      resetAt: expires,
    },
    update: {
      creditsRemaining: FREE_TRIAL.messageLimit,
      creditsMonthly: FREE_TRIAL.messageLimit,
      resetAt: expires,
    },
  });
}

export async function activatePlanForUser(input: {
  userId: string;
  planKey: string;
  extendSamePlan?: boolean;
}) {
  const plan = getCanonicalPlan(input.planKey);
  if (!plan || plan.key === 'free') {
    throw new AppError('INVALID_PLAN', 'Unknown paid plan.', 400);
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  const samePlan = user.planKey === plan.key;
  const now = new Date();
  let expires: Date;
  if (input.extendSamePlan !== false && samePlan && user.planExpiresAt && user.planExpiresAt > now) {
    expires = addMonths(user.planExpiresAt, 1);
  } else {
    expires = addMonths(now, 1);
  }

  const resetUsage = !samePlan || user.planKey === 'free';
  await prisma.$transaction([
    prisma.user.update({
      where: { id: input.userId },
      data: { planKey: plan.key, planExpiresAt: expires },
    }),
    prisma.userQuota.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        creditsRemaining: plan.messageLimit,
        creditsMonthly: plan.messageLimit,
        resetAt: expires,
      },
      update: {
        creditsMonthly: plan.messageLimit,
        resetAt: expires,
        ...(resetUsage ? { creditsRemaining: plan.messageLimit } : {}),
      },
    }),
  ]);
  return { planKey: plan.key as PlanKey, planExpiresAt: expires, messageLimit: plan.messageLimit };
}

export async function grantMessages(userId: string, amount: number) {
  const n = Math.max(0, Math.floor(amount));
  await prisma.userQuota.upsert({
    where: { userId },
    create: {
      userId,
      creditsRemaining: n,
      creditsMonthly: Math.max(n, FREE_TRIAL.messageLimit),
      resetAt: addMonths(new Date(), 1),
    },
    update: { creditsRemaining: { increment: n } },
  });
}

export async function resetQuotaToPlan(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const plan = getCanonicalPlan(user.planKey) || FREE_TRIAL;
  const expires = user.planExpiresAt || addMonths(new Date(), 1);
  await prisma.userQuota.upsert({
    where: { userId },
    create: {
      userId,
      creditsRemaining: plan.messageLimit,
      creditsMonthly: plan.messageLimit,
      resetAt: expires,
    },
    update: {
      creditsRemaining: plan.messageLimit,
      creditsMonthly: plan.messageLimit,
      resetAt: expires,
    },
  });
}

export async function createCheckoutOrder(userId: string, planKey: string) {
  const plan = getCanonicalPlan(planKey);
  if (!plan || plan.key === 'free' || plan.amountCents <= 0) {
    throw new AppError('INVALID_PLAN', 'Select a paid plan.', 400);
  }
  if (!isAlbyConfigured()) {
    throw new AppError(
      'BILLING_UNAVAILABLE',
      'Lightning payments are not configured yet. Ask an admin to activate your plan.',
      503
    );
  }

  const invoice = await createLightningInvoice({
    amountCents: plan.amountCents,
    description: `CastMe Pro ${plan.name}`,
  });

  const order = await prisma.paymentOrder.create({
    data: {
      userId,
      planKey: plan.key,
      amountCents: plan.amountCents,
      provider: 'alby',
      status: 'waiting',
      bolt11: invoice.bolt11,
      paymentHash: invoice.paymentHash || null,
      qrDataUrl: invoice.qrDataUrl,
      sats: invoice.sats,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return order;
}

export async function tryActivateOrder(orderId: string, opts?: { force?: boolean }) {
  const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  if (order.activatedAt || order.status === 'activated') {
    return { order, activated: true as const };
  }
  if (order.status === 'expired') return { order, activated: false as const };

  let settled = opts?.force === true;
  if (!settled && order.paymentHash) {
    settled = await isInvoiceSettled(order.paymentHash);
  }
  if (!settled) {
    if (order.expiresAt && order.expiresAt.getTime() < Date.now()) {
      const expired = await prisma.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'expired' },
      });
      return { order: expired, activated: false as const };
    }
    return { order, activated: false as const };
  }

  await activatePlanForUser({ userId: order.userId, planKey: order.planKey });
  const updated = await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status: 'activated',
      settledAt: new Date(),
      activatedAt: new Date(),
    },
  });
  return { order: updated, activated: true as const };
}

export async function reclaimPendingAlbyOrders(limit = 20) {
  if (!isAlbyConfigured()) return { checked: 0, activated: 0 };
  const pending = await prisma.paymentOrder.findMany({
    where: {
      provider: 'alby',
      status: { in: ['pending', 'waiting'] },
      paymentHash: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let activated = 0;
  for (const order of pending) {
    try {
      const result = await tryActivateOrder(order.id);
      if (result.activated) activated += 1;
    } catch (err) {
      logger.warn({ err, orderId: order.id }, 'alby reclaim failed');
    }
  }
  return { checked: pending.length, activated };
}

export async function getBillingStatus(userId: string) {
  const [user, quota] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.userQuota.findUnique({ where: { userId } }),
  ]);
  const plan = getCanonicalPlan(user.planKey) || FREE_TRIAL;
  const expired = Boolean(user.planExpiresAt && user.planExpiresAt.getTime() < Date.now());
  return {
    planKey: user.planKey,
    planName: plan.name,
    planExpiresAt: user.planExpiresAt,
    expired,
    messagesRemaining: quota?.creditsRemaining ?? 0,
    messagesLimit: quota?.creditsMonthly ?? plan.messageLimit,
    albyConfigured: isAlbyConfigured(),
  };
}

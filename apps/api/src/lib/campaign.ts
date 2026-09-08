import type { User } from '@prisma/client';
import { prisma } from './prisma.js';
import { AppError } from './errors.js';

export type AppPermission = 'broadcast.send';

export async function requirePermission(user: User, permission: AppPermission): Promise<void> {
  if (permission === 'broadcast.send') {
    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    if (settings && settings.broadcastSend === false) {
      throw new AppError('FORBIDDEN', 'You do not have permission to send broadcasts.', 403);
    }
  }
}

export async function ensureUserQuota(userId: string) {
  const resetAt = new Date();
  resetAt.setMonth(resetAt.getMonth() + 1);
  return prisma.userQuota.upsert({
    where: { userId },
    create: {
      userId,
      creditsRemaining: 5000,
      creditsMonthly: 5000,
      resetAt,
    },
    update: {},
  });
}

export async function assertQuotaAvailable(userId: string, units: number) {
  const quota = await ensureUserQuota(userId);
  if (quota.resetAt.getTime() <= Date.now()) {
    const next = new Date();
    next.setMonth(next.getMonth() + 1);
    const refreshed = await prisma.userQuota.update({
      where: { userId },
      data: {
        creditsRemaining: quota.creditsMonthly,
        resetAt: next,
      },
    });
    if (refreshed.creditsRemaining < units) {
      throw new AppError('QUOTA_EXCEEDED', 'Monthly message quota exceeded.', 402);
    }
    return refreshed;
  }
  if (quota.creditsRemaining < units) {
    throw new AppError('QUOTA_EXCEEDED', 'Monthly message quota exceeded.', 402);
  }
  return quota;
}

export async function consumeQuota(userId: string, units: number) {
  await ensureUserQuota(userId);
  await prisma.userQuota.update({
    where: { userId },
    data: { creditsRemaining: { decrement: units } },
  });
}

const ACTIVE_PHASES = [
  'queued',
  'setting_up_templates',
  'syncing_leads',
  'sending',
  'paused',
] as const;

export async function findActiveCampaign(userId: string) {
  return prisma.broadcastCampaign.findFirst({
    where: {
      userId,
      dismissedAt: null,
      phase: { in: [...ACTIVE_PHASES] },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export function speedToDelayMs(preset?: string, delayMs?: number): { speedPreset: string; delayMs: number } {
  if (typeof delayMs === 'number' && delayMs >= 0) {
    return { speedPreset: preset || 'custom', delayMs };
  }
  switch (preset) {
    case 'balanced':
      return { speedPreset: 'balanced', delayMs: 300 };
    case 'fast':
      return { speedPreset: 'fast', delayMs: 150 };
    case 'turbo':
      return { speedPreset: 'turbo', delayMs: 80 };
    case 'safe':
    default:
      return { speedPreset: 'safe', delayMs: 600 };
  }
}

export function estimateQuotaUnits(input: {
  recipients: number;
  hasImage?: boolean;
  outside24hImageMode?: boolean;
}): number {
  if (input.recipients <= 0) return 0;
  if (input.hasImage && !input.outside24hImageMode) return input.recipients * 2;
  return input.recipients;
}

export const PLAIN_UTILITY_TEMPLATE_NAME = 'castme_plain_utility_v1';
export const PLAIN_UTILITY_BODY = '{{1}}';

/** Full reference Messenger starter library (28 templates) — shared with web. */
export {
  STARTER_UTILITY_TEMPLATES,
  STARTER_UTILITY_TEMPLATE_COUNT,
  type StarterUtilityTemplate,
} from '@pagebroadcast/validation';


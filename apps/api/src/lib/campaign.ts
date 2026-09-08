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

/** Curated UTILITY starters — PageInteract-style library for CastMe. */
export const STARTER_UTILITY_TEMPLATES = [
  {
    id: 'account_update',
    name: 'castme_account_update_v1',
    title: 'Account update',
    badge: 'Starter',
    description: 'Name greeting with a short status line',
    body: 'Hi {{1}}, your account status was updated: {{2}}.',
    parameters: ['name', 'status'],
    labels: ['Customer name', 'Status detail'],
    examples: ['Ahmed', 'Your plan is now active'],
  },
  {
    id: 'order_status',
    name: 'castme_order_status_v1',
    title: 'Order status',
    badge: 'Starter',
    description: 'Order id + status confirmation',
    body: 'Hi {{1}}, your order {{2}} is now {{3}}.',
    parameters: ['name', 'order_id', 'status'],
    labels: ['Customer name', 'Order / code', 'Status'],
    examples: ['Ahmed', '#54321', 'ready for pickup'],
  },
  {
    id: 'appointment_reminder',
    name: 'castme_appointment_v1',
    title: 'Appointment reminder',
    badge: 'Starter',
    description: 'Friendly appointment reminder',
    body: 'Hi {{1}}, reminder: your appointment is on {{2}}.',
    parameters: ['name', 'datetime'],
    labels: ['Customer name', 'Date & time'],
    examples: ['Ahmed', 'Friday 3:00 PM'],
  },
  {
    id: 'plan_activated',
    name: 'castme_plan_activated_v1',
    title: 'Plan activated checklist',
    badge: 'Premium',
    description: 'Welcome + feature checklist for an active plan',
    body: 'Hi {{1}},\n\nYour {{2}} is active right now.\n\n✅ {{3}}\n\n✅ {{4}}\n\n✅ {{5}}\n\n✅ {{6}}\n\nReply if you have any questions.',
    parameters: ['name', 'plan', 'b1', 'b2', 'b3', 'b4'],
    labels: ['Customer name', 'Plan / offer', 'Benefit 1', 'Benefit 2', 'Benefit 3', 'Benefit 4'],
    examples: ['Ahmed', 'VIP plan', 'Daily updates', 'Fast support', 'Bonus rewards', 'Easy renew'],
  },
  {
    id: 'daily_summary',
    name: 'castme_daily_summary_v1',
    title: 'Daily summary report',
    badge: 'Premium',
    description: 'Daily summary with three highlight bullets',
    body: 'Hi {{1}},\n\nHere is your daily {{2}} summary:\n\n✅ {{3}}\n✅ {{4}}\n✅ {{5}}\n\nLet us know if you need help!',
    parameters: ['name', 'topic', 'h1', 'h2', 'h3'],
    labels: ['Customer name', 'Summary topic', 'Highlight 1', 'Highlight 2', 'Highlight 3'],
    examples: ['Ahmed', 'earnings', 'Sales up 12%', '3 new leads', '1 refund pending'],
  },
  {
    id: 'account_active',
    name: 'castme_account_active_v1',
    title: 'Account now active',
    badge: 'Basic',
    description: 'ACTIVE confirmation with two perks',
    body: 'Hello {{1}},\n\nYour {{2}} is now ACTIVE. ✅\n\n{{3}}\n{{4}}\n\nReply if you have any questions.',
    parameters: ['name', 'what', 'perk1', 'perk2'],
    labels: ['Customer name', 'What is active', 'Perk 1', 'Perk 2'],
    examples: ['Ahmed', 'account', 'Welcome bonus unlocked', 'Priority support on'],
  },
  {
    id: 'ticket_resolved',
    name: 'castme_ticket_resolved_v1',
    title: 'Ticket resolved',
    badge: 'Basic',
    description: 'Issue resolved with closing reply invite',
    body: 'Hi {{1}},\n\nYour {{2}} is resolved. ✅\n\n{{3}}\n\nReply if you have any questions.',
    parameters: ['name', 'ticket', 'note'],
    labels: ['Customer name', 'Ticket / issue', 'Resolution note'],
    examples: ['Jane', 'ticket #543', 'Your account should work normally now.'],
  },
  {
    id: 'delivery_arrived',
    name: 'castme_delivery_arrived_v1',
    title: 'Delivery arrived',
    badge: 'Basic',
    description: 'Arrival / delivery confirmation',
    body: 'Hey {{1}},\n\nYour {{2}} has arrived. ✅\n\n{{3}}\n\nReply if you have any questions.',
    parameters: ['name', 'item', 'note'],
    labels: ['Customer name', 'What arrived', 'Extra note'],
    examples: ['Jane', 'parcel', 'You can pick it up today.'],
  },
  {
    id: 'payment_complete',
    name: 'castme_payment_complete_v1',
    title: 'Payment complete',
    badge: 'Basic',
    description: 'Completion notice with a follow-up prompt',
    body: 'Hi {{1}},\n\nYour {{2}} is complete. ✅\n\n{{3}}\n\nReply if you have any questions.',
    parameters: ['name', 'what', 'followup'],
    labels: ['Customer name', 'What completed', 'Follow-up question'],
    examples: ['John', 'Invoice #24', 'Have you received the packet?'],
  },
  {
    id: 'quick_confirm',
    name: 'castme_quick_confirm_v1',
    title: 'Quick confirmation',
    badge: 'Simple',
    description: 'One-line confirmation',
    body: 'Hi, your {{1}} is now confirmed. ✅',
    parameters: ['what'],
    labels: ['What is confirmed'],
    examples: ['order #120'],
  },
] as const;

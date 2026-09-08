/** Canonical prepaid plan catalog (Alby Lightning). */

export type PlanKey = 'free' | 'starter' | 'sapphire' | 'platinum';

export type PlanDefinition = {
  key: PlanKey;
  name: string;
  amountCents: number;
  messageLimit: number;
  interval: 'trial' | 'month';
  trialDays?: number;
  sortOrder: number;
};

export const FREE_TRIAL: PlanDefinition = {
  key: 'free',
  name: 'Free trial',
  amountCents: 0,
  messageLimit: 2000,
  interval: 'trial',
  trialDays: 7,
  sortOrder: 0,
};

export const PAID_PLANS: PlanDefinition[] = [
  {
    key: 'starter',
    name: 'Starter',
    amountCents: 1000,
    messageLimit: 50_000,
    interval: 'month',
    sortOrder: 1,
  },
  {
    key: 'sapphire',
    name: 'Sapphire',
    amountCents: 2500,
    messageLimit: 1_000_000,
    interval: 'month',
    sortOrder: 2,
  },
  {
    key: 'platinum',
    name: 'Platinum',
    amountCents: 5000,
    messageLimit: 5_000_000,
    interval: 'month',
    sortOrder: 3,
  },
];

export const ALL_PLANS: PlanDefinition[] = [FREE_TRIAL, ...PAID_PLANS];

export function getCanonicalPlan(key: string): PlanDefinition | null {
  const k = String(key || '').trim().toLowerCase();
  if (k === 'basic') return PAID_PLANS.find((p) => p.key === 'starter') || null;
  if (k === 'pro' || k === 'gold') return PAID_PLANS.find((p) => p.key === 'sapphire') || null;
  return ALL_PLANS.find((p) => p.key === k) || null;
}

export function addMonths(from: Date, months = 1): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

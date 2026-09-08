export type StarterTemplate = {
  id: string;
  name: string;
  title: string;
  badge: string;
  description: string;
  body: string;
  parameters: string[];
  labels: string[];
  examples: string[];
};

/** Fallback catalog if API starters are thin — mirrors server STARTER_UTILITY_TEMPLATES. */
export const STARTER_COPY: StarterTemplate[] = [
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
];

export const CUSTOM_STARTER: StarterTemplate = {
  id: 'custom',
  name: 'custom_freeform',
  title: 'Custom message',
  badge: 'Simple',
  description: 'Write anything — sent as plain UTILITY outside the 24h window',
  body: '{{1}}',
  parameters: ['message'],
  labels: ['Your message'],
  examples: ['Hello! Here is a quick update for you.'],
};

export function fillTemplateBody(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const idx = Number(n) - 1;
    return values[idx] ?? '';
  });
}

export function isNameLabel(label: string): boolean {
  return /name/i.test(label);
}

export function mergeStarters(
  apiStarters: Array<Partial<StarterTemplate> & { id: string; name: string; title: string; body: string }>
): StarterTemplate[] {
  const byName = new Map(STARTER_COPY.map((s) => [s.name, s]));
  const merged = apiStarters.map((s) => {
    const local = byName.get(s.name);
    return {
      id: s.id,
      name: s.name,
      title: s.title,
      badge: s.badge || local?.badge || 'Starter',
      description: s.description || local?.description || '',
      body: s.body,
      parameters: s.parameters || local?.parameters || [],
      labels: s.labels || local?.labels || (s.parameters || []).map((p, i) => `Field ${i + 1}`),
      examples: s.examples || local?.examples || [],
    } satisfies StarterTemplate;
  });
  // Prefer richer local catalog when API is older / thinner
  if (merged.length < STARTER_COPY.length) {
    const names = new Set(merged.map((m) => m.name));
    for (const s of STARTER_COPY) {
      if (!names.has(s.name)) merged.push(s);
    }
  }
  return merged;
}

export const SPEED_PRESETS = [
  { id: 'safe' as const, label: 'Safe', hint: '600ms · gentlest on Meta limits' },
  { id: 'balanced' as const, label: 'Balanced', hint: '300ms · recommended' },
  { id: 'fast' as const, label: 'Fast', hint: '150ms · higher throughput' },
  { id: 'turbo' as const, label: 'Turbo', hint: '80ms · max speed' },
];

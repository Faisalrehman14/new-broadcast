import {
  STARTER_UTILITY_TEMPLATES,
  type StarterUtilityTemplate,
} from '@pagebroadcast/validation';

export type StarterTemplate = StarterUtilityTemplate;

/** Local fallback = full reference catalog (same as API). */
export const STARTER_COPY: StarterTemplate[] = STARTER_UTILITY_TEMPLATES.map((t) => ({ ...t }));

export const CUSTOM_STARTER: StarterTemplate = {
  id: 'custom',
  name: 'custom_freeform',
  title: 'Custom message',
  badge: 'Instant',
  description: 'Write anything — uses shared plain UTILITY (no new Meta template wait)',
  body: '{{1}}',
  parameters: ['message'],
  labels: ['Your message'],
  examples: ['Hello! Here is a quick update for you.'],
  instant: true,
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
    const local = byName.get(s.name) || STARTER_COPY.find((x) => x.id === s.id);
    return {
      id: s.id,
      name: s.name,
      title: s.title,
      badge: s.badge || local?.badge || 'Starter',
      description: s.description || local?.description || '',
      body: s.body,
      parameters: s.parameters || local?.parameters || [],
      labels: s.labels || local?.labels || (s.parameters || []).map((_, i) => `Field ${i + 1}`),
      examples: s.examples || local?.examples || [],
      instant: Boolean(s.instant ?? local?.instant),
    } satisfies StarterTemplate;
  });
  // Prefer full local/reference catalog when API response is thinner/older
  const ids = new Set(merged.map((m) => m.id));
  for (const s of STARTER_COPY) {
    if (!ids.has(s.id)) merged.push(s);
  }
  // Instant presets first in the library
  merged.sort((a, b) => Number(Boolean(b.instant)) - Number(Boolean(a.instant)));
  return merged;
}

export const SPEED_PRESETS = [
  { id: 'safe' as const, label: 'Safe', hint: '600ms · gentlest on Meta limits' },
  { id: 'balanced' as const, label: 'Balanced', hint: '300ms · recommended' },
  { id: 'fast' as const, label: 'Fast', hint: '150ms · higher throughput' },
  { id: 'turbo' as const, label: 'Turbo', hint: '80ms · max speed' },
];

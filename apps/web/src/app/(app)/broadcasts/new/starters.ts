import {
  STARTER_UTILITY_TEMPLATES,
  TEMPLATE_QUICK_CHIPS,
  type StarterUtilityTemplate,
} from '@pagebroadcast/validation';

export type StarterTemplate = StarterUtilityTemplate;

export { TEMPLATE_QUICK_CHIPS };

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

function templateSortKey(t: StarterTemplate): number {
  if (t.instant) return 10_000;
  const m = /^Template-(\d+)$/i.exec(t.title);
  if (m) return Number(m[1]);
  return 9_000;
}

export function mergeStarters(
  apiStarters: Array<
    Partial<StarterTemplate> & { id: string; name: string; title: string; body: string }
  >
): StarterTemplate[] {
  const byName = new Map(STARTER_COPY.map((s) => [s.name, s]));
  const merged = apiStarters.map((s) => {
    const local = byName.get(s.name) || STARTER_COPY.find((x) => x.id === s.id);
    return {
      id: s.id,
      name: s.name,
      title: s.title,
      badge: s.badge || local?.badge || 'EN',
      description: s.description || local?.description || '',
      body: s.body,
      parameters: s.parameters || local?.parameters || [],
      labels: s.labels || local?.labels || (s.parameters || []).map((_, i) => `Field ${i + 1}`),
      examples: s.examples || local?.examples || [],
      instant: Boolean(s.instant ?? local?.instant),
    } satisfies StarterTemplate;
  });
  const ids = new Set(merged.map((m) => m.id));
  for (const s of STARTER_COPY) {
    if (!ids.has(s.id)) {
      merged.push({
        ...s,
        instant: Boolean(s.instant),
      });
    }
  }
  // Numbered Template-N first; Instant presets after
  merged.sort((a, b) => templateSortKey(a) - templateSortKey(b) || a.title.localeCompare(b.title));
  return merged;
}

export const SPEED_PRESETS = [
  { id: 'safe' as const, label: 'Safe', hint: '800ms · gentlest on Meta Pages limits' },
  { id: 'balanced' as const, label: 'Balanced', hint: '400ms · recommended (spread evenly)' },
  { id: 'fast' as const, label: 'Fast', hint: '250ms · still under per-Page RPS gate' },
  { id: 'turbo' as const, label: 'Turbo', hint: '150ms · capped — avoid Meta throttle spikes' },
];

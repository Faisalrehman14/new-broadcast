import type { ParsedTemplate, TemplateVariableDef } from '@pagebroadcast/types';
import { z } from 'zod';

const VARIABLE_RE = /\{\{(\d+)\}\}/g;
const MAX_VARIABLE_VALUE_LENGTH = 500;

export function parseTemplateVariables(body: string): ParsedTemplate {
  const found = new Map<string, TemplateVariableDef>();
  const order: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(VARIABLE_RE);
  while ((match = re.exec(body)) !== null) {
    const key = match[1]!;
    if (!found.has(key)) {
      found.set(key, { key, position: Number(key) });
      order.push(key);
    }
  }

  const variables = order.map((k) => found.get(k)!);
  const positions = variables.map((v) => v.position).sort((a, b) => a - b);
  const duplicates: string[] = [];
  const seen = new Set<string>();
  const allKeys: string[] = [];
  re.lastIndex = 0;
  while ((match = re.exec(body)) !== null) {
    allKeys.push(match[1]!);
  }
  for (const k of allKeys) {
    if (seen.has(k) && !duplicates.includes(k)) duplicates.push(k);
    seen.add(k);
  }

  const missingNumbers: number[] = [];
  if (positions.length > 0) {
    const max = positions[positions.length - 1]!;
    for (let i = 1; i <= max; i++) {
      if (!positions.includes(i)) missingNumbers.push(i);
    }
  }

  return { variables, duplicates, missingNumbers, raw: body };
}

export function renderTemplatePreview(
  body: string,
  values: Record<string, string>
): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, key: string) => {
    const v = values[key];
    return v !== undefined && v !== '' ? v : `{{${key}}}`;
  });
}

export function sanitizeVariableValue(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .trim()
    .slice(0, MAX_VARIABLE_VALUE_LENGTH);
}

export function validateTemplateValues(
  body: string,
  values: Record<string, string>
): { ok: true; sanitized: Record<string, string> } | { ok: false; errors: string[] } {
  const parsed = parseTemplateVariables(body);
  const errors: string[] = [];
  const sanitized: Record<string, string> = {};

  if (parsed.missingNumbers.length > 0) {
    errors.push(`Template has gaps in variable numbering: ${parsed.missingNumbers.join(', ')}`);
  }

  for (const v of parsed.variables) {
    const raw = values[v.key];
    if (raw === undefined || String(raw).trim() === '') {
      errors.push(`Variable {{${v.key}}} is required`);
      continue;
    }
    if (String(raw).length > MAX_VARIABLE_VALUE_LENGTH) {
      errors.push(`Variable {{${v.key}}} exceeds ${MAX_VARIABLE_VALUE_LENGTH} characters`);
      continue;
    }
    sanitized[v.key] = sanitizeVariableValue(String(raw));
  }

  for (const key of Object.keys(values)) {
    if (!/^\d+$/.test(key)) {
      errors.push(`Invalid variable key: ${key}`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, sanitized };
}

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
  otp: z.string().min(4).max(12),
});

export const connectPagesSchema = z.object({
  pageIds: z.array(z.string().min(1)).min(1).max(50),
});

export const createBroadcastSchema = z.object({
  name: z.string().min(1).max(200),
  pageId: z.string().uuid(),
  templateId: z.string().uuid(),
  recipientMode: z.enum(['ALL_ELIGIBLE', 'SELECTED', 'TAGS', 'FILTERS']),
  contactIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  filters: z
    .object({
      status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      neverContacted: z.boolean().optional(),
      previouslyContacted: z.boolean().optional(),
      newSinceDays: z.number().int().positive().optional(),
    })
    .optional(),
  variableValues: z.record(z.string()).default({}),
  scheduledAt: z.string().datetime().optional(),
});

export const submitTemplateSchema = z.object({
  pageId: z.string().uuid(),
  variableSampleValues: z.record(z.string()).optional(),
});

export const activateTemplatesSchema = z.object({
  pageId: z.string().uuid(),
  templateIds: z.array(z.string().uuid()).optional(),
});

export const supportTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  category: z.enum(['GENERAL', 'BILLING', 'TECHNICAL', 'META', 'OTHER']),
  description: z.string().min(1).max(5000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
});

export const templateImportSchema = z.object({
  title: z.string().min(1).max(200),
  metaName: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  body: z.string().min(1).max(10000),
});

export const contactsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  q: z.string().max(200).optional(),
  pageId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
  tagId: z.string().uuid().optional(),
  neverContacted: z.coerce.boolean().optional(),
  previouslyContacted: z.coerce.boolean().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const analyticsQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d', 'custom']).default('30d'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  pageId: z.string().uuid().optional(),
});

export {
  STARTER_UTILITY_TEMPLATES,
  STARTER_UTILITY_TEMPLATE_COUNT,
  INSTANT_PLAIN_UTILITY_NAME,
  TEMPLATE_QUICK_CHIPS,
  type StarterUtilityTemplate,
} from './starter-catalog.js';

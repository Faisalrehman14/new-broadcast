import { z } from 'zod';

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('CastMe Pro'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (link Railway Postgres)'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars (openssl rand -hex 32)'),
  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_REDIRECT_URI: z.string().default('http://localhost:4000/api/facebook/callback'),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  META_WEBHOOK_VERIFY_TOKEN: z.string().default('change-me-webhook-verify-token'),
  META_PROVIDER: z.enum(['meta', 'mock']).default('mock'),
  BROADCAST_MESSAGES_PER_SECOND: z.coerce.number().positive().default(5),
  BROADCAST_MESSAGES_PER_MINUTE: z.coerce.number().positive().default(200),
  // Higher default so multi-page campaigns send in parallel (per-page RPS gate still applies).
  BROADCAST_CONCURRENT_SENDS: z.coerce.number().int().positive().default(12),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional().default(''),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO_USER_EMAIL: z.string().email().optional(),
  SEED_DEMO_USER_PASSWORD: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4000),
});

const apiSchema = baseSchema.extend({
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
});

/** Worker does not need session cookies — SESSION_SECRET is optional. */
const workerSchema = baseSchema.extend({
  SESSION_SECRET: z.string().min(32).optional().default('worker-unused-session-secret-placeholder!!'),
});

export type AppConfig = z.infer<typeof apiSchema>;

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = apiSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${formatZodError(parsed.error)}. ` +
        `On Railway: add Shared Variables DATABASE_URL (from Postgres), REDIS_URL (from Redis), ` +
        `SESSION_SECRET (openssl rand -hex 32), ENCRYPTION_KEY (openssl rand -hex 32).`
    );
  }
  return parsed.data;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = workerSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid worker environment: ${formatZodError(parsed.error)}. ` +
        `On Railway: share DATABASE_URL, REDIS_URL, and ENCRYPTION_KEY with the worker service.`
    );
  }
  return parsed.data as AppConfig;
}

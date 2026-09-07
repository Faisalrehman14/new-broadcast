import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('CastMe Pro'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_REDIRECT_URI: z.string().default('http://localhost:4000/api/facebook/callback'),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  META_WEBHOOK_VERIFY_TOKEN: z.string().default('change-me-webhook-verify-token'),
  META_PROVIDER: z.enum(['meta', 'mock']).default('mock'),
  BROADCAST_MESSAGES_PER_SECOND: z.coerce.number().positive().default(5),
  BROADCAST_MESSAGES_PER_MINUTE: z.coerce.number().positive().default(200),
  BROADCAST_CONCURRENT_SENDS: z.coerce.number().int().positive().default(3),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional().default(''),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO_USER_EMAIL: z.string().email().optional(),
  SEED_DEMO_USER_PASSWORD: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4000),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  return parsed.data;
}

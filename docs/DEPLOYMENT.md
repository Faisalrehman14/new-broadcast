# Production deployment

## Components

| Service | Role |
|---------|------|
| `web` | Next.js UI |
| `api` | Fastify HTTP API + webhook receiver |
| `worker` | BullMQ consumers (sync, send, approvals) |
| `postgres` | Primary datastore |
| `redis` | Queue / rate-limit coordination |
| Reverse proxy | TLS termination (nginx/Caddy/Traefik) |

## Required secrets

Set strong values (never commit):

- `SESSION_SECRET` (≥32 chars)
- `ENCRYPTION_KEY` (64 hex chars = 32 bytes)
- `META_APP_ID` / `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN`
- `DATABASE_URL` / `REDIS_URL`
- `SENTRY_DSN` (optional)

Generate encryption key:

```bash
openssl rand -hex 32
```

## Meta app setup

1. Create a Meta app with Messenger / Pages permissions as required by current Meta docs.
2. Set OAuth redirect to `https://api.yourdomain.com/api/facebook/callback`
3. Set webhook callback to `https://api.yourdomain.com/api/webhooks/facebook`
4. Use the verify token from `META_WEBHOOK_VERIFY_TOKEN`
5. Set `META_PROVIDER=meta`

CastMe Pro respects Meta messaging windows, template rules, and rate limits. Features that Meta does not support are surfaced as limitations rather than bypassed.

## Migrations

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npx prisma db seed --schema apps/api/prisma/schema.prisma
```

## Scaling

- Scale `api` horizontally behind the proxy (sticky sessions not required; sessions are DB-backed).
- Scale `worker` by replica count; BullMQ distributes jobs.
- Tune `BROADCAST_MESSAGES_PER_SECOND`, `BROADCAST_CONCURRENT_SENDS`, and per-user settings.

## Observability

- Structured JSON logs include `request_id` / job ids
- `api_logs` table stores request metrics
- Wire `SENTRY_DSN` in production for error monitoring

## Security checklist

- [ ] HTTPS only
- [ ] Secure cookies (`NODE_ENV=production`)
- [ ] Webhook signature verification enabled (`META_PROVIDER=meta`)
- [ ] No tokens in frontend storage
- [ ] Admin role restricted
- [ ] Backup Postgres + retention policy configured

# CastMe Pro

Production-ready multi-tenant SaaS for Facebook Page customer messaging and broadcast management.

## Architecture

```
apps/web      → Next.js dashboard (port 3000)
apps/api      → Fastify API (port 4000)
apps/worker   → BullMQ workers (Redis)
packages/*    → shared types, validation, config, Meta provider
PostgreSQL + Redis
```

Meta integrations go through `@pagebroadcast/meta-provider`:
- `META_PROVIDER=mock` — local development only
- `META_PROVIDER=meta` — real Graph API (requires `META_APP_ID` / `META_APP_SECRET`)

Access tokens are encrypted at rest (AES-256-GCM) and never sent to the browser.

## Quick start (local)

```bash
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local

# Postgres + Redis (Docker Compose plugin or plain docker run)
docker compose up -d postgres redis
# OR:
# docker run -d --name pb-postgres -e POSTGRES_USER=pagebroadcast -e POSTGRES_PASSWORD=pagebroadcast -e POSTGRES_DB=pagebroadcast -p 5432:5432 postgres:16-alpine
# docker run -d --name pb-redis -p 6379:6379 redis:7-alpine

npm install
npm run build -w @pagebroadcast/types
npm run build -w @pagebroadcast/config
npm run build -w @pagebroadcast/validation
npm run build -w @pagebroadcast/meta-provider

cd apps/api && npx prisma migrate deploy && npx prisma db seed && cd ../..

# Three processes:
npm run dev:api
npm run dev:worker
npm run dev:web
```

Requires **Node.js 20+** recommended (18 may work with warnings).

Demo login (seeded):

- Email: `demo@pagebroadcast.local`
- Password: `DemoPassword123!`

Admin:

- Email: `admin@pagebroadcast.local`
- Password: `ChangeMeAdmin123!`

## Docker (full stack)

```bash
cp .env.example .env
docker compose up --build
```

## Core flows

1. Register / login  
2. Connect Facebook (OAuth)  
3. Select Pages → background contact sync  
4. Webhooks upsert new customers  
5. Create broadcast → template + variables → approval  
6. Start only when approved → recipient snapshot → queue → rate-limited sends  
7. Analytics, reconnect, support, audit logs  

## Template import (admin)

`POST /api/templates/import` with admin session:

```json
{
  "title": "...",
  "metaName": "pi_lib_22",
  "category": "Library",
  "body": "Hi {{1}}..."
}
```

Templates with `body_status = requires_import` have no invented body text.

## Health

- `GET /health`
- `GET /ready`

## Tests

```bash
npm run test -w @pagebroadcast/validation
npm run test -w @pagebroadcast/api
```

See `docs/DEPLOYMENT.md` for production notes.

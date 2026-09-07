# CastMe Pro — Railway setup

Railway correctly detected **3 services** from the monorepo:

| Service | Role |
|---------|------|
| `@pagebroadcast/web` | Next.js UI |
| `@pagebroadcast/api` | Fastify API + webhooks |
| `@pagebroadcast/worker` | BullMQ background jobs |

Do **not** click **Deploy** until Postgres, Redis, and variables are set (yellow “Settings” warnings).

## 1. Add databases (project canvas)

1. **+ New** → **Database** → **PostgreSQL**
2. **+ New** → **Database** → **Redis**

## 2. Shared variables (Project → Variables)

Set these for **all** services (or share via Railway variable references):

```
NODE_ENV=production
APP_NAME=CastMe Pro
SESSION_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
META_PROVIDER=mock
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=<random string>
META_GRAPH_VERSION=v21.0
LOG_LEVEL=info
```

From the Postgres service, reference:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

From Redis:

```
REDIS_URL=${{Redis.REDIS_URL}}
```

After first deploy, set public URLs (replace with your Railway domains):

```
APP_URL=https://<web-service>.up.railway.app
API_URL=https://<api-service>.up.railway.app
WEB_ORIGIN=https://<web-service>.up.railway.app
META_REDIRECT_URI=https://<api-service>.up.railway.app/api/facebook/callback
NEXT_PUBLIC_API_URL=https://<api-service>.up.railway.app
```

## 3. Per-service settings

**Root Directory** for every service: leave **empty** (repo root) — this is an npm workspaces monorepo.

### web

- **Build:** `npm install && npm run build -w @pagebroadcast/web`
- **Start:** `npm run start -w @pagebroadcast/web`
- Generate domain (public)

### api

- **Build:** `npm install && npm run build -w @pagebroadcast/types && npm run build -w @pagebroadcast/config && npm run build -w @pagebroadcast/validation && npm run build -w @pagebroadcast/meta-provider && npx prisma generate --schema apps/api/prisma/schema.prisma && npm run build -w @pagebroadcast/api`
- **Start:** `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && npm run start -w @pagebroadcast/api`
- Generate domain (public)
- Optional one-time: run seed via Railway shell  
  `npx prisma db seed --schema apps/api/prisma/schema.prisma`

### worker

- Same **Build** as api (needs Prisma client + packages)
- **Start:** `npm run start -w @pagebroadcast/worker`
- No public domain needed

## 4. Apply & Deploy

1. Fix yellow settings on each card  
2. Click **Apply … changes**  
3. Click **Deploy**

## Demo login (after seed)

- `demo@pagebroadcast.local` / `DemoPassword123!`

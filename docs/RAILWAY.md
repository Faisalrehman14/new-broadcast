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

**Root Directory:** leave empty (repo root).

**Config-as-code:** each app has `railway.json` that builds the root `Dockerfile` with the correct target (`api` / `web` / `worker`).

If Railway still shows an old `redis-memory-server` / `make: not found` error, trigger a **clear rebuild** (Redeploy without cache) so it picks up the latest `main` commit.
## 4. Apply & Deploy

1. Fix yellow settings on each card  
2. Click **Apply … changes**  
3. Click **Deploy**

## Demo login (after seed)

- `demo@pagebroadcast.local` / `DemoPassword123!`

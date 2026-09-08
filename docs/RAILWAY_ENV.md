# Railway environment variables (CastMe Pro)

Set these as **Project → Shared Variables** (applied to api, web, and worker).

## Required (copy into Railway)

| Variable | Value |
|----------|--------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (use Railway variable reference to your Postgres service) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` (or `${{Redis.REDIS_PRIVATE_URL}}`) |
| `SESSION_SECRET` | run locally: `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | run locally: `openssl rand -hex 32` (must be **64 hex characters**) |
| `NODE_ENV` | `production` |
| `APP_NAME` | `CastMe Pro` |
| `META_PROVIDER` | `mock` (until Meta credentials are ready) |
| `LOG_LEVEL` | `info` |

## After domains exist

| Variable | Example |
|----------|---------|
| `APP_URL` | `https://your-web.up.railway.app` |
| `API_URL` | `https://your-api.up.railway.app` |
| `WEB_ORIGIN` | `https://your-web.up.railway.app` |
| `NEXT_PUBLIC_API_URL` | `https://your-api.up.railway.app` (web service) |
| `META_REDIRECT_URI` | `https://your-api.up.railway.app/api/facebook/callback` |

## Important

1. Add **PostgreSQL** and **Redis** plugins to the project first.
2. Share variables with **all three** services (api, web, worker).
3. Redeploy after saving variables.
4. Without `DATABASE_URL` / `ENCRYPTION_KEY`, api and worker will crash on boot — that is expected.

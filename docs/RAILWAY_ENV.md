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

## Web blank screen / API connection

On **`@pagebroadcast/web`** Variables, set:

| Variable | Value |
|----------|--------|
| `API_URL` | Public URL of your **api** service, e.g. `https://YOUR-API.up.railway.app` (no trailing slash) |
| `NEXT_PUBLIC_API_URL` | Same as `API_URL` (optional backup) |

On **`@pagebroadcast/api`** Variables, set:

| Variable | Value |
|----------|--------|
| `WEB_ORIGIN` | `https://pagebroadcastweb-production.up.railway.app` |
| `APP_URL` | same as WEB_ORIGIN |
| `API_URL` | your api public URL |
| `META_REDIRECT_URI` | `https://pagebroadcastweb-production.up.railway.app/api/facebook/callback` |

Also open **api → Settings → Networking → Generate Domain** if the API has no public URL yet.

The web app proxies `/api/*` to the API so the browser stays same-origin (avoids blank dashboard).

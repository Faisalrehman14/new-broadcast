# Broadcast Campaigns API

CastMe Pro campaign surface for multi-page Messenger broadcasts with Meta **UTILITY** templates outside the 24-hour window.

Tokens stay on the server. The browser never bulk-sends with page tokens.

## Auth

- Session cookie `pb_session`
- CSRF: cookie `pb_csrf` + header `X-CSRF-Token` (from `GET /api/auth/me` → `csrfToken`)
- Permission: `broadcast.send` (UserSettings.broadcastSend)

## Campaigns

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/broadcast/campaigns` | Create + enqueue worker. 409 if another active. 402 quota. 403 no live token. |
| GET | `/api/broadcast/campaigns` | Recent campaigns |
| GET | `/api/broadcast/campaigns/active` | Active campaign or null |
| GET | `/api/broadcast/campaigns/:id` | Detail + ETA + pages |
| GET | `/api/broadcast/campaigns/:id/failures` | Failure rows |
| POST | `/api/broadcast/campaigns/:id/pause` | |
| POST | `/api/broadcast/campaigns/:id/resume` | |
| POST | `/api/broadcast/campaigns/:id/stop` | |
| POST | `/api/broadcast/campaigns/:id/dismiss` | |

### Create body

```json
{
  "pages": [{ "id": "<pageUuidOrPlatformId>", "name": "Optional" }],
  "message": "Hello…",
  "image_url": "https://…",
  "speed_preset": "safe|fast|turbo",
  "delay_ms": 500,
  "utility_template": { "name": "castme_plain_utility_v1", "body": "{{1}}", "language": "en_US" },
  "delivery_mode": "freeform_plain|named_utility",
  "outside24h_image_mode": false
}
```

### Phases

`queued` → `setting_up_templates` → `syncing_leads` → `sending` → `completed` | `paused` | `stopped` | `failed`

## Outside 24h / templates

| Method | Path |
|--------|------|
| GET | `/api/broadcast/outside24h-status?page_ids=…&template_name=` |
| POST | `/api/broadcast/prepare-outside24h` |
| POST | `/api/broadcast/prepare-starter-pack` |
| POST | `/api/broadcast/prepare-image` |
| POST | `/api/broadcast/prepare-message-card` |

## Audience

| Method | Path |
|--------|------|
| GET | `/api/broadcast/audience/status` |
| POST | `/api/broadcast/audience/sync` |
| GET | `/api/broadcast/audience/sync/status` |
| GET | `/api/broadcast/recipients?page_id=` |

## Quota / ops

| Method | Path |
|--------|------|
| GET | `/api/user/quota` |
| GET | `/api/broadcast/capacity` |
| POST | `/api/broadcast/send-one` |
| GET/POST | `/api/broadcast/templates` |
| GET/POST | `/api/schedules` |

## Worker send rules

1. Ensure UTILITY template on each page
2. Sync conversations → PSIDs if empty/stale
3. Per recipient: UTILITY if ready; else RESPONSE inside 24h; else fail `outside_24h_no_utility`

## Meta requirements

- OAuth scope `pages_utility_messaging` (+ messaging scopes)
- Utility messaging availability varies by region; App Review required for production
- See [META_SETUP.md](./META_SETUP.md)

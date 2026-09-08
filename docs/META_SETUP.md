# Connect real Facebook (Meta) to CastMe Pro

Switch from mock mode to live Meta Graph API.

## 1. Create a Meta app

1. Open [Meta for Developers](https://developers.facebook.com/apps/)
2. **Create App** → type **Business** (or Other → Business)
3. App name: e.g. `CastMe Pro`
4. Add products:
   - **Facebook Login**
   - **Messenger** (for Page messaging / webhooks)

## 2. Facebook Login settings

**Facebook Login → Settings:**

Valid OAuth Redirect URIs (add exactly):

```text
https://pagebroadcastweb-production.up.railway.app/api/facebook/callback
```

(Also keep a local one if you develop locally: `http://localhost:4000/api/facebook/callback`)

**App → Settings → Basic:**

- Copy **App ID** → `META_APP_ID`
- Copy **App Secret** → `META_APP_SECRET`

## 3. Permissions / roles

In **Development** mode you can only log in as:

- App **admins / developers / testers**
- And manage Pages those users administer

Add yourself under **App Roles**.

Permissions requested by CastMe Pro:

- `public_profile`
- `pages_show_list`
- `pages_messaging`
- `pages_manage_metadata`
- `pages_read_engagement`
- `pages_utility_messaging` (outside-24h UTILITY templates)
- `business_management`

For public customers (anyone’s Facebook), Meta **App Review** is required. For your own Page as admin, Development mode is enough.

## 4. Webhooks (optional but recommended)

**Messenger → Settings → Webhooks** (or App → Webhooks):

- Callback URL: `https://pagebroadcastapi-production.up.railway.app/api/webhooks/facebook`  
  (direct API URL — Meta server-to-server; do not use the web proxy for this)
- Verify token: same as Railway `META_WEBHOOK_VERIFY_TOKEN`
- Subscribe to: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`

Then subscribe your Page to the app.

## 5. Railway variables (api + worker; share as needed)

| Variable | Value |
|----------|--------|
| `META_PROVIDER` | `meta` |
| `META_APP_ID` | your App ID |
| `META_APP_SECRET` | your App Secret |
| `META_GRAPH_VERSION` | `v21.0` |
| `META_WEBHOOK_VERIFY_TOKEN` | long random string (same as Meta webhook verify token) |
| `META_REDIRECT_URI` | `https://pagebroadcastweb-production.up.railway.app/api/facebook/callback` (must match Meta Valid OAuth Redirect URIs **exactly**) |
| `APP_URL` | `https://pagebroadcastweb-production.up.railway.app` |
| `WEB_ORIGIN` | `https://pagebroadcastweb-production.up.railway.app` |
| `API_URL` | `https://pagebroadcastapi-production.up.railway.app` |

Redeploy **api** and **worker** after saving.

## 6. Use the app

1. Login to CastMe Pro  
2. Open **Connect** / **Reconnect**  
3. **Connect Facebook** → approve permissions  
4. Select your Page(s) → wait for contact sync  
5. Templates auto-activate for that Page (or open **Templates → Approve all for this Page**)  
6. Create broadcast → **Start** immediately  

## How sending works (Messenger Utility)

CastMe Pro campaigns use Meta **UTILITY** message templates for outside-24h delivery:

1. Connect Facebook with `pages_utility_messaging` granted (tick every Page in the Meta picker)
2. Prepare starter / plain UTILITY templates per Page (`POST /api/broadcast/prepare-starter-pack`)
3. Create a campaign — worker phases: templates → sync leads → send
4. Inside 24h: `RESPONSE` text/image is used when Utility is not required
5. Outside 24h: named UTILITY template or plain `{{1}}` freeform wrapper

Tokens never leave the server. See [BROADCAST_CAMPAIGNS.md](./BROADCAST_CAMPAIGNS.md).

## Important Meta limits

- Messaging must follow Meta policies (24h window + Utility templates).
- Utility messaging may be geo-limited and requires App Review for `pages_utility_messaging`.
- CastMe Pro never bypasses Meta restrictions.
- Rate limits and eligibility are enforced by Meta; failed sends show on the campaign.

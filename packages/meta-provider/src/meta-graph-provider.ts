import { createHmac } from 'node:crypto';
import {
  META_OAUTH_SCOPES,
  resolveMetaOAuthScopes,
  type MetaAuthorizedUser,
  type MetaContact,
  type MetaPageSummary,
  type MetaProvider,
  type MetaProviderConfig,
  type MetaSendResponseInput,
  type MetaSendResult,
  type MetaSendTemplateInput,
  type MetaSendUtilityInput,
  type MetaSubmitTemplateInput,
  type MetaTemplateStatus,
  type MetaUtilityTemplateSummary,
} from './types.js';

/**
 * Production Meta Graph API provider.
 * Uses real HTTP calls to graph.facebook.com — requires valid app credentials.
 */
export class MetaGraphProvider implements MetaProvider {
  constructor(private readonly config: MetaProviderConfig) {}

  private base(): string {
    return `https://graph.facebook.com/${this.config.graphVersion}`;
  }

  /** Required when Meta Advanced → "Require App Secret" is on. */
  private appSecretProof(accessToken: string): string | null {
    if (!this.config.appSecret || !accessToken) return null;
    return createHmac('sha256', this.config.appSecret).update(accessToken).digest('hex');
  }

  private withProof(params: URLSearchParams, accessToken: string) {
    const proof = this.appSecretProof(accessToken);
    if (proof) params.set('appsecret_proof', proof);
    return params;
  }

  /** Login dialog version can be newer than Graph calls (reference uses v25). */
  private oauthDialogVersion(): string {
    const fromEnv = String(process.env.META_OAUTH_DIALOG_VERSION || '').trim();
    const raw = fromEnv || 'v25.0';
    return raw.startsWith('v') ? raw : `v${raw}`;
  }

  getOAuthUrl(state: string, redirectUri: string, options?: { rerequest?: boolean }): string {
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: redirectUri,
      state,
      scope: resolveMetaOAuthScopes().join(','),
      response_type: 'code',
      display: 'page',
    });
    // Reconnect / missing Utility Messaging — force Meta permission dialog again.
    if (options?.rerequest !== false) {
      params.set('auth_type', 'rerequest');
    }
    // Classic Facebook Login (scopes). Do NOT pass config_id — that forces Login for Business
    // and often ends on /dialog/oauth/business/cancel with empty selected_business_id.
    return `https://www.facebook.com/${this.oauthDialogVersion()}/dialog/oauth?${params}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const res = await fetch(`${this.base()}/oauth/access_token?${params}`);
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Meta token exchange failed: ${res.status} ${raw}`);
    }
    let data: { access_token?: string; expires_in?: number; token_type?: string; error?: unknown };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      throw new Error(`Meta token exchange failed: invalid JSON ${raw.slice(0, 200)}`);
    }
    if (!data.access_token || data.error) {
      throw new Error(`Meta token exchange failed: ${raw.slice(0, 400)}`);
    }

    // Prefer long-lived (~60d). If exchange fails (bad secret, Graph glitch), keep short-lived
    // so reconnect still succeeds — caller should persist expires_in accurately.
    try {
      const longLived = await this.exchangeLongLivedUserToken(data.access_token);
      return {
        accessToken: longLived.accessToken,
        expiresIn: longLived.expiresIn ?? data.expires_in ?? 60 * 24 * 60 * 60,
        tokenType: data.token_type,
        longLived: true as const,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface for server logs; do not block OAuth completion.
      console.error('[meta] long-lived token exchange failed; storing short-lived token', msg);
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in ?? 3600,
        tokenType: data.token_type,
        longLived: false as const,
      };
    }
  }

  async exchangeLongLivedUserToken(shortLivedToken: string) {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: shortLivedToken,
    });
    const res = await fetch(`${this.base()}/oauth/access_token?${params}`);
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Meta long-lived token exchange failed: ${res.status} ${raw}`);
    }
    let data: { access_token?: string; expires_in?: number; error?: unknown };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      throw new Error(`Meta long-lived token exchange failed: invalid JSON ${raw.slice(0, 200)}`);
    }
    if (!data.access_token || data.error) {
      throw new Error(`Meta long-lived token exchange failed: ${raw.slice(0, 400)}`);
    }
    return { accessToken: data.access_token, expiresIn: data.expires_in };
  }

  async getAuthorizedUser(userAccessToken: string): Promise<MetaAuthorizedUser> {
    // Prefer /me; fall back to debug_token (works even when public_profile is missing).
    const attempts = ['id,name', 'id'] as const;
    let lastErr = '';
    for (const useProof of [true, false]) {
      for (const fields of attempts) {
        const params = new URLSearchParams({
          fields,
          access_token: userAccessToken,
        });
        if (useProof) this.withProof(params, userAccessToken);
        const res = await fetch(`${this.base()}/me?${params}`);
        const raw = await res.text();
        if (res.ok) {
          try {
            const data = JSON.parse(raw) as {
              id?: string;
              name?: string;
              email?: string;
              error?: unknown;
            };
            if (data.id && !data.error) {
              return { id: String(data.id), name: data.name || 'Facebook User', email: data.email };
            }
            lastErr = raw.slice(0, 400);
          } catch {
            lastErr = raw.slice(0, 200);
          }
        } else {
          lastErr = `${res.status} ${raw.slice(0, 400)}`;
        }
      }
    }

    const debugged = await this.debugUserToken(userAccessToken);
    if (debugged?.userId) {
      return { id: debugged.userId, name: 'Facebook User' };
    }

    throw new Error(`Meta getAuthorizedUser failed: ${lastErr || 'unknown'}`);
  }

  /** App-scoped user id from debug_token — does not need public_profile. */
  async debugUserToken(userAccessToken: string): Promise<{ userId: string; scopes: string[] } | null> {
    if (!this.config.appId || !this.config.appSecret) return null;
    const appToken = `${this.config.appId}|${this.config.appSecret}`;
    const params = new URLSearchParams({
      input_token: userAccessToken,
      access_token: appToken,
    });
    const res = await fetch(`${this.base()}/debug_token?${params}`);
    const raw = await res.text();
    if (!res.ok) return null;
    try {
      const parsed = JSON.parse(raw) as {
        data?: {
          is_valid?: boolean;
          user_id?: string | number;
          scopes?: string[];
        };
      };
      const userId = parsed.data?.user_id;
      // Accept user_id even when is_valid is momentarily false after long-lived exchange.
      if (userId == null) return null;
      return {
        userId: String(userId),
        scopes: parsed.data?.scopes || [],
      };
    } catch {
      return null;
    }
  }

  async getPages(userAccessToken: string): Promise<MetaPageSummary[]> {
    const fieldSets = [
      'id,name,access_token,category,tasks,picture{url}',
      'id,name,access_token,category,tasks',
      'id,name,access_token',
    ] as const;

    let lastErr = 'unknown';
    for (const useProof of [true, false]) {
      for (const fields of fieldSets) {
        const collected: MetaPageSummary[] = [];
        let nextUrl: string | null =
          `${this.base()}/me/accounts?` +
          (() => {
            const params = new URLSearchParams({
              fields,
              access_token: userAccessToken,
              limit: '100',
            });
            if (useProof) this.withProof(params, userAccessToken);
            return params.toString();
          })();
        let pageGuard = 0;
        let okOnce = false;
        while (nextUrl && pageGuard < 20) {
          pageGuard += 1;
          const res = await fetch(nextUrl);
          const raw = await res.text();
          if (!res.ok) {
            lastErr = `${res.status} ${raw.slice(0, 300)}`;
            okOnce = false;
            break;
          }
          try {
            const data = JSON.parse(raw) as {
              data?: Array<{
                id: string;
                name: string;
                access_token?: string;
                category?: string;
                tasks?: string[];
                picture?: { data?: { url?: string } };
              }>;
              paging?: { next?: string };
              error?: unknown;
            };
            if (data.error) {
              lastErr = raw.slice(0, 300);
              okOnce = false;
              break;
            }
            okOnce = true;
            for (const p of data.data ?? []) {
              if (!p.id || !p.access_token) continue;
              collected.push({
                id: p.id,
                name: p.name || p.id,
                accessToken: p.access_token,
                category: p.category,
                tasks: p.tasks,
                pictureUrl: p.picture?.data?.url,
              });
            }
            nextUrl = data.paging?.next || null;
          } catch {
            lastErr = raw.slice(0, 200);
            okOnce = false;
            break;
          }
        }
        if (okOnce) return collected;
      }
    }
    throw new Error(`Meta getPages failed: ${lastErr}`);
  }

  async remintPageTokensFromUserToken(userAccessToken: string): Promise<MetaPageSummary[]> {
    return this.getPages(userAccessToken);
  }

  async getPageInfo(pageId: string, pageAccessToken: string): Promise<MetaPageSummary> {
    const params = new URLSearchParams({
      fields: 'id,name,access_token,category,picture{url}',
      access_token: pageAccessToken,
    });
    const res = await fetch(`${this.base()}/${pageId}?${params}`);
    if (!res.ok) throw new Error(`Meta getPageInfo failed: ${res.status}`);
    const p = (await res.json()) as {
      id: string;
      name: string;
      access_token?: string;
      category?: string;
      picture?: { data?: { url?: string } };
    };
    return {
      id: p.id,
      name: p.name,
      accessToken: p.access_token ?? pageAccessToken,
      category: p.category,
      pictureUrl: p.picture?.data?.url,
    };
  }

  async subscribeWebhooks(pageId: string, pageAccessToken: string): Promise<void> {
    const res = await fetch(`${this.base()}/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: pageAccessToken,
        subscribed_fields: [
          'messages',
          'messaging_postbacks',
          'message_deliveries',
          'message_reads',
          'message_template_status_update',
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta webhook subscribe failed: ${res.status} ${text}`);
    }
  }

  async fetchContacts(params: {
    pageId: string;
    pageAccessToken: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ contacts: MetaContact[]; nextCursor?: string; hasMore: boolean }> {
    const qs = new URLSearchParams({
      fields: 'participants,updated_time,id',
      access_token: params.pageAccessToken,
      limit: String(params.limit ?? 50),
    });
    if (params.cursor) qs.set('after', params.cursor);
    const res = await fetch(`${this.base()}/${params.pageId}/conversations?${qs}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta fetchContacts failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        updated_time?: string;
        participants?: { data?: Array<{ id: string; name?: string }> };
      }>;
      paging?: { cursors?: { after?: string }; next?: string };
    };

    const contacts: MetaContact[] = [];
    for (const conv of data.data ?? []) {
      for (const participant of conv.participants?.data ?? []) {
        if (participant.id === params.pageId) continue;
        contacts.push({
          platformUserId: participant.id,
          name: participant.name,
          lastInteractionAt: conv.updated_time,
        });
      }
    }

    const nextCursor = data.paging?.cursors?.after;
    return {
      contacts,
      nextCursor,
      hasMore: Boolean(data.paging?.next && nextCursor),
    };
  }

  async sendTemplateMessage(input: MetaSendTemplateInput): Promise<MetaSendResult> {
    if (input.messagingType === 'UTILITY') {
      return this.sendUtilityMessage({
        pageId: input.pageId,
        pageAccessToken: input.pageAccessToken,
        recipientPsid: input.recipientPsid,
        templateName: input.templateName,
        languageCode: input.languageCode,
        bodyParameters: input.bodyParameters,
        idempotencyKey: input.idempotencyKey,
      });
    }

    const text = buildMessengerText(input).slice(0, 2000);
    if (!text.trim()) throw new Error('Meta send failed: empty message text');

    const { messagingType, tag } = resolveMessagingPolicy(input);
    const payload: Record<string, unknown> = {
      recipient: { id: input.recipientPsid },
      messaging_type: messagingType,
      message: { text },
    };
    if (messagingType === 'MESSAGE_TAG') {
      payload.tag = tag ?? 'ACCOUNT_UPDATE';
    }

    return this.postMessage(input.pageId, input.pageAccessToken, payload, input.idempotencyKey);
  }

  async sendUtilityMessage(input: MetaSendUtilityInput): Promise<MetaSendResult> {
    const components = input.bodyParameters.length
      ? [
          {
            type: 'body',
            parameters: input.bodyParameters.map((text) => ({
              type: 'text',
              text: String(text).slice(0, 1000),
            })),
          },
        ]
      : [];
    // Meta may store the template as `en` or `en_US` — try both (reference campaign engine).
    // IMPORTANT: Do NOT abort on bare "OAuthException" — Meta puts that type on almost every
    // Graph error (including outside-window / wrong language), which previously skipped lang fallbacks.
    const langs = Array.from(
      new Set([input.languageCode || 'en_US', 'en_US', 'en'].filter(Boolean).map(String))
    );
    let lastErr: unknown;
    for (const lang of langs) {
      const message = {
        template: {
          name: input.templateName,
          language: { code: lang },
          components,
        },
      };
      for (const mode of ['omit_product', 'facebook'] as const) {
        try {
          return await this.postMessageForm(
            input.pageId,
            input.pageAccessToken,
            input.recipientPsid,
            message,
            'UTILITY',
            `${input.idempotencyKey}:${lang}:${mode}`,
            undefined,
            mode === 'facebook' ? 'facebook' : undefined
          );
        } catch (err) {
          lastErr = err;
          const text = err instanceof Error ? err.message : String(err);
          if (
            /"code"\s*:\s*190\b|\(#190\)|session has expired|error validating access token/i.test(
              text
            )
          ) {
            throw err;
          }
          if (/"code"\s*:\s*(4|17|32|613)\b|rate limit|code.: ?(4|17)\b/i.test(text)) {
            throw err;
          }
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'UTILITY send failed'));
  }

  async sendResponseMessage(input: MetaSendResponseInput): Promise<MetaSendResult> {
    const message: Record<string, unknown> = {};
    if (input.attachmentId) {
      message.attachment = {
        type: 'image',
        payload: { attachment_id: input.attachmentId },
      };
    } else if (input.imageUrl) {
      message.attachment = {
        type: 'image',
        payload: { url: input.imageUrl, is_reusable: true },
      };
    } else if (input.text?.trim()) {
      message.text = input.text.trim().slice(0, 2000);
    } else {
      throw new Error('Meta send failed: empty RESPONSE payload');
    }

    const payload = {
      recipient: { id: input.recipientPsid },
      messaging_type: 'RESPONSE',
      message,
    };
    return this.postMessage(input.pageId, input.pageAccessToken, payload, input.idempotencyKey);
  }

  /**
   * Poll Page message_templates until APPROVED/REJECTED or retries exhausted.
   * Ported from fb-page-manager waitForApproved.
   */
  async waitForUtilityTemplateApproved(params: {
    pageId: string;
    pageAccessToken: string;
    templateName: string;
    retries?: number;
    intervalMs?: number;
  }): Promise<MetaTemplateStatus> {
    const retries = params.retries ?? 15;
    const intervalMs = params.intervalMs ?? 4000;
    let last: MetaTemplateStatus = {
      externalTemplateId: `utility_${params.templateName}`,
      status: 'PENDING',
      name: params.templateName,
    };
    for (let i = 0; i <= retries; i++) {
      if (i > 0 && intervalMs) await new Promise((r) => setTimeout(r, intervalMs));
      const list = await this.listMessageTemplates({
        pageId: params.pageId,
        pageAccessToken: params.pageAccessToken,
        name: params.templateName,
      });
      const hit =
        list.find((t) => t.name === params.templateName) ||
        list.find((t) => t.name.toLowerCase() === params.templateName.toLowerCase());
      if (hit) {
        last = {
          externalTemplateId: hit.id || last.externalTemplateId,
          status: hit.status,
          name: hit.name,
        };
        if (hit.status === 'APPROVED' || hit.status === 'REJECTED') return last;
      }
    }
    return last;
  }

  async submitTemplate(input: MetaSubmitTemplateInput): Promise<{ externalTemplateId: string }> {
    const created = await this.createUtilityTemplate(input);
    return { externalTemplateId: created.externalTemplateId };
  }

  async createUtilityTemplate(
    input: MetaSubmitTemplateInput
  ): Promise<{ externalTemplateId: string; status: MetaTemplateStatus['status'] }> {
    const example =
      input.exampleValues && input.exampleValues.length
        ? input.exampleValues
        : ['Example Customer'];
    const res = await fetch(`${this.base()}/${input.pageId}/message_templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: input.pageAccessToken,
        name: input.name,
        category: input.category || 'UTILITY',
        language: input.language || 'en_US',
        components: [
          {
            type: 'BODY',
            text: input.body,
            example: { body_text: [example] },
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      // Idempotent: template already exists on this Page — reuse it.
      if (
        /2018423|already exists|Message Template With Provided Name Already Exists/i.test(text)
      ) {
        const existing = await this.listMessageTemplates({
          pageId: input.pageId,
          pageAccessToken: input.pageAccessToken,
          name: input.name,
        });
        const hit =
          existing.find((t) => t.name === input.name) ||
          existing.find((t) => t.name.toLowerCase() === input.name.toLowerCase()) ||
          existing[0];
        if (hit) {
          const status = hit.status === 'UNKNOWN' ? 'PENDING' : hit.status;
          return {
            externalTemplateId: hit.id || `utility_${input.name}`,
            status,
          };
        }
        // Exists but unlistable — wait path must re-check; do NOT fake APPROVED.
        return {
          externalTemplateId: `utility_existing_${input.name}`,
          status: 'PENDING',
        };
      }
      throw new Error(`Meta createUtilityTemplate failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { id?: string; status?: string };
    const raw = (data.status ?? 'PENDING').toUpperCase();
    return {
      externalTemplateId: data.id ?? `utility_${input.name}`,
      status: mapStatus(raw),
    };
  }

  async listMessageTemplates(params: {
    pageId: string;
    pageAccessToken: string;
    name?: string;
  }): Promise<MetaUtilityTemplateSummary[]> {
    const out: MetaUtilityTemplateSummary[] = [];
    let after: string | undefined;
    // Name-filtered lookups are usually one page; full sync may need cursors.
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({
        access_token: params.pageAccessToken,
        fields: 'name,status,language,category,id',
        limit: params.name ? '25' : '100',
      });
      if (params.name) qs.set('name', params.name);
      if (after) qs.set('after', after);
      const res = await fetch(`${this.base()}/${params.pageId}/message_templates?${qs}`);
      if (!res.ok) break;
      const data = (await res.json()) as {
        data?: Array<{
          id?: string;
          name: string;
          status?: string;
          language?: string;
          category?: string;
        }>;
        paging?: { cursors?: { after?: string }; next?: string };
      };
      for (const t of data.data ?? []) {
        out.push({
          id: t.id,
          name: t.name,
          status: mapStatus((t.status ?? 'UNKNOWN').toUpperCase()),
          language: t.language || 'en_US',
          category: t.category,
        });
      }
      after = data.paging?.cursors?.after;
      if (!after || !data.paging?.next || params.name) break;
    }
    return out;
  }

  async getTemplateStatus(params: {
    pageId: string;
    pageAccessToken: string;
    externalTemplateId: string;
    templateName?: string;
  }): Promise<MetaTemplateStatus> {
    if (params.templateName) {
      const list = await this.listMessageTemplates({
        pageId: params.pageId,
        pageAccessToken: params.pageAccessToken,
        name: params.templateName,
      });
      const hit = list.find((t) => t.name === params.templateName) || list[0];
      if (hit) {
        return {
          externalTemplateId: hit.id || params.externalTemplateId,
          status: hit.status,
          name: hit.name,
        };
      }
    }
    const res = await fetch(
      `${this.base()}/${params.externalTemplateId}?access_token=${encodeURIComponent(params.pageAccessToken)}&fields=status,rejected_reason,name`
    );
    if (!res.ok) {
      return { externalTemplateId: params.externalTemplateId, status: 'PENDING' };
    }
    const data = (await res.json()) as {
      status?: string;
      rejected_reason?: string;
      name?: string;
    };
    return {
      externalTemplateId: params.externalTemplateId,
      status: mapStatus((data.status ?? 'PENDING').toUpperCase()),
      rejectionReason: data.rejected_reason,
      name: data.name,
    };
  }

  async uploadMessageAttachment(params: {
    pageId: string;
    pageAccessToken: string;
    imageUrl: string;
  }): Promise<{ attachmentId: string }> {
    const res = await fetch(`${this.base()}/${params.pageId}/message_attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: params.pageAccessToken,
        message: {
          attachment: {
            type: 'image',
            payload: { url: params.imageUrl, is_reusable: true },
          },
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta uploadMessageAttachment failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { attachment_id: string };
    return { attachmentId: data.attachment_id };
  }

  private async postMessage(
    pageId: string,
    pageAccessToken: string,
    payload: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<MetaSendResult> {
    const res = await fetch(`${this.base()}/${pageId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pageAccessToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw buildMetaSendError(res.status, await res.text());
    }
    const data = (await res.json()) as { message_id: string; recipient_id: string };
    return { messageId: data.message_id, recipientId: data.recipient_id };
  }

  /** Form-urlencoded send — same transport as working Messenger broadcast tools. */
  private async postMessageForm(
    pageId: string,
    pageAccessToken: string,
    recipientPsid: string,
    message: Record<string, unknown>,
    messagingType: 'UTILITY' | 'RESPONSE' | 'MESSAGE_TAG',
    idempotencyKey: string,
    tag?: string,
    messagingProduct?: 'facebook' | 'instagram'
  ): Promise<MetaSendResult> {
    // Business Suite / inbox ids sometimes prefix with t_
    const recipientId = String(recipientPsid || '')
      .trim()
      .replace(/^t_/, '');
    const form = new URLSearchParams();
    form.append('recipient', JSON.stringify({ id: recipientId }));
    form.append('message', JSON.stringify(message));
    form.append('messaging_type', messagingType);
    form.append('access_token', pageAccessToken);
    if (tag) form.append('tag', tag);
    if (messagingProduct) form.append('messaging_product', messagingProduct);

    const res = await fetch(`${this.base()}/${pageId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: form.toString(),
    });
    if (!res.ok) {
      throw buildMetaSendError(res.status, await res.text());
    }
    const data = (await res.json()) as { message_id?: string; recipient_id?: string; error?: unknown };
    if (data.error) {
      throw buildMetaSendError(400, JSON.stringify({ error: data.error }));
    }
    return {
      messageId: data.message_id || idempotencyKey,
      recipientId: data.recipient_id || recipientId,
    };
  }
}

function buildMetaSendError(status: number, errText: string): Error {
  let code: number | undefined;
  let subcode: number | undefined;
  try {
    const jsonStart = errText.indexOf('{');
    if (jsonStart >= 0) {
      const parsed = JSON.parse(errText.slice(jsonStart)) as {
        error?: { code?: number; error_subcode?: number; message?: string };
      };
      code = parsed.error?.code;
      subcode = parsed.error?.error_subcode;
    }
  } catch {
    /* keep raw */
  }
  const err = new Error(`Meta send failed: ${status} ${errText}`) as Error & {
    status?: number;
    retryable?: boolean;
    code?: number;
    subcode?: number;
  };
  err.status = status;
  err.code = code;
  err.subcode = subcode;
  err.retryable =
    status === 429 ||
    status >= 500 ||
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 ||
    code === 80001 ||
    code === 80006 ||
    /rate limit/i.test(errText);
  return err;
}

const MS_24H = 24 * 60 * 60 * 1000;

function buildMessengerText(input: MetaSendTemplateInput): string {
  if (input.text?.trim()) return input.text.trim();
  const bodyParams = input.bodyParameters.filter((p) => p != null && String(p).length > 0);
  if (bodyParams.length) return bodyParams.join('\n');
  return '';
}

function resolveMessagingPolicy(input: MetaSendTemplateInput): {
  messagingType: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
  tag?: MetaSendTemplateInput['tag'];
} {
  if (input.messagingType && input.messagingType !== 'UTILITY') {
    return { messagingType: input.messagingType, tag: input.tag };
  }
  const last = input.lastInteractionAt ? new Date(input.lastInteractionAt).getTime() : NaN;
  const within24h = Number.isFinite(last) && Date.now() - last <= MS_24H;
  if (within24h) return { messagingType: 'RESPONSE' };
  return { messagingType: 'MESSAGE_TAG', tag: input.tag ?? 'ACCOUNT_UPDATE' };
}

function mapStatus(raw: string): MetaTemplateStatus['status'] {
  const statusMap: Record<string, MetaTemplateStatus['status']> = {
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    PAUSED: 'PAUSED',
    DISABLED: 'DISABLED',
  };
  return statusMap[raw] ?? 'UNKNOWN';
}

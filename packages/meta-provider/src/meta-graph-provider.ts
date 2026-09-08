import {
  META_OAUTH_SCOPES,
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

  getOAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: redirectUri,
      state,
      scope: META_OAUTH_SCOPES.join(','),
      response_type: 'code',
    });
    return `https://www.facebook.com/${this.config.graphVersion}/dialog/oauth?${params}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const res = await fetch(`${this.base()}/oauth/access_token?${params}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta token exchange failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
      token_type?: string;
    };
    const short = {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
    };
    try {
      const longLived = await this.exchangeLongLivedUserToken(short.accessToken);
      return {
        accessToken: longLived.accessToken,
        expiresIn: longLived.expiresIn ?? short.expiresIn,
        tokenType: short.tokenType,
      };
    } catch {
      return short;
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
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta long-lived token exchange failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    return { accessToken: data.access_token, expiresIn: data.expires_in };
  }

  async getAuthorizedUser(userAccessToken: string): Promise<MetaAuthorizedUser> {
    const params = new URLSearchParams({
      fields: 'id,name,email',
      access_token: userAccessToken,
    });
    const res = await fetch(`${this.base()}/me?${params}`);
    if (!res.ok) throw new Error(`Meta getAuthorizedUser failed: ${res.status}`);
    const data = (await res.json()) as { id: string; name: string; email?: string };
    return { id: data.id, name: data.name, email: data.email };
  }

  async getPages(userAccessToken: string): Promise<MetaPageSummary[]> {
    const params = new URLSearchParams({
      fields: 'id,name,access_token,category,tasks,picture{url}',
      access_token: userAccessToken,
      limit: '100',
    });
    const res = await fetch(`${this.base()}/me/accounts?${params}`);
    if (!res.ok) throw new Error(`Meta getPages failed: ${res.status}`);
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token: string;
        category?: string;
        tasks?: string[];
        picture?: { data?: { url?: string } };
      }>;
    };
    return (data.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      accessToken: p.access_token,
      category: p.category,
      tasks: p.tasks,
      pictureUrl: p.picture?.data?.url,
    }));
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
    const payload = {
      recipient: { id: input.recipientPsid },
      messaging_type: 'UTILITY',
      message: {
        template: {
          name: input.templateName,
          language: { code: input.languageCode || 'en_US' },
          components: input.bodyParameters.length
            ? [
                {
                  type: 'body',
                  parameters: input.bodyParameters.map((text) => ({ type: 'text', text })),
                },
              ]
            : [],
        },
      },
    };
    return this.postMessage(input.pageId, input.pageAccessToken, payload, input.idempotencyKey);
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
    const qs = new URLSearchParams({
      access_token: params.pageAccessToken,
      fields: 'name,status,language,category,id',
    });
    if (params.name) qs.set('name', params.name);
    const res = await fetch(`${this.base()}/${params.pageId}/message_templates?${qs}`);
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as {
      data?: Array<{
        id?: string;
        name: string;
        status?: string;
        language?: string;
        category?: string;
      }>;
    };
    return (data.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      status: mapStatus((t.status ?? 'UNKNOWN').toUpperCase()),
      language: t.language || 'en_US',
      category: t.category,
    }));
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
      const errText = await res.text();
      const err = new Error(`Meta send failed: ${res.status} ${errText}`) as Error & {
        status?: number;
        retryable?: boolean;
      };
      err.status = res.status;
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    }
    const data = (await res.json()) as { message_id: string; recipient_id: string };
    return { messageId: data.message_id, recipientId: data.recipient_id };
  }
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

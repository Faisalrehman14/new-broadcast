import type {
  MetaAuthorizedUser,
  MetaContact,
  MetaPageSummary,
  MetaProvider,
  MetaProviderConfig,
  MetaSendResult,
  MetaSendTemplateInput,
  MetaSubmitTemplateInput,
  MetaTemplateStatus,
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
      scope: [
        'pages_show_list',
        'pages_messaging',
        'pages_manage_metadata',
        'pages_read_engagement',
        'business_management',
      ].join(','),
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
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
    };
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
        subscribed_fields: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads'],
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
    // Uses Page Conversations API (Messenger). Subject to Meta platform rules & permissions.
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
    // Messenger Send API with message tag / template payload as supported by current Graph API.
    // Note: WhatsApp-style named HSM templates differ from Messenger; we send structured text
    // derived from approved templates where Messenger policy allows (24h window / tags).
    const bodyParams = input.bodyParameters;
    const res = await fetch(`${this.base()}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.pageAccessToken}`,
        'X-Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        recipient: { id: input.recipientPsid },
        messaging_type: 'MESSAGE_TAG',
        tag: 'ACCOUNT_UPDATE',
        message: {
          text: bodyParams.length
            ? `[${input.templateName}] ${bodyParams.join(' | ')}`
            : `[${input.templateName}]`,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Meta send failed: ${res.status} ${text}`) as Error & {
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

  async submitTemplate(input: MetaSubmitTemplateInput): Promise<{ externalTemplateId: string }> {
    // Template submission for Messenger is limited vs WhatsApp Business.
    // We record a submission reference; production WhatsApp WABA apps should override this.
    const externalTemplateId = `msg_tpl_${input.name}_${Date.now()}`;
    // Attempt Graph message_templates if available on the page's WABA linkage
    const res = await fetch(`${this.base()}/${input.pageId}/message_templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: input.pageAccessToken,
        name: input.name,
        category: input.category,
        language: input.language,
        components: [
          {
            type: 'BODY',
            text: input.body,
            example: input.exampleValues
              ? { body_text: [input.exampleValues] }
              : undefined,
          },
        ],
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      return { externalTemplateId: data.id ?? externalTemplateId };
    }
    // If endpoint unsupported for this Page type, return local tracking id —
    // status polling will surface UNKNOWN / platform limitation clearly.
    return { externalTemplateId };
  }

  async getTemplateStatus(params: {
    pageId: string;
    pageAccessToken: string;
    externalTemplateId: string;
    templateName?: string;
  }): Promise<MetaTemplateStatus> {
    const res = await fetch(
      `${this.base()}/${params.externalTemplateId}?access_token=${encodeURIComponent(params.pageAccessToken)}&fields=status,rejected_reason,name`
    );
    if (!res.ok) {
      return { externalTemplateId: params.externalTemplateId, status: 'UNKNOWN' };
    }
    const data = (await res.json()) as {
      status?: string;
      rejected_reason?: string;
    };
    const raw = (data.status ?? 'UNKNOWN').toUpperCase();
    const statusMap: Record<string, MetaTemplateStatus['status']> = {
      PENDING: 'PENDING',
      APPROVED: 'APPROVED',
      REJECTED: 'REJECTED',
      PAUSED: 'PAUSED',
      DISABLED: 'DISABLED',
    };
    return {
      externalTemplateId: params.externalTemplateId,
      status: statusMap[raw] ?? 'UNKNOWN',
      rejectionReason: data.rejected_reason,
    };
  }
}

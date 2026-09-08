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
    // Messenger Page Send API (same model as tools like MyAimMyDream):
    // plain text via /me/messages — NOT WhatsApp HSM named templates.
    // Within 24h window → UPDATE; outside → MESSAGE_TAG for non-promotional updates.
    const text = buildMessengerText(input).slice(0, 2000);
    if (!text.trim()) {
      throw new Error('Meta send failed: empty message text');
    }

    const { messagingType, tag } = resolveMessagingPolicy(input);
    const payload: Record<string, unknown> = {
      recipient: { id: input.recipientPsid },
      messaging_type: messagingType,
      message: { text },
    };
    if (messagingType === 'MESSAGE_TAG') {
      payload.tag = tag ?? 'ACCOUNT_UPDATE';
    }

    const res = await fetch(`${this.base()}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.pageAccessToken}`,
        'X-Idempotency-Key': input.idempotencyKey,
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

  async submitTemplate(input: MetaSubmitTemplateInput): Promise<{ externalTemplateId: string }> {
    // Facebook Messenger Pages do not use WhatsApp-style message_templates approval.
    // Library templates are activated locally as Messenger-compliant send payloads.
    // Keep a stable external id for audit / optional WABA apps that override this provider.
    return { externalTemplateId: `messenger_lib_${input.name}` };
  }

  async getTemplateStatus(params: {
    pageId: string;
    pageAccessToken: string;
    externalTemplateId: string;
    templateName?: string;
  }): Promise<MetaTemplateStatus> {
    // Messenger library activations are approved immediately (no Graph poll).
    if (params.externalTemplateId.startsWith('messenger_lib_') || params.externalTemplateId.startsWith('msg_tpl_')) {
      return { externalTemplateId: params.externalTemplateId, status: 'APPROVED' };
    }
    const res = await fetch(
      `${this.base()}/${params.externalTemplateId}?access_token=${encodeURIComponent(params.pageAccessToken)}&fields=status,rejected_reason,name`
    );
    if (!res.ok) {
      return { externalTemplateId: params.externalTemplateId, status: 'APPROVED' };
    }
    const data = (await res.json()) as {
      status?: string;
      rejected_reason?: string;
    };
    const raw = (data.status ?? 'APPROVED').toUpperCase();
    const statusMap: Record<string, MetaTemplateStatus['status']> = {
      PENDING: 'PENDING',
      APPROVED: 'APPROVED',
      REJECTED: 'REJECTED',
      PAUSED: 'PAUSED',
      DISABLED: 'DISABLED',
    };
    return {
      externalTemplateId: params.externalTemplateId,
      status: statusMap[raw] ?? 'APPROVED',
      rejectionReason: data.rejected_reason,
    };
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
  if (input.messagingType) {
    return { messagingType: input.messagingType, tag: input.tag };
  }
  const last = input.lastInteractionAt ? new Date(input.lastInteractionAt).getTime() : NaN;
  const within24h = Number.isFinite(last) && Date.now() - last <= MS_24H;
  if (within24h) {
    // Proactive page broadcast inside the standard messaging window.
    return { messagingType: 'UPDATE' };
  }
  return { messagingType: 'MESSAGE_TAG', tag: input.tag ?? 'ACCOUNT_UPDATE' };
}

import { createHmac, randomUUID } from 'node:crypto';
import type {
  MetaAuthorizedUser,
  MetaContact,
  MetaPageSummary,
  MetaProvider,
  MetaProviderConfig,
  MetaSendResponseInput,
  MetaSendResult,
  MetaSendTemplateInput,
  MetaSendUtilityInput,
  MetaSubmitTemplateInput,
  MetaTemplateStatus,
  MetaUtilityTemplateSummary,
} from './types.js';

/**
 * Local-development ONLY mock provider.
 * Never used when META_PROVIDER=meta.
 */
export class MockMetaProvider implements MetaProvider {
  private readonly store = new Map<
    string,
    { status: MetaTemplateStatus['status']; rejectionReason?: string; submittedAt: number; name: string }
  >();

  constructor(private readonly config: Partial<MetaProviderConfig> = {}) {}

  getOAuthUrl(state: string, redirectUri: string, _options?: { rerequest?: boolean }): string {
    const base = this.config.redirectUri?.replace('/api/facebook/callback', '') ?? 'http://localhost:4000';
    const params = new URLSearchParams({
      code: `mock_code_${randomUUID()}`,
      state,
    });
    return `${base}/api/facebook/mock-authorize?${params}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  async exchangeCodeForToken(_code: string) {
    return {
      accessToken: `mock_long_lived_user_token_${randomUUID()}`,
      expiresIn: 60 * 24 * 60 * 60,
      tokenType: 'bearer',
    };
  }

  async exchangeLongLivedUserToken(shortLivedToken: string) {
    return { accessToken: `ll_${shortLivedToken}`, expiresIn: 60 * 60 * 24 * 60 };
  }

  async getAuthorizedUser(_userAccessToken: string): Promise<MetaAuthorizedUser> {
    return {
      id: 'mock_fb_user_1001',
      name: 'Demo Facebook User',
      email: 'demo.fb@pagebroadcast.local',
    };
  }

  async getPages(_userAccessToken: string): Promise<MetaPageSummary[]> {
    return [
      {
        id: 'mock_page_abc',
        name: 'ABC Store',
        accessToken: 'mock_page_token_abc',
        pictureUrl: 'https://ui-avatars.com/api/?name=ABC+Store&background=2563EB&color=fff',
        category: 'Shopping/Retail',
        tasks: ['MANAGE', 'MESSAGING'],
      },
      {
        id: 'mock_page_cafe',
        name: 'Sunrise Café',
        accessToken: 'mock_page_token_cafe',
        pictureUrl: 'https://ui-avatars.com/api/?name=Sunrise+Cafe&background=0F172A&color=fff',
        category: 'Restaurant',
        tasks: ['MANAGE', 'MESSAGING'],
      },
      {
        id: 'mock_page_fit',
        name: 'FitLife Gym',
        accessToken: 'mock_page_token_fit',
        pictureUrl: 'https://ui-avatars.com/api/?name=FitLife&background=16A34A&color=fff',
        category: 'Sports',
        tasks: ['MANAGE', 'MESSAGING'],
      },
    ];
  }

  async remintPageTokensFromUserToken(userAccessToken: string) {
    return this.getPages(userAccessToken);
  }

  async getPageInfo(pageId: string, pageAccessToken: string): Promise<MetaPageSummary> {
    const pages = await this.getPages('x');
    const found = pages.find((p) => p.id === pageId);
    if (!found) throw new Error(`Mock page not found: ${pageId}`);
    return { ...found, accessToken: pageAccessToken || found.accessToken };
  }

  async subscribeWebhooks(_pageId: string, _pageAccessToken: string): Promise<void> {
    return;
  }

  async fetchContacts(params: {
    pageId: string;
    pageAccessToken: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ contacts: MetaContact[]; nextCursor?: string; hasMore: boolean }> {
    const total = 120;
    const limit = params.limit ?? 50;
    const offset = params.cursor ? Number(params.cursor) : 0;
    const contacts: MetaContact[] = [];
    for (let i = offset; i < Math.min(offset + limit, total); i++) {
      contacts.push({
        platformUserId: `psid_${params.pageId}_${i + 1}`,
        name: `Customer ${i + 1}`,
        profileImage: `https://ui-avatars.com/api/?name=C${i + 1}&background=F8FAFC&color=0F172A`,
        lastInteractionAt: new Date(Date.now() - i * 3600_000).toISOString(),
      });
    }
    const next = offset + limit;
    return {
      contacts,
      nextCursor: next < total ? String(next) : undefined,
      hasMore: next < total,
    };
  }

  async sendTemplateMessage(input: MetaSendTemplateInput): Promise<MetaSendResult> {
    return this.mockSend(input.recipientPsid, input.idempotencyKey);
  }

  async sendUtilityMessage(input: MetaSendUtilityInput): Promise<MetaSendResult> {
    return this.mockSend(input.recipientPsid, input.idempotencyKey);
  }

  async sendResponseMessage(input: MetaSendResponseInput): Promise<MetaSendResult> {
    return this.mockSend(input.recipientPsid, input.idempotencyKey);
  }

  private mockSend(recipientPsid: string, idempotencyKey: string): MetaSendResult {
    if (recipientPsid.endsWith('_13')) {
      const err = new Error('Mock transient 429') as Error & { status: number; retryable: boolean };
      err.status = 429;
      err.retryable = true;
      throw err;
    }
    if (recipientPsid.endsWith('_7')) {
      const err = new Error('Mock permanent send failure') as Error & {
        status: number;
        retryable: boolean;
      };
      err.status = 400;
      err.retryable = false;
      throw err;
    }
    return {
      messageId: `m_mid.${createHmac('sha256', 'mock').update(idempotencyKey).digest('hex').slice(0, 24)}`,
      recipientId: recipientPsid,
    };
  }

  async submitTemplate(input: MetaSubmitTemplateInput): Promise<{ externalTemplateId: string }> {
    const created = await this.createUtilityTemplate(input);
    return { externalTemplateId: created.externalTemplateId };
  }

  async createUtilityTemplate(
    input: MetaSubmitTemplateInput
  ): Promise<{ externalTemplateId: string; status: MetaTemplateStatus['status'] }> {
    const id = `mock_utility_${input.name}`;
    this.store.set(id, {
      status: 'APPROVED',
      submittedAt: Date.now(),
      name: input.name,
    });
    return { externalTemplateId: id, status: 'APPROVED' };
  }

  async listMessageTemplates(params: {
    pageId: string;
    pageAccessToken: string;
    name?: string;
  }): Promise<MetaUtilityTemplateSummary[]> {
    const out: MetaUtilityTemplateSummary[] = [];
    for (const [id, cur] of this.store) {
      if (params.name && cur.name !== params.name) continue;
      out.push({
        id,
        name: cur.name,
        status: cur.status,
        language: 'en_US',
        category: 'UTILITY',
      });
    }
    return out;
  }

  async waitForUtilityTemplateApproved(params: {
    pageId: string;
    pageAccessToken: string;
    templateName: string;
  }): Promise<MetaTemplateStatus> {
    const list = await this.listMessageTemplates({
      pageId: params.pageId,
      pageAccessToken: params.pageAccessToken,
      name: params.templateName,
    });
    const hit = list.find((t) => t.name === params.templateName);
    if (hit) {
      return {
        externalTemplateId: hit.id || `utility_${params.templateName}`,
        status: hit.status,
        name: hit.name,
      };
    }
    return {
      externalTemplateId: `utility_${params.templateName}`,
      status: 'APPROVED',
      name: params.templateName,
    };
  }

  async getTemplateStatus(params: {
    pageId: string;
    pageAccessToken: string;
    externalTemplateId: string;
    templateName?: string;
  }): Promise<MetaTemplateStatus> {
    const cur = this.store.get(params.externalTemplateId);
    if (!cur) {
      return { externalTemplateId: params.externalTemplateId, status: 'APPROVED' };
    }
    return {
      externalTemplateId: params.externalTemplateId,
      status: cur.status,
      rejectionReason: cur.rejectionReason,
      name: cur.name,
    };
  }

  async uploadMessageAttachment(params: {
    pageId: string;
    pageAccessToken: string;
    imageUrl: string;
  }): Promise<{ attachmentId: string }> {
    return {
      attachmentId: `mock_att_${createHmac('sha256', 'mock').update(params.imageUrl).digest('hex').slice(0, 16)}`,
    };
  }
}

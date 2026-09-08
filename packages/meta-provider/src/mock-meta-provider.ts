import { createHmac, randomUUID } from 'node:crypto';
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
 * Local-development ONLY mock provider.
 * Never used when META_PROVIDER=meta.
 * Simulates OAuth, pages, contacts, template approval, and sends.
 */
export class MockMetaProvider implements MetaProvider {
  private readonly store = new Map<
    string,
    { status: MetaTemplateStatus['status']; rejectionReason?: string; submittedAt: number }
  >();

  constructor(private readonly config: Partial<MetaProviderConfig> = {}) {}

  getOAuthUrl(state: string, redirectUri: string): string {
    const base = this.config.redirectUri?.replace('/api/facebook/callback', '') ?? 'http://localhost:4000';
    // Mock OAuth lands on our callback with a fake code
    const params = new URLSearchParams({
      code: `mock_code_${randomUUID()}`,
      state,
    });
    // In mock mode the API connect endpoint redirects through a local mock authorize page
    return `${base}/api/facebook/mock-authorize?${params}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  async exchangeCodeForToken(code: string) {
    if (!code.startsWith('mock_code_') && code !== 'mock_dev_code') {
      // Still accept for local callback flows
    }
    return {
      accessToken: `mock_user_token_${randomUUID()}`,
      expiresIn: 60 * 60 * 24 * 60,
      tokenType: 'bearer',
    };
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
    // Simulate occasional transient failures for retry testing
    if (input.recipientPsid.endsWith('_13')) {
      const err = new Error('Mock transient 429') as Error & { status: number; retryable: boolean };
      err.status = 429;
      err.retryable = true;
      throw err;
    }
    if (input.recipientPsid.endsWith('_7')) {
      const err = new Error('Mock permanent send failure') as Error & {
        status: number;
        retryable: boolean;
      };
      err.status = 400;
      err.retryable = false;
      throw err;
    }
    return {
      messageId: `m_mid.${createHmac('sha256', 'mock').update(input.idempotencyKey).digest('hex').slice(0, 24)}`,
      recipientId: input.recipientPsid,
    };
  }

  async submitTemplate(input: MetaSubmitTemplateInput): Promise<{ externalTemplateId: string }> {
    const id = `messenger_lib_${input.name}`;
    this.store.set(id, { status: 'APPROVED', submittedAt: Date.now() });
    return { externalTemplateId: id };
  }

  async getTemplateStatus(params: {
    pageId: string;
    pageAccessToken: string;
    externalTemplateId: string;
  }): Promise<MetaTemplateStatus> {
    if (params.externalTemplateId.startsWith('messenger_lib_')) {
      return { externalTemplateId: params.externalTemplateId, status: 'APPROVED' };
    }
    const cur = this.store.get(params.externalTemplateId);
    if (!cur) {
      return { externalTemplateId: params.externalTemplateId, status: 'APPROVED' };
    }
    return {
      externalTemplateId: params.externalTemplateId,
      status: cur.status,
      rejectionReason: cur.rejectionReason,
    };
  }
}

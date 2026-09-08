/** Meta / Facebook Graph API provider abstraction */

export interface MetaAuthorizedUser {
  id: string;
  name: string;
  email?: string;
}

export interface MetaPageSummary {
  id: string;
  name: string;
  accessToken: string;
  pictureUrl?: string;
  category?: string;
  tasks?: string[];
}

export interface MetaContact {
  platformUserId: string;
  name?: string;
  profileImage?: string;
  lastInteractionAt?: string;
}

export type MetaMessagingType = 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';

export type MetaMessageTag =
  | 'ACCOUNT_UPDATE'
  | 'CONFIRMED_EVENT_UPDATE'
  | 'POST_PURCHASE_UPDATE'
  | 'HUMAN_AGENT'
  | 'CUSTOMER_FEEDBACK';

export interface MetaSendTemplateInput {
  pageId: string;
  pageAccessToken: string;
  recipientPsid: string;
  templateName: string;
  languageCode?: string;
  /** Rendered message text to send (preferred). */
  text?: string;
  bodyParameters: string[];
  /** Contact's last inbound interaction — used to pick RESPONSE/UPDATE vs MESSAGE_TAG. */
  lastInteractionAt?: string | Date | null;
  messagingType?: MetaMessagingType;
  tag?: MetaMessageTag;
  idempotencyKey: string;
}

export interface MetaSendResult {
  messageId: string;
  recipientId: string;
}

export type MetaTemplateExternalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'UNKNOWN';

export interface MetaTemplateStatus {
  externalTemplateId: string;
  status: MetaTemplateExternalStatus;
  rejectionReason?: string;
}

export interface MetaSubmitTemplateInput {
  pageId: string;
  pageAccessToken: string;
  name: string;
  category: string;
  language: string;
  body: string;
  exampleValues?: string[];
}

export interface MetaProvider {
  getOAuthUrl(state: string, redirectUri: string): string;
  exchangeCodeForToken(code: string, redirectUri: string): Promise<{
    accessToken: string;
    expiresIn?: number;
    tokenType?: string;
  }>;
  getAuthorizedUser(userAccessToken: string): Promise<MetaAuthorizedUser>;
  getPages(userAccessToken: string): Promise<MetaPageSummary[]>;
  getPageInfo(pageId: string, pageAccessToken: string): Promise<MetaPageSummary>;
  subscribeWebhooks(pageId: string, pageAccessToken: string): Promise<void>;
  /**
   * Conversations / messaging contacts. Meta APIs evolve; implementations
   * must use currently supported endpoints and surface limitations clearly.
   */
  fetchContacts(params: {
    pageId: string;
    pageAccessToken: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ contacts: MetaContact[]; nextCursor?: string; hasMore: boolean }>;
  sendTemplateMessage(input: MetaSendTemplateInput): Promise<MetaSendResult>;
  submitTemplate(input: MetaSubmitTemplateInput): Promise<{ externalTemplateId: string }>;
  getTemplateStatus(params: {
    pageId: string;
    pageAccessToken: string;
    externalTemplateId: string;
    templateName?: string;
  }): Promise<MetaTemplateStatus>;
  getMessageStatus?(params: {
    pageAccessToken: string;
    messageId: string;
  }): Promise<{ status: string }>;
}

export interface MetaProviderConfig {
  appId: string;
  appSecret: string;
  graphVersion: string;
  redirectUri: string;
}

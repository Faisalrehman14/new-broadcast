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

export type MetaMessagingType = 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG' | 'UTILITY';

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
  text?: string;
  bodyParameters: string[];
  lastInteractionAt?: string | Date | null;
  messagingType?: MetaMessagingType;
  tag?: MetaMessageTag;
  idempotencyKey: string;
}

export interface MetaSendUtilityInput {
  pageId: string;
  pageAccessToken: string;
  recipientPsid: string;
  templateName: string;
  languageCode?: string;
  bodyParameters: string[];
  idempotencyKey: string;
}

export interface MetaSendResponseInput {
  pageId: string;
  pageAccessToken: string;
  recipientPsid: string;
  text?: string;
  attachmentId?: string;
  imageUrl?: string;
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
  name?: string;
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

export interface MetaUtilityTemplateSummary {
  id?: string;
  name: string;
  status: MetaTemplateExternalStatus;
  language: string;
  category?: string;
}

export interface MetaProvider {
  getOAuthUrl(state: string, redirectUri: string, options?: { rerequest?: boolean }): string;
  exchangeCodeForToken(code: string, redirectUri: string): Promise<{
    accessToken: string;
    expiresIn?: number;
    tokenType?: string;
    longLived?: boolean;
  }>;
  exchangeLongLivedUserToken?(shortLivedToken: string): Promise<{
    accessToken: string;
    expiresIn?: number;
  }>;
  getAuthorizedUser(userAccessToken: string): Promise<MetaAuthorizedUser>;
  getPages(userAccessToken: string): Promise<MetaPageSummary[]>;
  getPageInfo(pageId: string, pageAccessToken: string): Promise<MetaPageSummary>;
  remintPageTokensFromUserToken?(userAccessToken: string): Promise<MetaPageSummary[]>;
  subscribeWebhooks(pageId: string, pageAccessToken: string): Promise<void>;
  fetchContacts(params: {
    pageId: string;
    pageAccessToken: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ contacts: MetaContact[]; nextCursor?: string; hasMore: boolean }>;
  sendTemplateMessage(input: MetaSendTemplateInput): Promise<MetaSendResult>;
  sendUtilityMessage(input: MetaSendUtilityInput): Promise<MetaSendResult>;
  sendResponseMessage(input: MetaSendResponseInput): Promise<MetaSendResult>;
  submitTemplate(input: MetaSubmitTemplateInput): Promise<{ externalTemplateId: string }>;
  createUtilityTemplate(input: MetaSubmitTemplateInput): Promise<{ externalTemplateId: string; status: MetaTemplateExternalStatus }>;
  listMessageTemplates(params: {
    pageId: string;
    pageAccessToken: string;
    name?: string;
  }): Promise<MetaUtilityTemplateSummary[]>;
  waitForUtilityTemplateApproved(params: {
    pageId: string;
    pageAccessToken: string;
    templateName: string;
    retries?: number;
    intervalMs?: number;
  }): Promise<MetaTemplateStatus>;
  getTemplateStatus(params: {
    pageId: string;
    pageAccessToken: string;
    externalTemplateId: string;
    templateName?: string;
  }): Promise<MetaTemplateStatus>;
  uploadMessageAttachment?(params: {
    pageId: string;
    pageAccessToken: string;
    imageUrl: string;
  }): Promise<{ attachmentId: string }>;
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

export const META_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_utility_messaging',
  'business_management',
] as const;

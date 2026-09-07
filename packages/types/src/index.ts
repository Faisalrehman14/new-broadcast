/** Shared domain types for PageBroadcast */

export type UserRole = 'USER' | 'ADMIN';

export type FacebookAccountStatus =
  | 'CONNECTED'
  | 'NEEDS_REAUTH'
  | 'PERMISSION_MISSING'
  | 'DISCONNECTED'
  | 'ERROR';

export type PageConnectionStatus =
  | 'CONNECTED'
  | 'SYNCING'
  | 'NEEDS_REAUTH'
  | 'DISCONNECTED'
  | 'ERROR';

export type ContactStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

export type TemplateSource = 'PAGEINTERACT' | 'LIBRARY' | 'CUSTOM';
export type TemplateBodyStatus = 'ready' | 'requires_import';
export type TemplateApprovalStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'UNKNOWN';

export type BroadcastStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SCHEDULED'
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'PAUSING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type RecipientDeliveryStatus =
  | 'PENDING'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'RETRYING'
  | 'SKIPPED';

export type SyncJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type SupportTicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type NotificationType =
  | 'FACEBOOK_CONNECTED'
  | 'FACEBOOK_DISCONNECTED'
  | 'SYNC_COMPLETED'
  | 'SYNC_FAILED'
  | 'TEMPLATE_SUBMITTED'
  | 'TEMPLATE_APPROVED'
  | 'TEMPLATE_REJECTED'
  | 'BROADCAST_STARTED'
  | 'BROADCAST_COMPLETED'
  | 'BROADCAST_FAILED'
  | 'CONNECTION_LOST'
  | 'GENERIC';

export interface TemplateVariableDef {
  key: string;
  position: number;
}

export interface ParsedTemplate {
  variables: TemplateVariableDef[];
  duplicates: string[];
  missingNumbers: number[];
  raw: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export const BROADCAST_TRANSITIONS: Record<BroadcastStatus, BroadcastStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'QUEUED', 'CANCELLED'],
  REJECTED: ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'],
  SCHEDULED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['PAUSING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'],
  PAUSING: ['PAUSED', 'RUNNING'],
  PAUSED: ['QUEUED', 'RUNNING', 'CANCELLED'],
  COMPLETED: [],
  PARTIALLY_COMPLETED: [],
  FAILED: ['DRAFT'],
  CANCELLED: [],
};

export function canTransitionBroadcast(
  from: BroadcastStatus,
  to: BroadcastStatus
): boolean {
  return BROADCAST_TRANSITIONS[from]?.includes(to) ?? false;
}

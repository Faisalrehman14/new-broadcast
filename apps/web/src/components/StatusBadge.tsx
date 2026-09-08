import { statusStyles, cn } from '@/lib/utils';

const labels: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SCHEDULED: 'Scheduled',
  QUEUED: 'Queued',
  RUNNING: 'Sending',
  PAUSED: 'Paused',
  PAUSING: 'Pausing',
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partially Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  SETTING_UP_TEMPLATES: 'Setting up templates',
  SYNCING_LEADS: 'Syncing audience',
  SENDING: 'Sending',
  STOPPED: 'Stopped',
  OK: 'OK',
  NO_TOKEN: 'No token',
  SKIPPED: 'Skipped',
  ERROR: 'Error',
  CONNECTED: 'Connected',
  SYNCING: 'Syncing',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  RETRYING: 'Retrying',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        statusStyles[status] || 'bg-slate-100 text-slate-700'
      )}
      aria-label={`Status: ${labels[status] || status}`}
    >
      {labels[status] || status}
    </span>
  );
}

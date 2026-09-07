import { statusStyles, cn } from '@/lib/utils';

const labels: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SCHEDULED: 'Scheduled',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partially Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  CONNECTED: 'Connected',
  SYNCING: 'Syncing',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
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

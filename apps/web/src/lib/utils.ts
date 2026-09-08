export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function formatRelative(date?: string | Date | null) {
  if (!date) return 'Never';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function renderPreview(body: string, values: Record<string, string>) {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, key: string) => {
    const v = values[key];
    return v !== undefined && v !== '' ? v : `{{${key}}}`;
  });
}

export const statusStyles: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  SCHEDULED: 'bg-indigo-100 text-indigo-800',
  QUEUED: 'bg-blue-100 text-blue-800',
  RUNNING: 'bg-blue-100 text-blue-800',
  PAUSED: 'bg-slate-100 text-slate-700',
  PAUSING: 'bg-slate-100 text-slate-700',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  PARTIALLY_COMPLETED: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
  CONNECTED: 'bg-emerald-100 text-emerald-800',
  SYNCING: 'bg-blue-100 text-blue-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  INACTIVE: 'bg-slate-100 text-slate-600',
  SENDING: 'bg-blue-100 text-blue-800',
  SENT: 'bg-emerald-100 text-emerald-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  READ: 'bg-emerald-100 text-emerald-800',
  RETRYING: 'bg-amber-100 text-amber-800',
  SKIPPED: 'bg-slate-100 text-slate-600',
};

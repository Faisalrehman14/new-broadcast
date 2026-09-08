'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, apiUrl } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { messages } from '@/i18n/en';
import { formatRelative } from '@/lib/utils';

type Broadcast = {
  id: string;
  name: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  readCount: number;
  responseCount: number;
  queuedCount: number;
  sendingCount: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  template: {
    id: string;
    title: string;
    isCustom: boolean;
    status: string;
    approvals: Array<{ pageId?: string; status: string; rejectionReason?: string }>;
  };
  page: { id?: string; name: string };
};

type Progress = {
  status: string;
  total: number;
  queued: number;
  pending: number;
  retrying: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  percent: number;
  done: number;
  remaining: number;
  active: boolean;
  summary: string;
  updatedAt: string;
};

type Recipient = {
  id: string;
  status: string;
  sentAt?: string;
  deliveredAt?: string;
  failureReason?: string;
  contact: { name?: string };
};

const LIVE_STATUSES = new Set([
  'QUEUED',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export default function BroadcastDetailPage() {
  const params = useParams<{ id: string }>();
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [recipientFilter, setRecipientFilter] = useState<'ALL' | 'FAILED' | 'SENT' | 'PENDING'>('ALL');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientTotal, setRecipientTotal] = useState(0);

  const loadRecipients = useCallback(
    async (filter: typeof recipientFilter) => {
      const statusQuery =
        filter === 'ALL'
          ? ''
          : filter === 'PENDING'
            ? '&status=PENDING'
            : filter === 'FAILED'
              ? '&status=FAILED'
              : '&status=SENT';
      const rec = await api<{ data: Recipient[]; pagination: { total: number } }>(
        `/api/broadcasts/${params.id}/recipients?pageSize=100${statusQuery}`
      );
      setRecipients(rec.data);
      setRecipientTotal(rec.pagination.total);
    },
    [params.id]
  );

  const load = useCallback(async () => {
    const [res, prog] = await Promise.all([
      api<{ broadcast: Broadcast }>(`/api/broadcasts/${params.id}`),
      api<Progress>(`/api/broadcasts/${params.id}/progress`),
    ]);
    setBroadcast(res.broadcast);
    setProgress(prog);
    await loadRecipients(recipientFilter);
  }, [params.id, loadRecipients, recipientFilter]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const tick = async () => {
      try {
        const prog = await api<Progress>(`/api/broadcasts/${params.id}/progress`);
        setProgress(prog);
        const res = await api<{ broadcast: Broadcast }>(`/api/broadcasts/${params.id}`);
        setBroadcast(res.broadcast);
        if (prog.active || LIVE_STATUSES.has(prog.status)) {
          await loadRecipients(recipientFilter);
        }
      } catch {
        /* ignore transient poll errors */
      }
    };
    const intervalMs = progress?.active ? 1500 : 3000;
    const t = setInterval(tick, intervalMs);
    return () => clearInterval(t);
  }, [params.id, loadRecipients, recipientFilter, progress?.active]);

  const stats = useMemo(() => {
    if (!broadcast) return null;
    return {
      total: progress?.total ?? broadcast.totalRecipients,
      sent: progress?.sent ?? broadcast.sentCount,
      failed: progress?.failed ?? broadcast.failedCount,
      sending: progress?.sending ?? broadcast.sendingCount,
      queued: progress?.queued ?? broadcast.queuedCount,
      percent: progress?.percent ?? 0,
      remaining: progress?.remaining ?? Math.max(0, broadcast.totalRecipients - broadcast.sentCount - broadcast.failedCount),
    };
  }, [broadcast, progress]);

  if (!broadcast || !stats) return <LoadingState label="Loading broadcast..." />;

  const approval =
    broadcast.template.approvals.find((a) => a.pageId === broadcast.page.id) ||
    broadcast.template.approvals[0];
  const isPending = broadcast.status === 'PENDING_APPROVAL';
  const isApproved = broadcast.status === 'APPROVED';
  const isRejected = broadcast.status === 'REJECTED';
  const canStart =
    isApproved || (broadcast.template.isCustom && broadcast.status === 'DRAFT');
  const showLive = LIVE_STATUSES.has(broadcast.status);

  async function submitApproval() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>(`/api/broadcasts/${params.id}/submit-approval`, {
        method: 'POST',
      });
      setMessage(res.message || messages.approval.ready);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      await api(`/api/broadcasts/${params.id}/start`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setConfirmOpen(false);
      setMessage('Broadcast started — live counters below update every few seconds.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to start');
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{broadcast.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {broadcast.page.name} · {broadcast.template.title}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={broadcast.status} />
            {progress?.active ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />
                Live updating
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!broadcast.template.isCustom && broadcast.status === 'DRAFT' ? (
            <button className="btn-primary" disabled={busy} onClick={submitApproval}>
              {messages.actions.submitApproval}
            </button>
          ) : null}
          {isPending ? (
            <button className="btn-secondary" disabled>
              {messages.actions.waitingApproval}
            </button>
          ) : null}
          {isRejected ? (
            <button className="btn-primary" disabled={busy} onClick={submitApproval}>
              {messages.actions.fixResubmit}
            </button>
          ) : null}
          {canStart ? (
            <button className="btn-primary" onClick={() => setConfirmOpen(true)}>
              {messages.actions.startBroadcast}
            </button>
          ) : null}
          <a className="btn-secondary" href={apiUrl(`/api/broadcasts/${params.id}/export`)}>
            Export CSV
          </a>
        </div>
      </div>

      {isPending ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Waiting for approval — {messages.approval.waiting}
        </div>
      ) : null}
      {isRejected && approval?.rejectionReason ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Rejected: {approval.rejectionReason}
        </div>
      ) : null}
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      {progress?.summary ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            progress.active
              ? 'border-blue-200 bg-blue-50 text-blue-900'
              : broadcast.status === 'FAILED'
                ? 'border-red-200 bg-red-50 text-red-900'
                : broadcast.status === 'PARTIALLY_COMPLETED'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-50 text-slate-800'
          }`}
        >
          {progress.summary}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Sent" value={stats.sent} tone="success" />
        <StatCard label="Failed" value={stats.failed} tone="danger" />
        <StatCard label="Sending now" value={stats.sending} tone="info" />
        <StatCard label="Waiting / queued" value={stats.queued} />
      </div>

      {showLive || stats.sent > 0 || stats.failed > 0 ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Delivery progress</h2>
            <span className="text-sm text-slate-500">
              {stats.percent}% · {stats.sent + stats.failed} of {stats.total} processed
              {stats.remaining > 0 ? ` · ${stats.remaining} left` : ''}
            </span>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="flex h-full transition-all duration-500"
              style={{ width: `${Math.max(stats.percent, stats.sent + stats.failed > 0 ? 2 : 0)}%` }}
            >
              {stats.sent + stats.failed > 0 ? (
                <>
                  <div
                    className="h-full bg-emerald-500"
                    style={{
                      width: `${(stats.sent / Math.max(stats.sent + stats.failed, 1)) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-red-500"
                    style={{
                      width: `${(stats.failed / Math.max(stats.sent + stats.failed, 1)) * 100}%`,
                    }}
                  />
                </>
              ) : (
                <div className="h-full w-full bg-blue-400/40" />
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Sent {stats.sent}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Failed {stats.failed}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Sending {stats.sending}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> Queued {stats.queued}
            </span>
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="font-semibold">Recipients</p>
            <p className="text-xs text-slate-500">{recipientTotal} shown for this filter</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['ALL', 'All'],
                ['SENT', 'Sent'],
                ['FAILED', 'Failed'],
                ['PENDING', 'Waiting'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={recipientFilter === id ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setRecipientFilter(id)}
              >
                {label}
                {id === 'FAILED' && stats.failed ? ` (${stats.failed})` : ''}
                {id === 'SENT' && stats.sent ? ` (${stats.sent})` : ''}
              </button>
            ))}
          </div>
        </div>
        {recipients.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            {showLive
              ? 'No recipients in this filter yet. Counts above update as the worker sends.'
              : 'Start the broadcast to begin sending. Live sent/failed counts will appear here.'}
          </p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Sent</th>
                <th className="px-5 py-3">Failure reason</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-5 py-3">{r.contact.name || 'Customer'}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-5 py-3">{formatRelative(r.sentAt)}</td>
                  <td className="max-w-md px-5 py-3 text-xs text-slate-500">
                    {r.failureReason || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark/40 p-4">
          <div className="card w-full max-w-lg p-6" role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold">Start broadcast?</h3>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-slate-400">Broadcast</dt>
                <dd>{broadcast.name}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Page</dt>
                <dd>{broadcast.page.name}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Template</dt>
                <dd>{broadcast.template.title}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Recipients</dt>
                <dd>{broadcast.totalRecipients}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-slate-600">
              After start, this page will show live Sent / Failed / Sending counts.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy} onClick={start}>
                {busy ? 'Starting...' : 'Start Broadcast'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger' | 'info';
}) {
  const valueClass =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'danger'
        ? 'text-red-700'
        : tone === 'info'
          ? 'text-blue-700'
          : 'text-slate-900';
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

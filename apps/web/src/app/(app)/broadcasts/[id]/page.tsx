'use client';

import { useEffect, useState } from 'react';
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
    approvals: Array<{ status: string; rejectionReason?: string }>;
  };
  page: { name: string };
};

export default function BroadcastDetailPage() {
  const params = useParams<{ id: string }>();
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [progress, setProgress] = useState<{
    percent: number;
    queued: number;
    sending: number;
    sent: number;
    delivered: number;
    failed: number;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [recipients, setRecipients] = useState<
    Array<{
      id: string;
      status: string;
      sentAt?: string;
      deliveredAt?: string;
      failureReason?: string;
      contact: { name?: string };
    }>
  >([]);

  async function load() {
    const res = await api<{ broadcast: Broadcast }>(`/api/broadcasts/${params.id}`);
    setBroadcast(res.broadcast);
    const prog = await api<typeof progress & object>(`/api/broadcasts/${params.id}/progress`);
    setProgress(prog);
    const rec = await api<{ data: typeof recipients }>(`/api/broadcasts/${params.id}/recipients?pageSize=50`);
    setRecipients(rec.data);
  }

  useEffect(() => {
    load().catch(() => undefined);
    const t = setInterval(() => {
      api(`/api/broadcasts/${params.id}/progress`)
        .then((p) => setProgress(p as typeof progress))
        .catch(() => undefined);
      api<{ broadcast: Broadcast }>(`/api/broadcasts/${params.id}`)
        .then((r) => setBroadcast(r.broadcast))
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [params.id]);

  if (!broadcast) return <LoadingState label="Loading broadcast..." />;

  const approval = broadcast.template.approvals[0];
  const isPending = broadcast.status === 'PENDING_APPROVAL';
  const isApproved = broadcast.status === 'APPROVED';
  const isRejected = broadcast.status === 'REJECTED';
  const canStart =
    isApproved || (broadcast.template.isCustom && broadcast.status === 'DRAFT');

  async function submitApproval() {
    setBusy(true);
    try {
      const res = await api<{ message: string }>(`/api/broadcasts/${params.id}/submit-approval`, {
        method: 'POST',
      });
      setMessage(res.message);
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
      await api(`/api/broadcasts/${params.id}/start`, { method: 'POST' });
      setConfirmOpen(false);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to start');
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
          <div className="mt-2">
            <StatusBadge status={broadcast.status} />
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

      {/* Never show Sending while pending approval */}
      {!isPending && progress && ['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED'].includes(broadcast.status) ? (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Progress</h2>
            <span className="text-sm text-slate-500">{progress.percent}% complete</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div>Total: {broadcast.totalRecipients}</div>
            <div>Queued: {progress.queued}</div>
            <div>Sending: {progress.sending}</div>
            <div>Sent: {progress.sent}</div>
            <div>Delivered: {progress.delivered}</div>
            <div>Failed: {progress.failed}</div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-slate-400">Sent</p><p className="text-xl font-semibold">{broadcast.sentCount}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-400">Delivered</p><p className="text-xl font-semibold">{broadcast.deliveredCount}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-400">Failed</p><p className="text-xl font-semibold">{broadcast.failedCount}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-400">Responses</p><p className="text-xl font-semibold">{broadcast.responseCount}</p></div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 font-semibold">Recipients</div>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Customer</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Sent</th>
              <th className="px-5 py-3">Delivered</th>
              <th className="px-5 py-3">Failure</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-5 py-3">{r.contact.name || 'Customer'}</td>
                <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-5 py-3">{formatRelative(r.sentAt)}</td>
                <td className="px-5 py-3">{formatRelative(r.deliveredAt)}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{r.failureReason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark/40 p-4">
          <div className="card w-full max-w-lg p-6" role="dialog" aria-modal="true">
            <h3 className="text-lg font-semibold">Start broadcast?</h3>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="text-slate-400">Broadcast</dt><dd>{broadcast.name}</dd></div>
              <div><dt className="text-slate-400">Page</dt><dd>{broadcast.page.name}</dd></div>
              <div><dt className="text-slate-400">Template</dt><dd>{broadcast.template.title}</dd></div>
              <div><dt className="text-slate-400">Recipients</dt><dd>{broadcast.totalRecipients}</dd></div>
            </dl>
            <p className="mt-4 text-sm text-slate-600">
              Messages will be sent to the selected eligible contacts. Make sure your content complies with applicable Meta policies and messaging requirements.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
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

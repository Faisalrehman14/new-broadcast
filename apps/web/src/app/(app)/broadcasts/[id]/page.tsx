'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';

type Campaign = {
  id: string;
  phase: string;
  message?: string | null;
  imageUrl?: string | null;
  speedPreset: string;
  delayMs: number;
  estimatedRecipients: number;
  estimatedQuota: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  queuedCount: number;
  phaseMessage?: string | null;
  etaSeconds?: number;
  remaining?: number;
  active?: boolean;
  pages: Array<{
    id: string;
    pageName: string;
    status: string;
    templateReady: boolean;
    sentCount: number;
    failedCount: number;
    recipientCount: number;
    lastError?: string | null;
  }>;
};

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [failures, setFailures] = useState<
    Array<{ id: string; code: string; message: string; psid?: string | null }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      api<{ campaign: Campaign }>(`/api/broadcast/campaigns/${params.id}`),
      api<{ data: typeof failures }>(`/api/broadcast/campaigns/${params.id}/failures?pageSize=30`),
    ]);
    setCampaign(c.campaign);
    setFailures(f.data);
  }, [params.id]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
    const t = setInterval(() => {
      load().catch(() => undefined);
    }, campaign?.active ? 1500 : 4000);
    return () => clearInterval(t);
  }, [load, campaign?.active]);

  if (!campaign && !error) return <LoadingState label="Loading campaign..." />;
  if (!campaign) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-danger">{error}</p>
        <Link href="/broadcasts" className="btn-secondary">
          Back
        </Link>
      </div>
    );
  }

  async function action(kind: 'pause' | 'resume' | 'stop' | 'dismiss') {
    setBusy(true);
    setError('');
    try {
      await api(`/api/broadcast/campaigns/${params.id}/${kind}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const percent =
    campaign.estimatedRecipients > 0
      ? Math.min(
          100,
          Math.round(
            ((campaign.sentCount + campaign.failedCount + campaign.skippedCount) /
              campaign.estimatedRecipients) *
              100
          )
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-400">
            <Link href="/broadcasts" className="hover:underline">
              Broadcasts
            </Link>{' '}
            / {campaign.id.slice(0, 8)}…
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Campaign</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.phase.toUpperCase()} />
            {campaign.active ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />
                Live · ETA ~{campaign.etaSeconds ?? 0}s
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {['queued', 'setting_up_templates', 'syncing_leads', 'sending'].includes(campaign.phase) ? (
            <button className="btn-secondary" disabled={busy} onClick={() => action('pause')}>
              Pause
            </button>
          ) : null}
          {campaign.phase === 'paused' ? (
            <button className="btn-primary" disabled={busy} onClick={() => action('resume')}>
              Resume
            </button>
          ) : null}
          {campaign.active ? (
            <button className="btn-secondary" disabled={busy} onClick={() => action('stop')}>
              Stop
            </button>
          ) : null}
          {!campaign.active ? (
            <button className="btn-secondary" disabled={busy} onClick={() => action('dismiss')}>
              Dismiss
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={`rounded-xl border px-4 py-3 text-sm font-medium ${
          campaign.active
            ? 'border-blue-200 bg-blue-50 text-blue-900'
            : campaign.phase === 'failed'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-slate-200 bg-slate-50 text-slate-800'
        }`}
      >
        {campaign.phaseMessage || campaign.phase}
        {campaign.active ? ' — Still working, not stuck.' : ''}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Total" value={campaign.estimatedRecipients} />
        <Stat label="Sent" value={campaign.sentCount} tone="success" />
        <Stat label="Failed" value={campaign.failedCount} tone="danger" />
        <Stat label="Skipped" value={campaign.skippedCount} />
        <Stat label="Queued" value={campaign.queuedCount} tone="info" />
      </div>

      <div className="card p-5">
        <div className="flex justify-between text-sm">
          <span className="font-semibold">Progress</span>
          <span className="text-slate-500">{percent}%</span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Speed {campaign.speedPreset} · {campaign.delayMs}ms delay · quota est.{' '}
          {campaign.estimatedQuota}
        </p>
        {campaign.message ? (
          <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">
            {campaign.message}
          </pre>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 font-semibold">Pages</div>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Page</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Template</th>
              <th className="px-5 py-3">Recipients</th>
              <th className="px-5 py-3">Sent</th>
              <th className="px-5 py-3">Failed</th>
            </tr>
          </thead>
          <tbody>
            {campaign.pages.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-5 py-3">{p.pageName}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={p.status.toUpperCase()} />
                  {p.lastError ? (
                    <p className="mt-1 max-w-xs text-xs text-slate-500">{p.lastError}</p>
                  ) : null}
                </td>
                <td className="px-5 py-3">{p.templateReady ? 'Ready' : 'Pending'}</td>
                <td className="px-5 py-3 tabular-nums">{p.recipientCount}</td>
                <td className="px-5 py-3 tabular-nums text-emerald-700">{p.sentCount}</td>
                <td className="px-5 py-3 tabular-nums text-red-700">{p.failedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 font-semibold">Recent failures</div>
        {failures.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No failures recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {failures.map((f) => (
              <li key={f.id} className="px-5 py-3">
                <span className="font-medium text-red-700">{f.code}</span>
                <span className="text-slate-600"> — {f.message}</span>
                {f.psid ? <span className="block text-xs text-slate-400">PSID {f.psid}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger' | 'info';
}) {
  const cls =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'danger'
        ? 'text-red-700'
        : tone === 'info'
          ? 'text-blue-700'
          : 'text-slate-900';
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

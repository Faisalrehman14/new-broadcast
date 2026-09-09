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

function phaseHint(phase: string, active?: boolean) {
  if (!active) return '';
  if (phase === 'setting_up_templates') return 'Preparing templates…';
  if (phase === 'syncing_leads') return 'Syncing audience…';
  if (phase === 'sending') return 'Delivering…';
  return 'Working…';
}

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
      api<{ data: typeof failures }>(`/api/broadcast/campaigns/${params.id}/failures?pageSize=20`),
    ]);
    setCampaign(c.campaign);
    setFailures(f.data);
  }, [params.id]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
    const t = setInterval(() => {
      load().catch(() => undefined);
    }, campaign?.active ? 1500 : 5000);
    return () => clearInterval(t);
  }, [load, campaign?.active]);

  if (!campaign && !error) return <LoadingState label="Loading campaign…" />;
  if (!campaign) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-danger">{error}</p>
        <Link href="/broadcasts" className="btn-secondary">
          Back to broadcasts
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

  const processed = campaign.sentCount + campaign.failedCount + campaign.skippedCount;
  const total = Math.max(campaign.estimatedRecipients, 1);
  const deliveredPct = Math.min(100, Math.round((campaign.sentCount / total) * 100));
  const processedPct = Math.min(100, Math.round((processed / total) * 100));
  const title =
    (campaign.message || '').trim().slice(0, 72) || `Campaign ${campaign.id.slice(0, 8)}`;
  const hint = phaseHint(campaign.phase, campaign.active);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/broadcasts" className="text-xs font-medium text-slate-400 hover:text-primary">
            ← Broadcasts
          </Link>
          <h1 className="page-title mt-1 break-words">{title}{title.length >= 72 ? '…' : ''}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.phase.toUpperCase()} />
            {campaign.active ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
                Live{campaign.etaSeconds ? ` · ~${campaign.etaSeconds}s left` : ''}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {['queued', 'setting_up_templates', 'syncing_leads', 'sending'].includes(
            campaign.phase
          ) ? (
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
        className={`rounded-2xl border px-4 py-3 text-sm ${
          campaign.active
            ? 'border-blue-200 bg-blue-50 text-blue-950'
            : campaign.phase === 'failed'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-slate-200 bg-white text-slate-800'
        }`}
      >
        <p className="font-medium">{campaign.phaseMessage || campaign.phase}</p>
        {hint ? <p className="mt-0.5 text-xs opacity-80">{hint}</p> : null}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Delivered" value={campaign.sentCount} tone="success" />
        <Stat label="Failed" value={campaign.failedCount} tone="danger" />
        <Stat label="Skipped" value={campaign.skippedCount} />
        <Stat label="Queued" value={campaign.queuedCount} tone="info" />
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">Delivery</h2>
            <p className="text-sm text-slate-500">
              {campaign.sentCount.toLocaleString()} of {campaign.estimatedRecipients.toLocaleString()}{' '}
              delivered ({deliveredPct}%)
            </p>
          </div>
          <p className="text-xs text-slate-400">{processedPct}% processed</p>
        </div>
        <div className="relative mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="absolute inset-y-0 left-0 bg-slate-300/80 transition-all"
            style={{ width: `${processedPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 bg-emerald-500 transition-all"
            style={{ width: `${deliveredPct}%` }}
          />
        </div>
        {campaign.message ? (
          <pre className="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            {campaign.message}
          </pre>
        ) : null}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3.5 font-semibold text-slate-900">
          Pages
        </div>
        <div className="divide-y divide-slate-100">
          {campaign.pages.map((p) => {
            const blocked = /Utility Messaging|picker|outside 24h/i.test(p.lastError || '');
            return (
              <div key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{p.pageName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {p.templateReady ? 'Template ready' : blocked ? 'Utility blocked' : 'Pending'} ·{' '}
                    {p.recipientCount.toLocaleString()} leads
                  </p>
                  {p.lastError ? (
                    <p className="mt-1 max-w-xl text-xs text-slate-500">{p.lastError}</p>
                  ) : null}
                </div>
                <div className="text-right text-sm">
                  <p className="tabular-nums text-emerald-700">{p.sentCount} sent</p>
                  {p.failedCount ? (
                    <p className="tabular-nums text-red-600">{p.failedCount} failed</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3.5 font-semibold text-slate-900">
          Issues
        </div>
        {failures.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">No issues recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {failures.map((f) => {
              const utilityFix =
                f.code === 'utility_window_rejected' ||
                f.code === 'utility_permission_missing' ||
                /Utility Messaging|outside 24h/i.test(f.message);
              return (
                <li key={f.id} className="px-5 py-3 text-sm">
                  <p className="font-medium text-slate-900">{f.code.replace(/_/g, ' ')}</p>
                  <p className="mt-0.5 text-slate-600">{f.message}</p>
                  {utilityFix ? (
                    <Link
                      href="/reconnect"
                      className="mt-1 inline-block text-xs font-semibold text-primary hover:underline"
                    >
                      Fix with Reconnect → Utility Messaging
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
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
      <p className="section-label">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{value.toLocaleString()}</p>
    </div>
  );
}

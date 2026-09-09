'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRelative } from '@/lib/utils';

type Campaign = {
  id: string;
  phase: string;
  message?: string | null;
  estimatedRecipients: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  phaseMessage?: string | null;
  createdAt: string;
};

function titleFor(c: Campaign) {
  const msg = (c.message || '').trim();
  if (msg) return msg.length > 56 ? `${msg.slice(0, 56)}…` : msg;
  return `Campaign ${c.id.slice(0, 8)}`;
}

export default function BroadcastsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [active, setActive] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [act, list] = await Promise.all([
          api<{ campaign: Campaign | null }>('/api/broadcast/campaigns/active'),
          api<{ campaigns: Campaign[] }>('/api/broadcast/campaigns'),
        ]);
        if (cancelled) return;
        setActive(act.campaign);
        setCampaigns(list.campaigns);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void refresh();
    const t = setInterval(() => void refresh(), active ? 2500 : 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [active?.id]);

  if (loading) return <LoadingState label="Loading campaigns…" />;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Broadcasts</h1>
          <p className="page-sub">Create, monitor, and deliver Messenger campaigns.</p>
        </div>
        <Link href="/broadcasts/new" className="btn-primary">
          New campaign
        </Link>
      </div>

      {active ? (
        <Link
          href={`/broadcasts/${active.id}`}
          className="block overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-white to-white px-5 py-4 shadow-card transition hover:shadow-lift"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                Live now
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-ink">
                {titleFor(active)}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {active.phaseMessage || active.phase} · {active.sentCount.toLocaleString()}{' '}
                delivered
                {active.failedCount ? ` · ${active.failedCount} failed` : ''}
              </p>
            </div>
            <StatusBadge status={active.phase.toUpperCase()} />
          </div>
        </Link>
      ) : null}

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          action={
            <Link href="/broadcasts/new" className="btn-primary">
              Create your first campaign
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="border-b border-ink/5 px-5 py-3">
            <p className="section-label mb-0">Campaign history</p>
          </div>
          <ul className="divide-y divide-ink/5">
            {campaigns.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/broadcasts/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-mist/70"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{titleFor(c)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatRelative(c.createdAt)} · {c.estimatedRecipients.toLocaleString()}{' '}
                      audience
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="tabular-nums">
                      <span className="font-semibold text-emerald-700">
                        {c.sentCount.toLocaleString()}
                      </span>
                      {(c.failedCount || c.skippedCount) > 0 ? (
                        <span className="text-slate-400">
                          {' '}
                          / {(c.failedCount + c.skippedCount).toLocaleString()}
                        </span>
                      ) : null}
                    </span>
                    <StatusBadge status={c.phase.toUpperCase()} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

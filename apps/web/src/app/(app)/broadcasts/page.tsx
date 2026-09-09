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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Broadcasts</h1>
          <p className="page-sub">Create, monitor, and deliver Messenger campaigns</p>
        </div>
        <Link href="/broadcasts/new" className="btn-primary">
          New campaign
        </Link>
      </div>

      {active ? (
        <Link
          href={`/broadcasts/${active.id}`}
          className="block rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 transition hover:bg-primary/10"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Live now</p>
              <p className="mt-0.5 font-semibold text-slate-900">{titleFor(active)}</p>
              <p className="mt-1 text-sm text-slate-600">
                {active.phaseMessage || active.phase} · {active.sentCount.toLocaleString()} delivered
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
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Campaign</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Audience</th>
                <th className="px-5 py-3 font-semibold">Delivered</th>
                <th className="px-5 py-3 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <Link href={`/broadcasts/${c.id}`} className="font-medium text-slate-900 hover:text-primary">
                      {titleFor(c)}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.phase.toUpperCase()} />
                  </td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">
                    {c.estimatedRecipients.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    <span className="text-emerald-700">{c.sentCount.toLocaleString()}</span>
                    {c.failedCount || c.skippedCount ? (
                      <span className="text-slate-400">
                        {' '}
                        / {(c.failedCount + c.skippedCount).toLocaleString()} other
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{formatRelative(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
    refresh();
    const t = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading) return <LoadingState label="Loading campaigns..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Broadcasts</h1>
          <p className="text-sm text-slate-500">
            Multi-page Messenger campaigns with UTILITY templates outside the 24h window
          </p>
        </div>
        <Link href="/broadcasts/new" className="btn-primary">
          + New campaign
        </Link>
      </div>

      {active ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Active campaign{' '}
          <Link className="font-semibold underline" href={`/broadcasts/${active.id}`}>
            {active.id.slice(0, 8)}…
          </Link>{' '}
          — {active.phaseMessage || active.phase} · sent {active.sentCount} · failed{' '}
          {active.failedCount}
        </div>
      ) : null}

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          action={
            <Link href="/broadcasts/new" className="btn-primary">
              Create campaign
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">Campaign</th>
                <th className="px-5 py-3">Phase</th>
                <th className="px-5 py-3">Recipients</th>
                <th className="px-5 py-3">Sent</th>
                <th className="px-5 py-3">Failed</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/broadcasts/${c.id}`} className="font-medium text-primary">
                      {(c.message || 'Campaign').slice(0, 48)}
                    </Link>
                    <p className="text-xs text-slate-400">{c.id}</p>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.phase.toUpperCase()} />
                  </td>
                  <td className="px-5 py-3 tabular-nums">{c.estimatedRecipients}</td>
                  <td className="px-5 py-3 font-medium tabular-nums text-emerald-700">
                    {c.sentCount}
                  </td>
                  <td className="px-5 py-3 font-medium tabular-nums text-red-700">
                    {c.failedCount}
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

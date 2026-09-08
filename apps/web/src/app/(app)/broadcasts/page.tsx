'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRelative } from '@/lib/utils';
import { messages } from '@/i18n/en';

type BroadcastRow = {
  id: string;
  name: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  sendingCount: number;
  queuedCount: number;
  createdAt: string;
  template: { title: string };
  page: { name: string };
};

export default function BroadcastsPage() {
  const [data, setData] = useState<BroadcastRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await api<{ data: BroadcastRow[] }>('/api/broadcasts');
        if (!cancelled) setData(r.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    refresh();
    const t = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading) return <LoadingState label="Loading broadcasts..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Broadcasts</h1>
          <p className="text-sm text-slate-500">
            Live Sent / Failed counts refresh automatically while a broadcast is running
          </p>
        </div>
        <Link href="/broadcasts/new" className="btn-primary">
          + {messages.actions.createBroadcast}
        </Link>
      </div>

      {data.length === 0 ? (
        <EmptyState
          title={messages.empty.broadcasts}
          action={
            <Link href="/broadcasts/new" className="btn-primary">
              {messages.actions.createBroadcast}
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Template</th>
                <th className="px-5 py-3">Page</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Sent</th>
                <th className="px-5 py-3">Failed</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => {
                const live = b.status === 'QUEUED' || b.status === 'RUNNING';
                return (
                  <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/broadcasts/${b.id}`} className="font-medium text-primary">
                        {b.name}
                      </Link>
                      {live ? (
                        <p className="mt-0.5 text-xs text-blue-600">
                          {b.sendingCount > 0
                            ? `Sending ${b.sendingCount}…`
                            : `${b.queuedCount} waiting`}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">{b.template.title}</td>
                    <td className="px-5 py-3">{b.page.name}</td>
                    <td className="px-5 py-3 tabular-nums">{b.totalRecipients}</td>
                    <td className="px-5 py-3 font-medium tabular-nums text-emerald-700">
                      {b.sentCount}
                    </td>
                    <td className="px-5 py-3 font-medium tabular-nums text-red-700">
                      {b.failedCount}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-5 py-3 text-slate-500">{formatRelative(b.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

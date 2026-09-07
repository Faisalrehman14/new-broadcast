'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRelative } from '@/lib/utils';
import { messages } from '@/i18n/en';

export default function BroadcastsPage() {
  const [data, setData] = useState<
    Array<{
      id: string;
      name: string;
      status: string;
      totalRecipients: number;
      deliveredCount: number;
      failedCount: number;
      createdAt: string;
      template: { title: string };
      page: { name: string };
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ data: typeof data }>('/api/broadcasts')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="Loading broadcasts..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Broadcasts</h1>
          <p className="text-sm text-slate-500">Create and monitor customer broadcasts</p>
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
                <th className="px-5 py-3">Recipients</th>
                <th className="px-5 py-3">Delivered</th>
                <th className="px-5 py-3">Failed</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/broadcasts/${b.id}`} className="font-medium text-primary">
                      {b.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{b.template.title}</td>
                  <td className="px-5 py-3">{b.page.name}</td>
                  <td className="px-5 py-3">{b.totalRecipients}</td>
                  <td className="px-5 py-3">{b.deliveredCount}</td>
                  <td className="px-5 py-3">{b.failedCount}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-5 py-3 text-slate-500">{formatRelative(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

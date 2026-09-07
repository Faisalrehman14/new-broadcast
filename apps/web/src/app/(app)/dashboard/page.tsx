'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { KpiCard } from '@/components/KpiCard';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, LoadingState } from '@/components/EmptyState';
import { formatRelative } from '@/lib/utils';
import { messages } from '@/i18n/en';

type Dashboard = {
  kpis: {
    totalContacts: number;
    activeContacts: number;
    broadcastsSent: number;
    delivered: number;
    failed: number;
    responseRate: number;
  };
  lastSyncedAt: string | null;
  pages: Array<{ pageId: string; name: string; contactCount: number }>;
  recentBroadcasts: Array<{
    id: string;
    name: string;
    status: string;
    totalRecipients: number;
    deliveredCount: number;
    failedCount: number;
    createdAt: string;
    template: { title: string };
  }>;
  activity: Array<{ id: string; action: string; createdAt: string; resource: string }>;
};

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    const d = await api<Dashboard>('/api/dashboard');
    setData(d);
  }

  useEffect(() => {
    load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  async function syncNow() {
    if (!data?.pages[0]) return;
    setSyncing(true);
    try {
      await api('/api/contacts/sync', {
        method: 'POST',
        body: JSON.stringify({ pageId: data.pages[0].pageId }),
      });
      await load();
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <LoadingState label="Loading dashboard..." />;
  if (!data) return <EmptyState title="Unable to load dashboard" />;

  if (!data.pages.length) {
    return (
      <EmptyState
        title={messages.empty.pages}
        description="Connect Facebook and select a Page to sync customers."
        action={
          <Link href="/connect" className="btn-primary">
            {messages.actions.connectFacebook}
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Last synced: {formatRelative(data.lastSyncedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={syncNow} disabled={syncing}>
            {syncing ? 'Syncing...' : messages.actions.syncNow}
          </button>
          <Link href="/broadcasts/new" className="btn-primary">
            {messages.actions.createBroadcast}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label="Total Contacts" value={data.kpis.totalContacts} />
        <KpiCard label="Active Contacts" value={data.kpis.activeContacts} />
        <KpiCard label="Broadcasts Sent" value={data.kpis.broadcastsSent} />
        <KpiCard label="Delivered" value={data.kpis.delivered} />
        <KpiCard label="Failed" value={data.kpis.failed} />
        <KpiCard
          label="Response Rate"
          value={`${Math.round(data.kpis.responseRate * 100)}%`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card xl:col-span-2 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold">Recent broadcasts</h2>
          </div>
          {data.recentBroadcasts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={messages.empty.broadcasts}
                action={
                  <Link href="/broadcasts/new" className="btn-primary">
                    {messages.actions.createBroadcast}
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Broadcast</th>
                    <th className="px-5 py-3">Template</th>
                    <th className="px-5 py-3">Recipients</th>
                    <th className="px-5 py-3">Delivered</th>
                    <th className="px-5 py-3">Failed</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentBroadcasts.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="px-5 py-3 font-medium">{b.name}</td>
                      <td className="px-5 py-3 text-slate-500">{b.template.title}</td>
                      <td className="px-5 py-3">{b.totalRecipients}</td>
                      <td className="px-5 py-3">{b.deliveredCount}</td>
                      <td className="px-5 py-3">{b.failedCount}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="px-5 py-3 text-slate-500">{formatRelative(b.createdAt)}</td>
                      <td className="px-5 py-3">
                        <Link href={`/broadcasts/${b.id}`} className="text-primary hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold">Recent activity</h2>
          <ul className="mt-4 space-y-3">
            {data.activity.length === 0 ? (
              <li className="text-sm text-slate-500">No activity yet.</li>
            ) : (
              data.activity.map((a) => (
                <li key={a.id} className="border-b border-slate-50 pb-3 text-sm last:border-0">
                  <p className="font-medium text-slate-800">{a.action}</p>
                  <p className="text-xs text-slate-400">
                    {a.resource} · {formatRelative(a.createdAt)}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

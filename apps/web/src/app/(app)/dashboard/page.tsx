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

  const deliveryRate =
    data.kpis.delivered + data.kpis.failed > 0
      ? Math.round(
          (data.kpis.delivered / (data.kpis.delivered + data.kpis.failed)) * 100
        )
      : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hero composition */}
      <section className="relative overflow-hidden rounded-3xl border border-ink/8 bg-ink text-white shadow-lift">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(700px 320px at 12% 0%, rgba(15,118,110,0.45), transparent 55%), radial-gradient(500px 280px at 90% 100%, rgba(45,212,191,0.12), transparent 50%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6 px-6 py-7 md:px-8 md:py-8">
          <div className="max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300/90">
              CastMe Pro
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Your broadcast command center
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              {data.kpis.activeContacts.toLocaleString()} reachable leads across{' '}
              {data.pages.length} page{data.pages.length === 1 ? '' : 's'} · last synced{' '}
              {formatRelative(data.lastSyncedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              onClick={syncNow}
              disabled={syncing}
            >
              {syncing ? 'Syncing…' : messages.actions.syncNow}
            </button>
            <Link
              href="/broadcasts/new"
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-600"
            >
              {messages.actions.createBroadcast}
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          accent
          label="Reachable leads"
          value={data.kpis.activeContacts.toLocaleString()}
          hint={`${data.kpis.totalContacts.toLocaleString()} total synced`}
        />
        <KpiCard
          label="Campaigns sent"
          value={data.kpis.broadcastsSent.toLocaleString()}
        />
        <KpiCard
          label="Delivered"
          value={data.kpis.delivered.toLocaleString()}
          hint={`${deliveryRate}% of attempted`}
        />
        <KpiCard
          label="Response rate"
          value={`${Math.round(data.kpis.responseRate * 100)}%`}
          hint={
            data.kpis.failed
              ? `${data.kpis.failed.toLocaleString()} failed`
              : 'Healthy delivery'
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-ink/5 px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold text-ink">
                Recent campaigns
              </h2>
              <p className="text-xs text-slate-500">Latest sends across your Pages</p>
            </div>
            <Link href="/broadcasts" className="text-xs font-semibold text-primary hover:underline">
              View all
            </Link>
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
            <ul className="divide-y divide-ink/5">
              {data.recentBroadcasts.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/broadcasts/${b.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-mist/80"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{b.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {b.template.title} · {formatRelative(b.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="tabular-nums text-slate-600">
                        {b.deliveredCount.toLocaleString()}
                        <span className="text-slate-400">
                          /{b.totalRecipients.toLocaleString()}
                        </span>
                      </span>
                      <StatusBadge status={b.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-display text-base font-semibold text-ink">Activity</h2>
          <p className="text-xs text-slate-500">Workspace events</p>
          <ul className="mt-4 space-y-3">
            {data.activity.length === 0 ? (
              <li className="text-sm text-slate-500">No activity yet.</li>
            ) : (
              data.activity.slice(0, 8).map((a) => (
                <li
                  key={a.id}
                  className="border-b border-ink/5 pb-3 text-sm last:border-0 last:pb-0"
                >
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

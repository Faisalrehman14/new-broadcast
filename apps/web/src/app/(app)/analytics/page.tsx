'use client';

import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { KpiCard } from '@/components/KpiCard';
import { LoadingState } from '@/components/EmptyState';

type Overview = {
  kpis: {
    totalBroadcasts: number;
    totalRecipients: number;
    messagesSent: number;
    deliveryRate: number;
    failureRate: number;
    skipRate: number;
    activeContacts: number;
    blockedContacts: number;
    newContacts: number;
  };
  series: {
    broadcastVolume: Array<{
      date: string;
      sent: number;
      delivered: number;
      failed: number;
      skipped?: number;
      name: string;
    }>;
    contactGrowth: Array<{ date: string; count: number }>;
  };
};

export default function AnalyticsPage() {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api<Overview>(`/api/analytics/overview?range=${range}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [range]);

  if (loading && !data) return <LoadingState label="Loading analytics…" />;

  const chartData =
    data?.series.broadcastVolume.map((b) => ({
      name: new Date(b.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      sent: b.sent,
      failed: b.failed,
      skipped: b.skipped || 0,
    })) || [];

  const growthData =
    data?.series.contactGrowth.map((c) => ({
      name: new Date(c.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      count: c.count,
    })) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-sub">Campaign delivery health and reachable audience growth</p>
        </div>
        <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-1">
          {[
            { id: '7d', label: '7 days' },
            { id: '30d', label: '30 days' },
            { id: '90d', label: '90 days' },
          ].map((r) => (
            <button
              key={r.id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                range === r.id ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Campaigns" value={data.kpis.totalBroadcasts} />
            <KpiCard label="Messages delivered" value={data.kpis.messagesSent} />
            <KpiCard
              label="Delivery rate"
              value={`${Math.round(data.kpis.deliveryRate * 100)}%`}
            />
            <KpiCard
              label="Skip / block rate"
              value={`${Math.round(data.kpis.skipRate * 100)}%`}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Reachable leads" value={data.kpis.activeContacts} />
            <KpiCard label="Blocked (excluded)" value={data.kpis.blockedContacts} />
            <KpiCard label="New contacts in range" value={data.kpis.newContacts} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="mb-1 font-semibold text-slate-900">Campaign volume</h2>
              <p className="mb-4 text-xs text-slate-500">Delivered vs failed vs skipped</p>
              <div className="h-64">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="sent" name="Delivered" fill="#2563EB" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="failed" name="Failed" fill="#DC2626" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="skipped" name="Skipped" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No campaigns in this range yet.
                  </div>
                )}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="mb-1 font-semibold text-slate-900">Audience growth</h2>
              <p className="mb-4 text-xs text-slate-500">New Messenger contacts discovered</p>
              <div className="h-64">
                {growthData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={growthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="New contacts"
                        stroke="#0EA5E9"
                        fill="#E0F2FE"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No new contacts in this range.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

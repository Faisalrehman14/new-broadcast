'use client';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { KpiCard } from '@/components/KpiCard';
import { LoadingState } from '@/components/EmptyState';

export default function AnalyticsPage() {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState<{
    kpis: {
      totalBroadcasts: number;
      totalRecipients: number;
      messagesSent: number;
      deliveryRate: number;
      failureRate: number;
      responseRate: number;
    };
    series: {
      broadcastVolume: Array<{ date: string; sent: number; delivered: number; failed: number; name: string }>;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<typeof data>(`/api/analytics/overview?range=${range}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [range]);

  if (loading || !data) return <LoadingState label="Loading analytics..." />;

  const chartData = data.series.broadcastVolume.map((b) => ({
    name: new Date(b.date).toLocaleDateString(),
    sent: b.sent,
    delivered: b.delivered,
    failed: b.failed,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-slate-500">Delivery, engagement, and growth</p>
        </div>
        <div className="flex gap-2">
          {['7d', '30d', '90d'].map((r) => (
            <button
              key={r}
              type="button"
              className={range === r ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Total broadcasts" value={data.kpis.totalBroadcasts} />
        <KpiCard label="Total recipients" value={data.kpis.totalRecipients} />
        <KpiCard label="Messages sent" value={data.kpis.messagesSent} />
        <KpiCard label="Delivery rate" value={`${Math.round(data.kpis.deliveryRate * 100)}%`} />
        <KpiCard label="Failure rate" value={`${Math.round(data.kpis.failureRate * 100)}%`} />
        <KpiCard label="Response rate" value={`${Math.round(data.kpis.responseRate * 100)}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Broadcast volume</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="sent" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Delivery vs failure</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="delivered" stroke="#16A34A" strokeWidth={2} />
                <Line type="monotone" dataKey="failed" stroke="#DC2626" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

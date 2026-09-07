'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';

type PageRow = {
  platformPageId: string;
  name: string;
  profileImage?: string;
  connectionStatus: string;
  contactCount: number;
  connected: boolean;
  pageId?: string | null;
};

export default function SelectPagesPage() {
  const router = useRouter();
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [syncJobs, setSyncJobs] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, { processed: number; total: number; status: string }>>({});

  useEffect(() => {
    api<{ pages: PageRow[]; connected: boolean }>('/api/facebook/pages')
      .then((r) => {
        if (!r.connected) {
          router.replace('/connect');
          return;
        }
        setPages(r.pages);
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const ids = Object.values(syncJobs);
    if (!ids.length) return;
    const t = setInterval(async () => {
      for (const [platformId, jobId] of Object.entries(syncJobs)) {
        const job = await api<{
          processedCount: number;
          totalEstimated: number;
          status: string;
        }>(`/api/contacts/sync/${jobId}`);
        setProgress((p) => ({
          ...p,
          [platformId]: {
            processed: job.processedCount,
            total: job.totalEstimated,
            status: job.status,
          },
        }));
      }
    }, 1500);
    return () => clearInterval(t);
  }, [syncJobs]);

  async function connectSelected() {
    setConnecting(true);
    try {
      const res = await api<{
        results: Array<{ pageId: string; syncJobId?: string; status: string }>;
      }>('/api/facebook/pages/connect', {
        method: 'POST',
        body: JSON.stringify({ pageIds: selected }),
      });
      const map: Record<string, string> = {};
      res.results.forEach((r, i) => {
        if (r.syncJobId && selected[i]) map[selected[i]!] = r.syncJobId;
      });
      // Map by matching platform ids from selection order in results — better remap:
      const refreshed = await api<{ pages: PageRow[] }>('/api/facebook/pages');
      setPages(refreshed.pages);
      for (const r of res.results) {
        if (r.syncJobId) {
          const page = refreshed.pages.find((p) => p.pageId === r.pageId);
          if (page) map[page.platformPageId] = r.syncJobId;
        }
      }
      setSyncJobs(map);
      setTimeout(() => router.push('/dashboard'), 4000);
    } finally {
      setConnecting(false);
    }
  }

  if (loading) return <LoadingState label="Loading Pages..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Select Pages to Connect</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose one or more Facebook Pages. Contact sync starts in the background.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pages.map((p) => {
          const prog = progress[p.platformPageId];
          const checked = selected.includes(p.platformPageId);
          return (
            <div key={p.platformPageId} className="card p-5">
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}`}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-slate-400">ID {p.platformPageId}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    {p.contactCount.toLocaleString()} contacts
                  </p>
                  <div className="mt-2">
                    <StatusBadge status={p.connected ? p.connectionStatus : 'DRAFT'} />
                  </div>
                </div>
              </div>
              {prog ? (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="font-medium">Syncing your customers...</p>
                  <p className="mt-1 text-slate-500">
                    {prog.processed.toLocaleString()} / {(prog.total || prog.processed).toLocaleString()}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((prog.processed / Math.max(prog.total || 1, 1)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {!p.connected ? (
                <label className="mt-4 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, p.platformPageId]
                          : s.filter((id) => id !== p.platformPageId)
                      );
                    }}
                  />
                  Select to connect
                </label>
              ) : (
                <p className="mt-4 text-sm text-emerald-600">Connected</p>
              )}
            </div>
          );
        })}
      </div>

      <button
        className="btn-primary"
        disabled={!selected.length || connecting}
        onClick={connectSelected}
      >
        {connecting ? 'Connecting...' : `Connect ${selected.length || ''} Page(s)`}
      </button>
    </div>
  );
}

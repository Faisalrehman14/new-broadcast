'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api, apiUrl } from '@/lib/api';
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
  source?: 'meta' | 'db';
  hasLivePageToken?: boolean;
};

function SelectPagesInner() {
  const router = useRouter();
  const search = useSearchParams();
  const warn = search.get('warn');
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [syncJobs, setSyncJobs] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, { processed: number; total: number; status: string }>>({});
  const [metaPageCount, setMetaPageCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api<{
      pages: PageRow[];
      connected: boolean;
      metaPageCount?: number;
      metaError?: string | null;
    }>('/api/facebook/pages')
      .then((r) => {
        if (!r.connected) {
          router.replace('/connect');
          return;
        }
        setPages(r.pages);
        setMetaPageCount(typeof r.metaPageCount === 'number' ? r.metaPageCount : r.pages.length);
        if (r.metaError) setLoadError(r.metaError);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load Pages');
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
    setLoadError('');
    try {
      const res = await api<{
        results: Array<{ pageId: string; syncJobId?: string; status: string }>;
      }>('/api/facebook/pages/connect', {
        method: 'POST',
        body: JSON.stringify({ pageIds: selected }),
      });
      const map: Record<string, string> = {};
      const refreshed = await api<{ pages: PageRow[]; metaPageCount?: number }>('/api/facebook/pages');
      setPages(refreshed.pages);
      setMetaPageCount(
        typeof refreshed.metaPageCount === 'number' ? refreshed.metaPageCount : refreshed.pages.length
      );
      for (const r of res.results) {
        if (r.syncJobId) {
          const page = refreshed.pages.find((p) => p.pageId === r.pageId);
          if (page) map[page.platformPageId] = r.syncJobId;
        }
      }
      setSyncJobs(map);
      setTimeout(() => router.push('/dashboard'), 4000);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Could not connect Pages. Reconnect Facebook and tick every Page in the picker.'
      );
    } finally {
      setConnecting(false);
    }
  }

  if (loading) return <LoadingState label="Loading Pages..." />;

  const metaEmpty = metaPageCount === 0;
  const fromDbOnly = pages.length > 0 && pages.every((p) => p.source === 'db');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Select Pages to Connect</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose one or more Facebook Pages. Contact sync starts in the background.
        </p>
      </div>

      {warn === 'no_pages' || metaEmpty || fromDbOnly ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Facebook login succeeded, but Meta returned <strong>no Pages</strong> for this token (picker
          empty / Business not selected). Click{' '}
          <a className="font-semibold underline" href={apiUrl('/api/facebook/connect')}>
            Connect Facebook
          </a>{' '}
          again → select your Business → tick <strong>every</strong> Page → allow Utility Messaging →
          Continue. Previously linked Pages are listed below so the app is not blank.
        </div>
      ) : null}

      {warn === 'short_token' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Connected with a short-lived token. Reconnect soon, or verify <code>META_APP_SECRET</code> on
          Railway.
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      ) : null}

      {!pages.length ? (
        <div className="card p-8 text-center text-sm text-slate-600">
          <p className="font-medium text-slate-900">No Pages available yet</p>
          <p className="mt-2">
            Reconnect and tick every Page in the Facebook permission dialog, then return here.
          </p>
          <a href={apiUrl('/api/facebook/connect')} className="btn-primary mt-4 inline-flex">
            Connect Facebook again
          </a>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pages.map((p) => {
            const prog = progress[p.platformPageId];
            const checked = selected.includes(p.platformPageId);
            const canSelect = p.source !== 'db' || Boolean(p.hasLivePageToken);
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
                    {p.source === 'db' ? (
                      <p className="mt-2 text-xs text-amber-700">
                        Saved Page — Meta did not return a fresh token. Reconnect with this Page ticked.
                      </p>
                    ) : null}
                  </div>
                </div>
                {prog ? (
                  <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-medium">Syncing your customers...</p>
                    <p className="mt-1 text-slate-500">
                      {prog.processed.toLocaleString()} /{' '}
                      {(prog.total || prog.processed).toLocaleString()}
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
                      disabled={!canSelect}
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
                  <p className="mt-4 text-sm text-emerald-600">
                    {p.hasLivePageToken === false ? 'Connected (token may be stale)' : 'Connected'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          className="btn-primary"
          disabled={!selected.length || connecting}
          onClick={connectSelected}
        >
          {connecting ? 'Connecting...' : `Connect ${selected.length || ''} Page(s)`}
        </button>
        <a href={apiUrl('/api/facebook/connect')} className="btn-secondary inline-flex">
          Reconnect Facebook
        </a>
      </div>
    </div>
  );
}

export default function SelectPagesPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading Pages..." />}>
      <SelectPagesInner />
    </Suspense>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';

type TemplateRow = {
  id: string;
  title: string;
  metaName: string;
  category: string;
  source: string;
  bodyStatus: string;
  status: string;
  body: string | null;
  isCustom: boolean;
  approvals: Array<{ pageId: string; status: string }>;
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [pages, setPages] = useState<Array<{ pageId: string; name: string }>>([]);
  const [pageId, setPageId] = useState('');
  const [tab, setTab] = useState('PAGEINTERACT');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load(selectedPageId?: string) {
    const pid = selectedPageId ?? pageId;
    const [me, tpl] = await Promise.all([
      api<{ pages: Array<{ pageId: string; name: string }> }>('/api/auth/me'),
      api<{ templates: TemplateRow[] }>(
        `/api/templates${pid ? `?pageId=${encodeURIComponent(pid)}` : ''}`
      ),
    ]);
    setPages(me.pages);
    if (!pageId && me.pages[0]?.pageId) setPageId(me.pages[0].pageId);
    setTemplates(tpl.templates);
  }

  useEffect(() => {
    load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pageId) return;
    api<{ templates: TemplateRow[] }>(`/api/templates?pageId=${encodeURIComponent(pageId)}`)
      .then((r) => setTemplates(r.templates))
      .catch(() => undefined);
  }, [pageId]);

  if (loading) return <LoadingState label="Loading templates..." />;

  const filtered = templates.filter((t) => {
    if (tab === 'CUSTOM') return t.isCustom || t.source === 'CUSTOM';
    return t.source === tab;
  });

  const readyCount = templates.filter(
    (t) => !t.isCustom && t.bodyStatus === 'ready' && t.body
  ).length;
  const approvedForPage = templates.filter(
    (t) => !t.isCustom && t.approvals.some((a) => a.pageId === pageId && a.status === 'APPROVED')
  ).length;

  async function activateAll() {
    if (!pageId) {
      setMessage('Connect a Facebook Page first.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const res = await api<{ activated: number; message: string }>('/api/templates/activate-for-page', {
        method: 'POST',
        body: JSON.stringify({ pageId }),
      });
      setMessage(res.message || `${res.activated} templates ready.`);
      await load(pageId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="text-sm text-slate-500">
            Messenger library templates — activate once per Page, then broadcast immediately.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="tpl-page">
              Page
            </label>
            <select
              id="tpl-page"
              className="input min-w-[200px]"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
            >
              {!pages.length ? <option value="">No pages connected</option> : null}
              {pages.map((p) => (
                <option key={p.pageId} value={p.pageId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-primary" disabled={busy || !pageId} onClick={activateAll}>
            {busy ? 'Activating...' : 'Approve all for this Page'}
          </button>
          <Link className="btn-secondary" href="/broadcasts/new">
            Create broadcast
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {approvedForPage}/{readyCount} ready templates approved for this Page. Facebook Messenger
        does not require WhatsApp-style Meta review — CastMe Pro activates compliant library
        templates so you can send like production Messenger broadcast tools.
      </div>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      <div className="flex gap-2">
        {[
          ['PAGEINTERACT', 'Core PageInteract'],
          ['LIBRARY', 'Library Extras'],
          ['CUSTOM', 'Custom'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => {
          const pageStatus =
            t.approvals.find((a) => a.pageId === pageId)?.status ||
            (t.isCustom ? 'DRAFT' : t.status);
          return (
            <div key={t.id} className="card p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-xs text-slate-400">{t.metaName}</p>
                </div>
                <StatusBadge status={pageStatus} />
              </div>
              <p className="mt-2 text-xs text-slate-500">{t.category}</p>
              {t.bodyStatus === 'requires_import' ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  body_status = requires_import — use admin JSON import
                </p>
              ) : (
                <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
                  {t.body}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

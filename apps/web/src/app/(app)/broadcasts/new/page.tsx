'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { STARTER_COPY } from './starters';

type PageRow = {
  pageId: string;
  name: string;
  contactCount: number;
  hasPageToken?: boolean;
  status: string;
};

type Starter = {
  id: string;
  name: string;
  title: string;
  body: string;
  parameters: string[];
};

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [hasLiveToken, setHasLiveToken] = useState(true);
  const [quota, setQuota] = useState<number | null>(null);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [mode, setMode] = useState<'starter' | 'custom'>('custom');
  const [starterName, setStarterName] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [speed, setSpeed] = useState<'safe' | 'fast' | 'turbo'>('safe');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    Promise.all([
      api<{
        pages: PageRow[];
        hasLiveToken?: boolean;
        quota?: { creditsRemaining: number };
      }>('/api/auth/me'),
      api<{ starters: Starter[] }>('/api/broadcast/templates'),
      api<{ pages: Array<{ page_id: string; contact_count: number }> }>(
        '/api/broadcast/audience/status'
      ),
    ])
      .then(([me, tpl, audience]) => {
        const counts = new Map(audience.pages.map((p) => [p.page_id, p.contact_count]));
        const rows = me.pages.map((p) => ({
          ...p,
          contactCount: counts.get(p.pageId) ?? p.contactCount ?? 0,
        }));
        setPages(rows);
        setSelected(rows.filter((p) => p.hasPageToken !== false).map((p) => p.pageId));
        setHasLiveToken(me.hasLiveToken !== false);
        setQuota(me.quota?.creditsRemaining ?? null);
        setStarters(tpl.starters || STARTER_COPY);
        if (tpl.starters?.[0]) setStarterName(tpl.starters[0].name);
      })
      .finally(() => setLoading(false));
  }, []);

  const estimated = useMemo(
    () => pages.filter((p) => selected.includes(p.pageId)).reduce((s, p) => s + (p.contactCount || 0), 0),
    [pages, selected]
  );

  const canSend =
    hasLiveToken &&
    selected.length > 0 &&
    (mode === 'custom' ? Boolean(message.trim() || imageUrl.trim()) : Boolean(starterName));

  async function syncSelected() {
    setBusy(true);
    setError('');
    try {
      for (const pageId of selected) {
        await api('/api/broadcast/audience/sync', {
          method: 'POST',
          body: JSON.stringify({ page_id: pageId }),
        });
      }
      setToast('Audience sync started for selected pages.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function prepareTemplates() {
    setBusy(true);
    setError('');
    try {
      for (const pageId of selected) {
        await api('/api/broadcast/prepare-starter-pack', {
          method: 'POST',
          body: JSON.stringify({ page_id: pageId }),
        });
      }
      setToast('UTILITY starter templates prepared on selected pages.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prepare failed');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setError('');
    try {
      const starter = starters.find((s) => s.name === starterName);
      const res = await api<{
        success: boolean;
        campaignId: string;
        estimatedRecipients: number;
      }>('/api/broadcast/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          pages: selected.map((id) => {
            const p = pages.find((x) => x.pageId === id);
            return { id, name: p?.name };
          }),
          message: mode === 'custom' ? message : undefined,
          image_url: imageUrl || undefined,
          speed_preset: speed,
          delivery_mode: mode === 'custom' ? 'freeform_plain' : 'named_utility',
          utility_template:
            mode === 'starter' && starter
              ? {
                  id: starter.id,
                  name: starter.name,
                  body: starter.body,
                  language: 'en_US',
                  parameters: starter.parameters,
                }
              : undefined,
        }),
      });
      setToast(
        `Campaign ${res.campaignId.slice(0, 8)}… queued · ~${res.estimatedRecipients} recipients`
      );
      router.push(`/broadcasts/${res.campaignId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading campaign builder..." />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New campaign</h1>
        <p className="text-sm text-slate-500">
          Select Pages → sync audience → pick UTILITY template or custom text → Send
        </p>
      </div>

      {!hasLiveToken ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Session expired / Reconnect required — Facebook is connected but no live token. Reconnect
          before sending.
        </div>
      ) : null}

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">1. Pages</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {pages.map((p) => (
            <label key={p.pageId} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <input
                type="checkbox"
                checked={selected.includes(p.pageId)}
                onChange={(e) => {
                  setSelected((prev) =>
                    e.target.checked ? [...prev, p.pageId] : prev.filter((id) => id !== p.pageId)
                  );
                }}
              />
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {p.contactCount} contacts · {p.hasPageToken === false ? 'no token' : 'token ok'}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={busy || !selected.length} onClick={syncSelected}>
            Sync audience
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !selected.length}
            onClick={prepareTemplates}
          >
            Prepare UTILITY starters
          </button>
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">2. Message</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className={mode === 'custom' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('custom')}
          >
            Custom / freeform
          </button>
          <button
            type="button"
            className={mode === 'starter' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('starter')}
          >
            UTILITY starter
          </button>
        </div>
        {mode === 'custom' ? (
          <>
            <textarea
              className="input min-h-[140px]"
              placeholder="Message text (outside 24h wraps as plain UTILITY {{1}})"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <input
              className="input"
              placeholder="Optional image URL"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </>
        ) : (
          <select className="input" value={starterName} onChange={(e) => setStarterName(e.target.value)}>
            {starters.map((s) => (
              <option key={s.name} value={s.name}>
                {s.title} ({s.name})
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">3. Speed</h2>
        <div className="flex flex-wrap gap-2">
          {(['safe', 'fast', 'turbo'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={speed === s ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setSpeed(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-600">
          ~{estimated.toLocaleString()} recipients
          {quota !== null ? ` · ${quota.toLocaleString()} credits left` : ''}
        </p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {toast ? <p className="text-sm text-emerald-700">{toast}</p> : null}
        <button className="btn-primary" disabled={!canSend || busy} onClick={send}>
          {busy ? 'Starting…' : 'Send campaign'}
        </button>
      </section>
    </div>
  );
}

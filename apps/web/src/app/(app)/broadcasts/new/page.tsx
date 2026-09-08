'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import {
  CUSTOM_STARTER,
  SPEED_PRESETS,
  fillTemplateBody,
  isNameLabel,
  mergeStarters,
  type StarterTemplate,
} from './starters';

type PageRow = {
  pageId: string;
  name: string;
  contactCount: number;
  hasPageToken?: boolean;
  status: string;
};

type SpeedId = (typeof SPEED_PRESETS)[number]['id'];

const STEPS = [
  { id: 1, label: 'Pages' },
  { id: 2, label: 'Template' },
  { id: 3, label: 'Review & send' },
] as const;

function defaultSlots(tpl: StarterTemplate): string[] {
  return tpl.labels.map((label, i) => {
    if (isNameLabel(label)) return '{{first_name}}';
    return tpl.examples[i] || '';
  });
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [pageSearch, setPageSearch] = useState('');
  const [hasLiveToken, setHasLiveToken] = useState(true);
  const [quota, setQuota] = useState<number | null>(null);
  const [starters, setStarters] = useState<StarterTemplate[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState('All');
  const [librarySearch, setLibrarySearch] = useState('');
  const [editing, setEditing] = useState<StarterTemplate | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [mode, setMode] = useState<'starter' | 'custom'>('custom');
  const [applied, setApplied] = useState<StarterTemplate | null>(null);
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [speed, setSpeed] = useState<SpeedId>('balanced');
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
      api<{
        starters: Array<Partial<StarterTemplate> & { id: string; name: string; title: string; body: string }>;
      }>('/api/broadcast/templates'),
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
        setStarters(mergeStarters(tpl.starters || []));
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredPages = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.name.toLowerCase().includes(q));
  }, [pages, pageSearch]);

  const estimated = useMemo(
    () => pages.filter((p) => selected.includes(p.pageId)).reduce((s, p) => s + (p.contactCount || 0), 0),
    [pages, selected]
  );

  const previewText = useMemo(() => {
    if (mode === 'custom') return message;
    if (!applied) return '';
    return fillTemplateBody(applied.body, slots.length ? slots : defaultSlots(applied));
  }, [mode, message, applied, slots]);

  const badges = useMemo(() => {
    const set = new Set(starters.map((s) => s.badge));
    return ['All', 'Custom', ...Array.from(set)];
  }, [starters]);

  const libraryItems = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    let list: StarterTemplate[] = [...starters];
    if (libraryFilter === 'Custom') list = [CUSTOM_STARTER];
    else if (libraryFilter !== 'All') list = list.filter((s) => s.badge === libraryFilter);
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q)
      );
    }
    if (libraryFilter === 'All') list = [CUSTOM_STARTER, ...list];
    return list;
  }, [starters, libraryFilter, librarySearch]);

  const canNextFrom1 = selected.length > 0 && hasLiveToken;
  const canNextFrom2 =
    mode === 'custom' ? Boolean(message.trim() || imageUrl.trim()) : Boolean(applied && previewText.trim());
  const canSend = canNextFrom1 && canNextFrom2;

  function openLibrary(preselect?: StarterTemplate) {
    const pick = preselect || editing || applied || starters[0] || CUSTOM_STARTER;
    setEditing(pick);
    setSlots(pick.id === 'custom' ? [message || pick.examples[0] || ''] : defaultSlots(pick));
    setLibraryOpen(true);
  }

  function selectLibraryItem(tpl: StarterTemplate) {
    setEditing(tpl);
    if (tpl.id === 'custom') {
      setSlots([message || tpl.examples[0] || '']);
    } else {
      setSlots(defaultSlots(tpl));
    }
  }

  async function warmTemplate(tpl: StarterTemplate) {
    if (tpl.id === 'custom' || !selected.length) return;
    try {
      for (const pageId of selected.slice(0, 5)) {
        await api('/api/broadcast/prepare-outside24h', {
          method: 'POST',
          body: JSON.stringify({
            page_id: pageId,
            template_name: tpl.name,
            body: tpl.body,
            language: 'en_US',
            example_values: tpl.examples.length ? tpl.examples : tpl.parameters,
          }),
        }).catch(() => undefined);
      }
    } catch {
      /* warm is best-effort */
    }
  }

  function applyEditing() {
    if (!editing) return;
    if (editing.id === 'custom') {
      const text = (slots[0] || '').trim();
      if (!text) {
        setError('Write your custom message before using it.');
        return;
      }
      setMode('custom');
      setApplied(null);
      setMessage(text);
      setLibraryOpen(false);
      setError('');
      setToast('Custom message applied.');
      setStep(3);
      return;
    }
    const values = editing.labels.map((_, i) => slots[i]?.trim() || editing.examples[i] || '');
    if (values.some((v) => !v)) {
      setError('Fill every template field before continuing.');
      return;
    }
    setMode('starter');
    setApplied(editing);
    setSlots(values);
    setMessage(fillTemplateBody(editing.body, values));
    setLibraryOpen(false);
    setError('');
    setToast(`Template “${editing.title}” applied.`);
    void warmTemplate(editing);
    setStep(3);
  }

  function insertToken(token: string) {
    if (mode === 'custom') {
      setMessage((m) => `${m}${m && !m.endsWith(' ') ? ' ' : ''}${token}`);
      return;
    }
    setSlots((prev) => {
      const next = [...prev];
      const idx = next.findIndex((_, i) => applied && isNameLabel(applied.labels[i] || ''));
      if (idx >= 0) next[idx] = token;
      else if (next.length) next[0] = token;
      return next;
    });
  }

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
      const audience = await api<{ pages: Array<{ page_id: string; contact_count: number }> }>(
        '/api/broadcast/audience/status'
      );
      const counts = new Map(audience.pages.map((p) => [p.page_id, p.contact_count]));
      setPages((prev) =>
        prev.map((p) => ({ ...p, contactCount: counts.get(p.pageId) ?? p.contactCount }))
      );
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

  function goNext() {
    setError('');
    if (step === 1) {
      if (!canNextFrom1) {
        setError(hasLiveToken ? 'Select at least one Page.' : 'Reconnect Facebook before sending.');
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!canNextFrom2) {
        setError('Pick a template or write a custom message.');
        openLibrary();
        return;
      }
      setStep(3);
    }
  }

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setError('');
    try {
      const rendered = previewText.trim();
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
          message: rendered || undefined,
          image_url: imageUrl || undefined,
          speed_preset: speed,
          delivery_mode: mode === 'custom' ? 'freeform_plain' : 'named_utility',
          utility_template:
            mode === 'starter' && applied
              ? {
                  id: applied.id,
                  name: applied.name,
                  body: applied.body,
                  language: 'en_US',
                  parameters: slots,
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

  const primaryPageName =
    pages.find((p) => selected.includes(p.pageId))?.name || pages[0]?.name || 'Your Page';

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-24">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">New Template Bulk Message</p>
        <h1 className="text-2xl font-semibold">Broadcast wizard</h1>
        <p className="text-sm text-slate-500">
          Select Pages → choose &amp; edit a template → review and send
        </p>
      </div>

      {!hasLiveToken ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Session expired / Reconnect required — Facebook account has no live user token (or Meta
          returned no Pages). Open Reconnect → tick every Page in the Facebook picker → Continue,
          then return here.
        </div>
      ) : null}

      <nav className="card flex flex-wrap gap-2 p-3">
        {STEPS.map((s) => {
          const active = step === s.id;
          const done = step > s.id;
          return (
            <button
              key={s.id}
              type="button"
              className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                active
                  ? 'bg-primary text-white'
                  : done
                    ? 'bg-blue-50 text-primary'
                    : 'bg-slate-50 text-slate-500'
              }`}
              onClick={() => {
                if (s.id < step) setStep(s.id);
                else if (s.id === 2 && canNextFrom1) setStep(2);
                else if (s.id === 3 && canNextFrom1 && canNextFrom2) setStep(3);
              }}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  active ? 'bg-white/20' : done ? 'bg-primary text-white' : 'bg-white text-slate-500'
                }`}
              >
                {s.id}
              </span>
              <span className="font-medium">{s.label}</span>
            </button>
          );
        })}
      </nav>

      {step === 1 ? (
        <section className="card space-y-4 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">1. Select Pages</h2>
              <p className="text-sm text-slate-500">
                {selected.length} of {pages.length} selected · ~{estimated.toLocaleString()} people
              </p>
            </div>
            <input
              className="input max-w-xs"
              placeholder="Search pages…"
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelected(filteredPages.map((p) => p.pageId))}
            >
              Select visible
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelected(pages.map((p) => p.pageId))}
            >
              Select all
            </button>
            <button type="button" className="btn-secondary" onClick={() => setSelected([])}>
              Clear
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !selected.length}
              onClick={syncSelected}
            >
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

          <div className="grid gap-2 sm:grid-cols-2">
            {filteredPages.map((p) => {
              const checked = selected.includes(p.pageId);
              return (
                <label
                  key={p.pageId}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    checked ? 'border-primary bg-blue-50/60' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={(e) => {
                      setSelected((prev) =>
                        e.target.checked ? [...prev, p.pageId] : prev.filter((id) => id !== p.pageId)
                      );
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {(p.contactCount || 0).toLocaleString()} contacts ·{' '}
                      {p.hasPageToken === false ? 'no token' : 'token ok'}
                    </span>
                  </span>
                </label>
              );
            })}
            {!filteredPages.length ? (
              <p className="col-span-full text-sm text-slate-500">No pages match your search.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="card space-y-4 p-6">
          <div>
            <h2 className="font-semibold">2. Choose &amp; edit template</h2>
            <p className="text-sm text-slate-500">
              Browse the starter library, fill labeled fields, or write a custom freeform message.
            </p>
          </div>

          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl border border-dashed border-primary/40 bg-blue-50/50 px-4 py-4 text-left transition hover:bg-blue-50"
            onClick={() => openLibrary()}
          >
            <span>
              <span className="block font-semibold text-primary">Browse starter templates</span>
              <span className="text-sm text-slate-600">
                {applied
                  ? `Selected: ${applied.title}`
                  : mode === 'custom' && message
                    ? 'Custom message ready — click to change'
                    : 'Open library · edit slots · live preview'}
              </span>
            </span>
            <span className="btn-primary">Open library</span>
          </button>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="label">Message preview / edit</label>
              <textarea
                className="input min-h-[160px]"
                readOnly={mode === 'starter'}
                placeholder="Browse a starter template, or switch to Custom in the library…"
                value={previewText}
                onChange={(e) => {
                  if (mode === 'custom') setMessage(e.target.value);
                }}
              />
              {mode === 'starter' ? (
                <p className="text-xs text-slate-500">
                  Named UTILITY templates are edited via labeled fields in the library. Open library to
                  change slots.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {['{{first_name}}', '{{last_name}}', '{{full_name}}'].map((t) => (
                    <button key={t} type="button" className="btn-secondary text-xs" onClick={() => insertToken(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <div>
                <label className="label">Optional image URL</label>
                <input
                  className="input"
                  placeholder="https://…"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </div>
            </div>

            <MessengerPreview pageName={primaryPageName} text={previewText} imageUrl={imageUrl} />
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="card space-y-5 p-6">
          <div>
            <h2 className="font-semibold">3. Review &amp; send</h2>
            <p className="text-sm text-slate-500">Confirm audience, template, and speed — then start the campaign.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PreflightStat label="Pages" value={String(selected.length)} />
            <PreflightStat label="Audience" value={`~${estimated.toLocaleString()}`} />
            <PreflightStat
              label="Template"
              value={mode === 'custom' ? 'Custom / freeform' : applied?.title || '—'}
            />
            <PreflightStat
              label="Credits"
              value={quota !== null ? quota.toLocaleString() : '—'}
            />
          </div>

          <div>
            <label className="label">Send speed</label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {SPEED_PRESETS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`rounded-lg border px-3 py-3 text-left transition ${
                    speed === s.id
                      ? 'border-primary bg-blue-50 ring-2 ring-primary/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                  onClick={() => setSpeed(s.id)}
                >
                  <span className="block font-medium">{s.label}</span>
                  <span className="text-xs text-slate-500">{s.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Final message</p>
              <pre className="whitespace-pre-wrap text-sm text-slate-800">{previewText || '—'}</pre>
              {imageUrl ? <p className="mt-2 truncate text-xs text-slate-500">Image: {imageUrl}</p> : null}
            </div>
            <MessengerPreview pageName={primaryPageName} text={previewText} imageUrl={imageUrl} />
          </div>
        </section>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {toast ? <p className="text-sm text-emerald-700">{toast}</p> : null}

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 lg:pl-72">
          <button
            type="button"
            className="btn-secondary"
            disabled={step === 1 || busy}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
          >
            Back
          </button>
          <div className="flex gap-2">
            {step < 3 ? (
              <button type="button" className="btn-primary" disabled={busy} onClick={goNext}>
                Next
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={!canSend || busy} onClick={send}>
                {busy ? 'Starting…' : 'Send campaign'}
              </button>
            )}
          </div>
        </div>
      </div>

      {libraryOpen && editing ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="font-semibold">Starter templates</h3>
                <p className="text-sm text-slate-500">Pick a template, edit fields, preview, then use it.</p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => setLibraryOpen(false)}>
                Close
              </button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_1fr]">
              <aside className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
                <input
                  className="input mb-3"
                  placeholder="Search templates…"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                />
                <div className="mb-3 flex flex-wrap gap-1">
                  {badges.map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        libraryFilter === b ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                      onClick={() => setLibraryFilter(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>
                <div className="max-h-[40vh] space-y-1 overflow-y-auto lg:max-h-[55vh]">
                  {libraryItems.map((tpl) => (
                    <button
                      key={tpl.id + tpl.name}
                      type="button"
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                        editing.name === tpl.name
                          ? 'bg-blue-50 text-primary ring-1 ring-primary/30'
                          : 'hover:bg-slate-50'
                      }`}
                      onClick={() => selectLibraryItem(tpl)}
                    >
                      <span className="block font-medium">{tpl.title}</span>
                      <span className="text-xs text-slate-500">
                        {tpl.badge} · {tpl.description || tpl.name}
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="grid min-h-0 gap-4 overflow-y-auto p-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold">{editing.title}</h4>
                    <p className="text-sm text-slate-500">{editing.description}</p>
                  </div>
                  {editing.labels.map((label, i) => (
                    <div key={`${editing.name}-${i}`}>
                      <label className="label">{label}</label>
                      <input
                        className="input"
                        value={slots[i] || ''}
                        placeholder={editing.examples[i] || label}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSlots((prev) => {
                            const next = [...prev];
                            next[i] = v;
                            return next;
                          });
                        }}
                      />
                      {isNameLabel(label) ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {['{{first_name}}', '{{last_name}}', '{{full_name}}'].map((t) => (
                            <button
                              key={t}
                              type="button"
                              className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                              onClick={() => {
                                setSlots((prev) => {
                                  const next = [...prev];
                                  next[i] = t;
                                  return next;
                                });
                              }}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <MessengerPreview
                  pageName={primaryPageName}
                  text={fillTemplateBody(editing.body, slots)}
                  imageUrl={imageUrl}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" className="btn-secondary" onClick={() => setLibraryOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={applyEditing}>
                Use this template
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreflightStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function MessengerPreview({
  pageName,
  text,
  imageUrl,
}: {
  pageName: string;
  text: string;
  imageUrl?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="overflow-hidden rounded-[1.75rem] border border-slate-800 bg-slate-900 shadow-lg">
        <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
            {(pageName[0] || 'P').toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{pageName}</p>
            <p className="text-[10px] text-slate-400">Messenger · preview</p>
          </div>
        </div>
        <div className="min-h-[220px] space-y-3 bg-[#eef2f7] p-4">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="max-h-36 w-full rounded-xl object-cover" />
          ) : null}
          <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm text-slate-800 shadow-sm">
            <p className="whitespace-pre-wrap break-words">
              {text.trim() || 'Your message preview will appear here.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

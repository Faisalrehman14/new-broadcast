'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import {
  CUSTOM_STARTER,
  SPEED_PRESETS,
  TEMPLATE_QUICK_CHIPS,
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
  utilityReady?: boolean;
  utilityStatus?: string;
};

type SpeedId = (typeof SPEED_PRESETS)[number]['id'];
type AudienceMode = 'all' | 'label' | 'pick';

function defaultSlots(tpl: StarterTemplate): string[] {
  return tpl.labels.map((label, i) => {
    if (isNameLabel(label)) return '{{first_name}}';
    return tpl.examples[i] || '';
  });
}

function MessengerPreview({
  pageName,
  text,
}: {
  pageName: string;
  text: string;
}) {
  return (
    <aside className="lg:sticky lg:top-6">
      <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Live Messenger Preview
      </p>
      <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border-[10px] border-slate-900 bg-slate-900 shadow-xl">
        <div className="overflow-hidden rounded-[1.35rem] bg-[#eef2f7]">
          <div className="flex items-center gap-2 bg-[#0084ff] px-3 py-2.5 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
              {(pageName || 'P').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{pageName || 'Your Page'}</p>
              <p className="text-[10px] text-white/80">Messenger</p>
            </div>
          </div>
          <div className="min-h-[280px] space-y-3 bg-[linear-gradient(180deg,#f4f7fb_0%,#e8eef6_100%)] p-3 pb-6 sm:min-h-[360px]">
            <div className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[#0084ff] px-3 py-2 text-[13px] leading-relaxed text-white shadow-sm">
                {text.trim() || 'Your message will appear here…'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function LibraryModal({
  open,
  items,
  editing,
  slots,
  busy,
  approveWait,
  libraryApproved,
  approvedPageCount,
  selectedCount,
  focusedSlot,
  error,
  onClose,
  onSelect,
  onSlotChange,
  onFocusSlot,
  onChip,
  onUseTemplate,
}: {
  open: boolean;
  items: StarterTemplate[];
  editing: StarterTemplate | null;
  slots: string[];
  busy: boolean;
  approveWait: string | null;
  libraryApproved: boolean;
  approvedPageCount: number;
  selectedCount: number;
  focusedSlot: number;
  error: string;
  onClose: () => void;
  onSelect: (tpl: StarterTemplate) => void;
  onSlotChange: (index: number, value: string) => void;
  onFocusSlot: (index: number) => void;
  onChip: (value: string) => void;
  onUseTemplate: () => void;
}) {
  if (!open) return null;

  const numbered = items.filter((t) => !t.instant && t.id !== 'custom');
  const instant = items.filter((t) => t.instant || t.id === 'custom');

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 pt-8 sm:p-4 sm:pt-12">
      <div className="relative mb-8 w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Choose from Library</h2>
            <p className="mt-1 text-sm text-amber-700">
              If this template has never been used on your page, approval usually takes{' '}
              <span className="font-semibold">30–60 seconds</span>. Please keep this window open.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="grid max-h-[min(78vh,820px)] gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-y-auto border-b border-slate-100 p-4 lg:border-b-0 lg:border-r">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Templates
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {numbered.map((tpl) => {
                const active = editing?.id === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onSelect(tpl)}
                    className={`rounded-xl border p-3 text-left transition ${
                      active
                        ? 'border-primary bg-blue-50/70 ring-1 ring-primary/30'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{tpl.title}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                        {tpl.badge || 'EN'}
                      </span>
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                      {tpl.body}
                    </p>
                  </button>
                );
              })}
            </div>

            {instant.length ? (
              <>
                <p className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Instant (shared plain UTILITY)
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {instant.map((tpl) => {
                    const active = editing?.id === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        disabled={busy}
                        onClick={() => onSelect(tpl)}
                        className={`rounded-xl border p-3 text-left transition ${
                          active
                            ? 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-400/40'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{tpl.title}</span>
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                            Instant
                          </span>
                        </div>
                        <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                          {tpl.body}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>

          <div className="relative overflow-y-auto p-4">
            {approveWait ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/90 px-6 text-center backdrop-blur-[1px]">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-sm font-semibold text-slate-800">Checking template approval…</p>
                <p className="text-sm text-slate-600">{approveWait}</p>
                <p className="text-xs text-amber-700">Working on this one… please wait.</p>
              </div>
            ) : null}

            {editing ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Selected
                  </p>
                  <h3 className="text-base font-semibold text-slate-900">{editing.title}</h3>
                  {libraryApproved ? (
                    <p className="mt-1 text-sm text-emerald-700">
                      Approved on {approvedPageCount || selectedCount} of {selectedCount} page
                      {selectedCount === 1 ? '' : 's'}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">
                      Click a card to sync &amp; approve on Meta.
                    </p>
                  )}
                </div>

                {libraryApproved ? (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-800">Fill the variables</p>
                    {editing.labels.map((label, i) => (
                      <label key={`${editing.id}-${i}`} className="block space-y-1">
                        <span className="text-xs font-medium text-slate-600">
                          BODY {`{{${i + 1}}}`} · {label}
                        </span>
                        <input
                          className="input w-full"
                          value={slots[i] || ''}
                          onFocus={() => onFocusSlot(i)}
                          onChange={(e) => onSlotChange(i, e.target.value)}
                          placeholder={editing.examples[i] || `Value for {{${i + 1}}}`}
                        />
                      </label>
                    ))}
                    <div>
                      <p className="mb-2 text-xs font-medium text-slate-500">Quick fill</p>
                      <div className="flex flex-wrap gap-1.5">
                        {TEMPLATE_QUICK_CHIPS.map((chip) => (
                          <button
                            key={chip.label}
                            type="button"
                            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-primary hover:bg-blue-50 hover:text-primary"
                            onClick={() => onChip(chip.value)}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">
                        Inserts into BODY {`{{${focusedSlot + 1}}}`}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Variable fields unlock after Meta approval.
                  </div>
                )}

                {error ? <p className="text-sm text-red-600">{error}</p> : null}

                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={busy || !libraryApproved}
                  onClick={onUseTemplate}
                >
                  Use this template
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Select a template card to begin.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [pageSearch, setPageSearch] = useState('');
  const [hasLiveToken, setHasLiveToken] = useState(true);
  const [quota, setQuota] = useState<number | null>(null);
  const [starters, setStarters] = useState<StarterTemplate[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editing, setEditing] = useState<StarterTemplate | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [focusedSlot, setFocusedSlot] = useState(0);
  const [mode, setMode] = useState<'starter' | 'custom'>('custom');
  const [applied, setApplied] = useState<StarterTemplate | null>(null);
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [speed, setSpeed] = useState<SpeedId>('balanced');
  const [audience, setAudience] = useState<AudienceMode>('all');
  const [compliance, setCompliance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approveWait, setApproveWait] = useState<string | null>(null);
  const [libraryApproved, setLibraryApproved] = useState(false);
  const [approvedPageCount, setApprovedPageCount] = useState(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const fillSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      api<{
        pages: PageRow[];
        hasLiveToken?: boolean;
        quota?: { creditsRemaining: number };
      }>('/api/auth/me'),
      api<{
        starters: Array<
          Partial<StarterTemplate> & { id: string; name: string; title: string; body: string }
        >;
      }>('/api/broadcast/templates'),
      api<{ pages: Array<{ page_id: string; contact_count: number }> }>(
        '/api/broadcast/audience/status'
      ),
      api<{
        pages: Array<{ page_id: string; ready: boolean; status: string }>;
      }>('/api/broadcast/utility-status').catch(() => ({
        pages: [] as Array<{ page_id: string; ready: boolean; status: string }>,
      })),
    ])
      .then(([me, tpl, audienceStatus, utility]) => {
        const counts = new Map(audienceStatus.pages.map((p) => [p.page_id, p.contact_count]));
        const util = new Map(utility.pages.map((p) => [p.page_id, p]));
        const rows = me.pages.map((p) => ({
          ...p,
          contactCount: counts.get(p.pageId) ?? p.contactCount ?? 0,
          utilityReady: util.get(p.pageId)?.ready,
          utilityStatus: util.get(p.pageId)?.status,
        }));
        setPages(rows);
        setSelected(rows.filter((p) => p.hasPageToken !== false).map((p) => p.pageId));
        setHasLiveToken(me.hasLiveToken !== false);
        setQuota(me.quota?.creditsRemaining ?? null);
        setStarters(mergeStarters(tpl.starters || []));
        if (rows.some((p) => !p.utilityReady)) {
          void api('/api/broadcast/auto-utility', {
            method: 'POST',
            body: JSON.stringify({}),
          }).catch(() => undefined);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredPages = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.name.toLowerCase().includes(q));
  }, [pages, pageSearch]);

  const estimated = useMemo(
    () =>
      pages
        .filter((p) => selected.includes(p.pageId))
        .reduce((s, p) => s + (p.contactCount || 0), 0),
    [pages, selected]
  );

  const previewText = useMemo(() => {
    if (mode === 'custom') return message;
    if (!applied) return '';
    return fillTemplateBody(applied.body, slots.length ? slots : defaultSlots(applied));
  }, [mode, message, applied, slots]);

  const libraryItems = useMemo(() => {
    const numbered = starters.filter((s) => !s.instant);
    const instant = starters.filter((s) => s.instant);
    return [...numbered, CUSTOM_STARTER, ...instant];
  }, [starters]);

  const canSend =
    selected.length > 0 &&
    hasLiveToken &&
    compliance &&
    audience === 'all' &&
    (mode === 'custom'
      ? Boolean(message.trim() || imageUrl.trim())
      : Boolean(applied && previewText.trim()));

  function openLibrary() {
    const pick = editing || applied || starters.find((s) => !s.instant) || CUSTOM_STARTER;
    setEditing(pick);
    setSlots(pick.id === 'custom' ? [message || pick.examples[0] || ''] : defaultSlots(pick));
    setFocusedSlot(0);
    const already =
      Boolean(applied && applied.id === pick.id) ||
      Boolean(
        pick.instant &&
          selected.every((id) => pages.find((p) => p.pageId === id)?.utilityReady)
      );
    setLibraryApproved(pick.id === 'custom' || already);
    setApprovedPageCount(
      pick.id === 'custom'
        ? selected.length
        : selected.filter((id) => pages.find((p) => p.pageId === id)?.utilityReady).length
    );
    setLibraryOpen(true);
  }

  function selectLibraryItem(tpl: StarterTemplate) {
    if (busy) return;
    setEditing(tpl);
    setFocusedSlot(0);
    if (tpl.id === 'custom') {
      setSlots([message || tpl.examples[0] || '']);
      setLibraryApproved(true);
      setApprovedPageCount(selected.length);
    } else {
      setSlots(defaultSlots(tpl));
      setLibraryApproved(false);
      setApprovedPageCount(0);
      if (selected.length) void approveLibraryTemplateFor(tpl);
    }
  }

  async function ensureUtilityApproved(tpl: StarterTemplate): Promise<{
    ready: number;
    pending: number;
    error?: string;
    message?: string;
    path?: string;
  }> {
    if (!selected.length) return { ready: 0, pending: 0 };

    const usePlain = Boolean(tpl.instant) || tpl.name === 'castme_plain_utility_v1';
    const metaBody = usePlain ? '{{1}}' : tpl.body;
    const metaName = usePlain ? 'castme_plain_utility_v1' : tpl.name;

    setApproveWait(
      usePlain
        ? 'Checking Instant UTILITY on Meta — please wait up to 1 minute…'
        : 'If this template has never been used on your page, approval usually takes 30–60 seconds. Please keep this window open…'
    );

    const prep = await api<{
      results: Array<{
        page_id: string;
        status: string;
        error?: string;
        path?: string;
        name?: string;
      }>;
      approved?: number;
      pending?: number;
      failed?: number;
      message?: string;
      template_name?: string;
    }>('/api/broadcast/ensure-library', {
      method: 'POST',
      body: JSON.stringify({
        page_ids: selected,
        template_name: metaName,
        body: metaBody,
        language: 'en',
        example_values: tpl.examples.length ? tpl.examples : tpl.parameters,
        instant: usePlain,
      }),
    });

    let ready = prep.results.filter((r) => r.status === 'APPROVED').length;
    const errHit = prep.results.find((r) => r.status === 'error' || r.status === 'REJECTED');
    const cold = prep.results.some((r) => r.path === 'cold');
    if (cold && ready < selected.length) {
      setApproveWait('Waiting for Meta approval… please keep this window open.');
    }

    setApprovedPageCount(ready);
    setPages((prev) =>
      prev.map((p) => {
        const hit = prep.results.find((x) => x.page_id === p.pageId);
        if (!hit) return p;
        return {
          ...p,
          utilityReady: hit.status === 'APPROVED',
          utilityStatus: hit.status,
        };
      })
    );

    if (ready >= selected.length) {
      return {
        ready,
        pending: 0,
        message: prep.message,
        path: cold ? 'cold' : 'warm',
      };
    }

    const statusPath = `/api/broadcast/utility-status?template_name=${encodeURIComponent(metaName)}`;
    const deadline = Date.now() + 30_000;
    let pending = Math.max(0, selected.length - ready);
    while (Date.now() < deadline && ready < selected.length) {
      const status = await api<{
        pages: Array<{ page_id: string; ready: boolean; status: string }>;
      }>(statusPath).catch(() => null);
      if (status) {
        const hits = status.pages.filter((x) => selected.includes(x.page_id));
        ready = hits.filter(
          (x) => x.ready || x.status === 'APPROVED' || x.status === 'approved'
        ).length;
        pending = Math.max(0, selected.length - ready);
        setPages((prev) =>
          prev.map((p) => {
            const hit = status.pages.find((x) => x.page_id === p.pageId);
            return hit ? { ...p, utilityReady: hit.ready, utilityStatus: hit.status } : p;
          })
        );
        setApprovedPageCount(ready);
        if (ready >= selected.length) break;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }

    return {
      ready,
      pending,
      error: errHit?.error,
      message: prep.message,
      path: cold ? 'cold' : 'warm',
    };
  }

  async function approveLibraryTemplateFor(tpl: StarterTemplate) {
    if (tpl.id === 'custom') {
      setLibraryApproved(true);
      return;
    }
    if (!selected.length) {
      setError('Select at least one Page before approving.');
      return;
    }
    setBusy(true);
    setError('');
    setApproveWait('Checking template approval on this page…');
    try {
      const { ready, pending, error: prepError, message } = await ensureUtilityApproved(tpl);
      setApprovedPageCount(ready);
      if (ready > 0) {
        setLibraryApproved(true);
        setToast(
          message ||
            (pending === 0
              ? `Approved on ${ready} of ${selected.length} page${selected.length === 1 ? '' : 's'}.`
              : `Approved on ${ready} of ${selected.length} pages — ${pending} still pending.`)
        );
      } else {
        setLibraryApproved(false);
        setError(
          prepError
            ? `Meta approve failed: ${prepError}`
            : 'Meta has not approved UTILITY yet. Reconnect Facebook, grant Utility Messaging, then try again.'
        );
      }
    } catch (err) {
      setLibraryApproved(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproveWait(null);
      setBusy(false);
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
      return;
    }

    if (!libraryApproved) {
      void approveLibraryTemplateFor(editing);
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
    setToast(
      `“${editing.title}” ready — approved on ${approvedPageCount || selected.length} of ${selected.length} page${selected.length === 1 ? '' : 's'}.`
    );
    requestAnimationFrame(() => fillSectionRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }

  function insertChip(value: string) {
    setSlots((prev) => {
      const next = [...prev];
      const idx = Math.min(Math.max(focusedSlot, 0), Math.max(next.length - 1, 0));
      if (!next.length) return [value];
      next[idx] = value;
      return next;
    });
  }

  function updateAppliedSlot(index: number, value: string) {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (applied) {
      const next = [...slots];
      next[index] = value;
      setMessage(fillTemplateBody(applied.body, next));
    }
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
      const audienceStatus = await api<{
        pages: Array<{ page_id: string; contact_count: number }>;
      }>('/api/broadcast/audience/status');
      const counts = new Map(audienceStatus.pages.map((p) => [p.page_id, p.contact_count]));
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

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setError('');
    try {
      // Warm Instant plain UTILITY on any Page that still looks unready (outside-24h needs it).
      const needPrep = selected.filter(
        (id) => !pages.find((p) => p.pageId === id)?.utilityReady
      );
      if (needPrep.length) {
        setToast('Preparing Instant UTILITY on selected Pages…');
        await api('/api/broadcast/prepare-instant', {
          method: 'POST',
          body: JSON.stringify({ page_ids: needPrep }),
        }).catch(() => undefined);
      }

      const rendered = previewText.trim();
      const useInstant =
        mode === 'custom' || Boolean(applied?.instant) || applied?.id === 'custom';
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
          delivery_mode: useInstant ? 'freeform_plain' : 'named_utility',
          utility_template: useInstant
            ? {
                name: 'castme_plain_utility_v1',
                body: '{{1}}',
                language: 'en',
                parameters: ['message'],
              }
            : mode === 'starter' && applied
              ? {
                  id: applied.id,
                  name: applied.name,
                  body: applied.body,
                  language: 'en',
                  parameters: slots.length ? slots : applied.examples,
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
    <div className="relative mx-auto max-w-6xl pb-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">New Campaign</p>
        <h1 className="text-2xl font-semibold text-slate-900">Broadcast to Messenger</h1>
        <p className="text-sm text-slate-500">
          Select pages, pick a template, fill BODY slots, then send.
        </p>
      </div>

      {!hasLiveToken ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Session expired / Reconnect required — Facebook account has no live user token. Open{' '}
          <a href="/reconnect" className="font-semibold underline">
            Reconnect
          </a>{' '}
          → tick every Page → allow Utility Messaging → Continue.
        </div>
      ) : null}

      {selected.length > 0 && selected.some((id) => !pages.find((p) => p.pageId === id)?.utilityReady) ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Some selected Pages are missing Instant UTILITY approval. Outside-24h sends need Utility
          Messaging + an APPROVED template. Use{' '}
          <a href="/reconnect" className="font-semibold underline">
            Reconnect
          </a>
          , tick every Page (including Patrick / all Pages you send from), grant Utility Messaging,
          then choose a template here so CastMe can sync &amp; approve.
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          {/* 1. Pages */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">1. Pages</h2>
                <p className="text-sm text-slate-500">
                  {selected.length} of {pages.length} selected · ~{estimated.toLocaleString()} people
                  {quota != null ? ` · ${quota.toLocaleString()} credits` : ''}
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
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {filteredPages.map((p) => {
                const checked = selected.includes(p.pageId);
                return (
                  <label
                    key={p.pageId}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                      checked
                        ? 'border-primary bg-blue-50/60'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={(e) => {
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, p.pageId]
                            : prev.filter((id) => id !== p.pageId)
                        );
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {(p.contactCount || 0).toLocaleString()} contacts ·{' '}
                        {p.hasPageToken === false ? 'no token' : 'token ok'}
                        {p.utilityReady ? ' · Instant ready' : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          {/* 2. Audience */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">2. Audience</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  {
                    id: 'all' as const,
                    title: 'All leads',
                    hint: 'Everyone with a conversation on selected pages',
                    enabled: true,
                  },
                  {
                    id: 'label' as const,
                    title: 'By label',
                    hint: 'Coming soon',
                    enabled: false,
                  },
                  {
                    id: 'pick' as const,
                    title: 'Pick leads',
                    hint: 'Coming soon',
                    enabled: false,
                  },
                ] as const
              ).map((opt) => {
                const active = audience === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!opt.enabled}
                    onClick={() => setAudience(opt.id)}
                    className={`rounded-xl border p-4 text-left transition ${
                      active
                        ? 'border-primary bg-blue-50/70'
                        : opt.enabled
                          ? 'border-slate-200 hover:border-slate-300'
                          : 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                    }`}
                  >
                    <p className="font-semibold text-slate-900">{opt.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{opt.hint}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Template */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">3. Template</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={openLibrary} disabled={!selected.length}>
                Choose from Library
              </button>
              {applied ? (
                <p className="text-sm text-slate-600">
                  Selected: <span className="font-semibold text-slate-900">{applied.title}</span>
                  {libraryApproved || mode === 'starter' ? (
                    <span className="ml-2 text-emerald-700">
                      · Approved on {approvedPageCount || selected.length} of {selected.length}
                    </span>
                  ) : null}
                </p>
              ) : mode === 'custom' && message ? (
                <p className="text-sm text-slate-600">
                  Selected: <span className="font-semibold">Custom message</span>
                </p>
              ) : (
                <p className="text-sm text-slate-500">No template selected yet.</p>
              )}
            </div>
          </section>

          {/* 4. Fill BODY */}
          <section ref={fillSectionRef} className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">4. Fill BODY variables</h2>
            {mode === 'starter' && applied ? (
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                {applied.labels.map((label, i) => (
                  <label key={`${applied.id}-fill-${i}`} className="block space-y-1">
                    <span className="text-xs font-medium text-slate-600">
                      BODY {`{{${i + 1}}}`} · {label}
                    </span>
                    <input
                      className="input w-full"
                      value={slots[i] || ''}
                      onFocus={() => setFocusedSlot(i)}
                      onChange={(e) => updateAppliedSlot(i, e.target.value)}
                    />
                  </label>
                ))}
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">Quick fill</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATE_QUICK_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-primary hover:bg-blue-50 hover:text-primary"
                        onClick={() => {
                          insertChip(chip.value);
                          if (applied) {
                            const next = [...slots];
                            const idx = Math.min(
                              Math.max(focusedSlot, 0),
                              Math.max(next.length - 1, 0)
                            );
                            next[idx] = chip.value;
                            setMessage(fillTemplateBody(applied.body, next));
                          }
                        }}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : mode === 'custom' ? (
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600">Your message</span>
                  <textarea
                    className="input min-h-[120px] w-full"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Write a custom Messenger message…"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600">Image URL (optional)</span>
                  <input
                    className="input w-full"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </label>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Choose a template from the library first. After Meta approval, BODY fields unlock
                here.
              </div>
            )}
          </section>

          {/* 5. Review & send */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">5. Review &amp; send</h2>
            <div className="flex flex-wrap gap-2">
              {SPEED_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSpeed(p.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${
                    speed === p.id
                      ? 'border-primary bg-blue-50 text-primary'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  <span className="font-medium">{p.label}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{p.hint}</span>
                </button>
              ))}
            </div>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={compliance}
                onChange={(e) => setCompliance(e.target.checked)}
              />
              <span>
                I confirm this message complies with Meta messaging policies and my audience has
                opted in to receive updates from these Pages.
              </span>
            </label>
          </section>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}
          {toast ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {toast}
            </div>
          ) : null}
        </div>

        <MessengerPreview pageName={primaryPageName} text={previewText} />
      </div>

      <div className="sticky bottom-0 z-30 mt-8 border-t border-slate-200 bg-surface/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            ~{estimated.toLocaleString()} recipients · {selected.length} page
            {selected.length === 1 ? '' : 's'}
            {!compliance ? ' · tick compliance to enable Send' : ''}
          </p>
          <button
            type="button"
            className="btn-primary min-w-[140px]"
            disabled={busy || !canSend}
            onClick={send}
          >
            {busy ? 'Sending…' : 'Send campaign'}
          </button>
        </div>
      </div>

      <LibraryModal
        open={libraryOpen}
        items={libraryItems}
        editing={editing}
        slots={slots}
        busy={busy}
        approveWait={approveWait}
        libraryApproved={libraryApproved}
        approvedPageCount={approvedPageCount}
        selectedCount={selected.length}
        focusedSlot={focusedSlot}
        error={error}
        onClose={() => {
          if (!busy) setLibraryOpen(false);
        }}
        onSelect={selectLibraryItem}
        onSlotChange={(index, value) => {
          setSlots((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
          });
        }}
        onFocusSlot={setFocusedSlot}
        onChip={insertChip}
        onUseTemplate={applyEditing}
      />
    </div>
  );
}

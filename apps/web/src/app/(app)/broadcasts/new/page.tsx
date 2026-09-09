'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { LibraryModal } from './library-modal';
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
  profileImage?: string | null;
  contactCount: number;
  hasPageToken?: boolean;
  status: string;
  utilityReady?: boolean;
  utilityStatus?: string;
};

type SpeedId = (typeof SPEED_PRESETS)[number]['id'];

function defaultSlots(tpl: StarterTemplate): string[] {
  return tpl.labels.map((label, i) => {
    if (isNameLabel(label)) return '{{first_name}}';
    return tpl.examples[i] || '';
  });
}

function MessengerPreview({ pageName, text }: { pageName: string; text: string }) {
  return (
    <aside className="lg:sticky lg:top-6">
      <div className="card overflow-hidden p-4">
        <p className="section-label mb-3 text-center">Preview</p>
        <div className="mx-auto w-full max-w-[280px] rounded-[1.75rem] border-[9px] border-slate-900 bg-slate-900 shadow-lg">
          <div className="overflow-hidden rounded-[1.2rem] bg-[#eef2f7]">
            <div className="flex items-center gap-2 bg-[#0084ff] px-3 py-2.5 text-white">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                {(pageName || 'P').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{pageName || 'Your Page'}</p>
                <p className="text-[10px] text-white/75">Messenger</p>
              </div>
            </div>
            <div className="max-h-[420px] min-h-[300px] overflow-y-auto bg-[linear-gradient(180deg,#f4f7fb_0%,#e8eef6_100%)] p-3 pb-5">
              <div className="flex justify-end">
                <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[#0084ff] px-3 py-2 text-[13px] leading-relaxed text-white shadow-sm">
                  {text.trim() || 'Your message preview…'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
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
  const [compliance, setCompliance] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approveWait, setApproveWait] = useState<string | null>(null);
  const [libraryApproved, setLibraryApproved] = useState(false);
  const [approvedPageCount, setApprovedPageCount] = useState(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [utilityHintDismissed, setUtilityHintDismissed] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);
  const librarySnapshotRef = useRef<{
    slots: string[];
    editing: StarterTemplate | null;
    libraryApproved: boolean;
    approvedPageCount: number;
    focusedSlot: number;
  } | null>(null);

  useEffect(() => {
    try {
      setUtilityHintDismissed(sessionStorage.getItem('pb_utility_hint_dismissed') === '1');
    } catch {
      /* ignore */
    }
  }, []);

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
      .then(async ([me, tpl, audienceStatus, utility]) => {
        const counts = new Map(audienceStatus.pages.map((p) => [p.page_id, p.contact_count]));
        let util = new Map(utility.pages.map((p) => [p.page_id, p]));
        let rows = me.pages.map((p) => ({
          ...p,
          contactCount: counts.get(p.pageId) ?? p.contactCount ?? 0,
          utilityReady: util.get(p.pageId)?.ready,
          utilityStatus: util.get(p.pageId)?.status,
        }));
        setPages(rows);
        // Intentional pick — never auto-select every page
        setSelected([]);
        setHasLiveToken(me.hasLiveToken !== false);
        setQuota(me.quota?.creditsRemaining ?? null);
        setStarters(mergeStarters(tpl.starters || []));

        if (rows.some((p) => !p.utilityReady)) {
          await api('/api/broadcast/auto-utility', {
            method: 'POST',
            body: JSON.stringify({}),
          }).catch(() => undefined);
          const refreshed = await api<{
            pages: Array<{ page_id: string; ready: boolean; status: string }>;
          }>('/api/broadcast/utility-status').catch(() => null);
          if (refreshed) {
            util = new Map(refreshed.pages.map((p) => [p.page_id, p]));
            rows = rows.map((p) => ({
              ...p,
              utilityReady: util.get(p.pageId)?.ready,
              utilityStatus: util.get(p.pageId)?.status,
            }));
            setPages(rows);
          }
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

  const hasMessage =
    mode === 'custom'
      ? Boolean(message.trim() || imageUrl.trim())
      : Boolean(applied && previewText.trim());

  const canSend = selected.length > 0 && hasLiveToken && compliance && hasMessage;

  const pagesNeedingUtility = useMemo(
    () =>
      selected
        .map((id) => pages.find((p) => p.pageId === id))
        .filter((p): p is PageRow => {
          if (!p) return false;
          return p.hasPageToken !== false && !p.utilityReady;
        }),
    [pages, selected]
  );

  const missingUtility = pagesNeedingUtility.length > 0 && !utilityHintDismissed;

  function dismissUtilityHint() {
    setUtilityHintDismissed(true);
    try {
      sessionStorage.setItem('pb_utility_hint_dismissed', '1');
    } catch {
      /* ignore */
    }
  }

  function openLibrary() {
    librarySnapshotRef.current = {
      slots: [...slots],
      editing,
      libraryApproved,
      approvedPageCount,
      focusedSlot,
    };
    const pick = applied || editing || starters.find((s) => !s.instant) || CUSTOM_STARTER;
    setEditing(pick);
    if (applied && applied.id === pick.id && slots.length === pick.labels.length) {
      setSlots([...slots]);
    } else if (pick.id === 'custom') {
      setSlots([message || pick.examples[0] || '']);
    } else {
      setSlots(defaultSlots(pick));
    }
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
        : applied && applied.id === pick.id
          ? approvedPageCount || selected.length
          : selected.filter((id) => pages.find((p) => p.pageId === id)?.utilityReady).length
    );
    setError('');
    setLibraryOpen(true);
  }

  function closeLibrary(restore = true) {
    if (busy) return;
    if (restore && librarySnapshotRef.current) {
      const snap = librarySnapshotRef.current;
      setSlots(snap.slots);
      setEditing(snap.editing);
      setLibraryApproved(snap.libraryApproved);
      setApprovedPageCount(snap.approvedPageCount);
      setFocusedSlot(snap.focusedSlot);
    }
    librarySnapshotRef.current = null;
    setLibraryOpen(false);
    setError('');
  }

  function selectLibraryItem(tpl: StarterTemplate) {
    if (busy) return;
    setError('');
    setEditing(tpl);
    setFocusedSlot(0);
    if (tpl.id === 'custom') {
      const snap = librarySnapshotRef.current;
      const fromSnap =
        snap && (!snap.editing || snap.editing.id === 'custom') ? snap.slots[0] : '';
      setSlots([fromSnap || message || tpl.examples[0] || '']);
      setLibraryApproved(true);
      setApprovedPageCount(selected.length);
    } else if (applied && applied.id === tpl.id) {
      const snap = librarySnapshotRef.current;
      const restore =
        snap && snap.slots.length === tpl.labels.length ? snap.slots : defaultSlots(tpl);
      setSlots([...restore]);
      setLibraryApproved(true);
      setApprovedPageCount(
        snap?.approvedPageCount || approvedPageCount || selected.length
      );
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
        ? 'Preparing Instant send… usually under a minute.'
        : 'Approving with Meta… usually 30–60 seconds. Keep this open.'
    );

    const prep = await api<{
      results: Array<{
        page_id: string;
        status: string;
        error?: string;
        path?: string;
        name?: string;
      }>;
      message?: string;
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
      setApproveWait('Waiting for Meta approval…');
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
      return { ready, pending: 0, message: prep.message, path: cold ? 'cold' : 'warm' };
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
      setError('Select at least one Page first.');
      return;
    }
    setBusy(true);
    setError('');
    setApproveWait('Checking approval…');
    try {
      const { ready, pending, error: prepError, message } = await ensureUtilityApproved(tpl);
      setApprovedPageCount(ready);
      if (ready > 0) {
        setLibraryApproved(true);
        setToast(
          message ||
            (pending === 0
              ? `Ready on ${ready} of ${selected.length} page${selected.length === 1 ? '' : 's'}.`
              : `Ready on ${ready} of ${selected.length} — ${pending} still pending.`)
        );
      } else {
        setLibraryApproved(false);
        setError(
          prepError ||
            'Meta has not approved this template yet. Reconnect Facebook and grant Utility Messaging.'
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
        setError('Write your message before continuing.');
        return;
      }
      setMode('custom');
      setApplied(null);
      setMessage(text);
      librarySnapshotRef.current = null;
      setLibraryOpen(false);
      setError('');
      setToast('Custom message ready.');
      return;
    }

    if (!libraryApproved) {
      void approveLibraryTemplateFor(editing);
      return;
    }

    const values = editing.labels.map((_, i) => slots[i]?.trim() || editing.examples[i] || '');
    if (values.some((v) => !v)) {
      setError('Fill every field before continuing.');
      return;
    }

    setMode('starter');
    setApplied(editing);
    setSlots(values);
    setMessage(fillTemplateBody(editing.body, values));
    librarySnapshotRef.current = null;
    setLibraryOpen(false);
    setError('');
    setToast(`“${editing.title}” applied.`);
    requestAnimationFrame(() => messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
      setToast('Audience sync started.');
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
      const needPrep = selected.filter(
        (id) => !pages.find((p) => p.pageId === id)?.utilityReady
      );
      if (needPrep.length) {
        setToast('Preparing Instant send…');
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
      setToast(`Queued · ~${res.estimatedRecipients.toLocaleString()} people`);
      router.push(`/broadcasts/${res.campaignId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading campaign builder…" />;

  const primaryPageName =
    pages.find((p) => selected.includes(p.pageId))?.name || pages[0]?.name || 'Your Page';

  const templateLabel =
    mode === 'starter' && applied
      ? applied.title
      : mode === 'custom' && message
        ? 'Custom message'
        : null;

  return (
    <div className="mx-auto max-w-6xl pb-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/broadcasts" className="text-xs font-medium text-slate-400 hover:text-primary">
            ← Broadcasts
          </Link>
          <h1 className="page-title mt-1">New campaign</h1>
          <p className="page-sub">Pick pages, write a message, send to reachable leads.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm">
          <p className="font-semibold tabular-nums text-slate-900">
            ~{estimated.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500">
            reachable · {selected.length} page{selected.length === 1 ? '' : 's'}
            {quota != null ? ` · ${quota.toLocaleString()} credits` : ''}
          </p>
        </div>
      </div>

      {!hasLiveToken ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Facebook session expired.{' '}
          <Link href="/reconnect" className="font-semibold underline">
            Reconnect
          </Link>{' '}
          and select every Page you send from.
        </div>
      ) : null}

      {missingUtility ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p>
            <span className="font-medium text-slate-900">
              {pagesNeedingUtility.length} selected page
              {pagesNeedingUtility.length === 1 ? '' : 's'}
            </span>{' '}
            may need Utility Messaging for older leads. In-window chats still send — or{' '}
            <Link href="/reconnect" className="font-semibold text-primary underline">
              reconnect once
            </Link>{' '}
            to enable Utility.
          </p>
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800"
            onClick={dismissUtilityHint}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {/* Pages */}
          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Pages</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Only reachable (non-blocked) leads are counted.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  onClick={() => setSelected(pages.map((p) => p.pageId))}
                >
                  All
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  onClick={() => setSelected([])}
                >
                  None
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  disabled={busy || !selected.length}
                  onClick={syncSelected}
                >
                  Sync
                </button>
              </div>
            </div>

            {pages.length > 4 ? (
              <input
                className="input mt-3"
                placeholder="Search pages…"
                value={pageSearch}
                onChange={(e) => setPageSearch(e.target.value)}
              />
            ) : null}

            <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {filteredPages.map((p) => {
                const checked = selected.includes(p.pageId);
                const avatar =
                  p.profileImage ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=E2E8F0&color=0F172A`;
                return (
                  <label
                    key={p.pageId}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                      checked ? 'bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, p.pageId]
                            : prev.filter((id) => id !== p.pageId)
                        );
                      }}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatar}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {p.name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {(p.contactCount || 0).toLocaleString()} reachable
                        {p.hasPageToken === false ? ' · needs reconnect' : ''}
                        {checked && p.hasPageToken !== false && !p.utilityReady
                          ? ' · utility pending'
                          : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
              {!filteredPages.length ? (
                <p className="px-2 py-6 text-center text-sm text-slate-500">No pages match.</p>
              ) : null}
            </div>
            {!selected.length && pages.length ? (
              <p className="mt-3 text-xs text-slate-500">
                Select the pages you want to send from — nothing is pre-selected.
              </p>
            ) : null}
          </section>

          {/* Message */}
          <section ref={messageRef} className="card space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Message</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Choose a template or write a custom Instant message.
                </p>
              </div>
              <button
                type="button"
                className="btn-primary !py-2"
                onClick={openLibrary}
                disabled={!selected.length || busy}
              >
                {templateLabel ? 'Change template' : 'Choose template'}
              </button>
            </div>

            {templateLabel ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">{templateLabel}</span>
                {mode === 'starter' ? (
                  <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                    Approved {approvedPageCount || selected.length}/{selected.length}
                  </span>
                ) : (
                  <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
                    Instant
                  </span>
                )}
              </div>
            ) : null}

            {mode === 'starter' && applied ? (
              <div className="space-y-3">
                {applied.labels.map((label, i) => (
                  <label key={`${applied.id}-fill-${i}`} className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600">
                      {label}
                      <span className="ml-1 text-slate-400">{`{{${i + 1}}}`}</span>
                    </span>
                    <input
                      className="input"
                      value={slots[i] || ''}
                      onFocus={() => setFocusedSlot(i)}
                      onChange={(e) => updateAppliedSlot(i, e.target.value)}
                    />
                  </label>
                ))}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {TEMPLATE_QUICK_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-primary hover:text-primary"
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
            ) : mode === 'custom' ? (
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-600">Message text</span>
                  <textarea
                    className="input min-h-[120px]"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Write your Messenger message…"
                  />
                </label>
                {showAdvanced ? (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600">Image URL (optional)</span>
                    <input
                      className="input"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                Open the library to pick a Template or Instant message.
              </div>
            )}
          </section>

          {/* Send */}
          <section className="card space-y-4 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Send</h2>
              <p className="mt-0.5 text-sm text-slate-500">Confirm and queue delivery.</p>
            </div>

            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-primary"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? 'Hide advanced' : 'Show advanced (speed, image)'}
            </button>

            {showAdvanced ? (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">Send speed</span>
                <select
                  className="input"
                  value={speed}
                  onChange={(e) => setSpeed(e.target.value as SpeedId)}
                >
                  {SPEED_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} — {p.hint}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={compliance}
                onChange={(e) => setCompliance(e.target.checked)}
              />
              <span>
                This message follows Meta policies and my audience opted in on these Pages.
              </span>
            </label>
          </section>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}
          {toast ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {toast}
            </div>
          ) : null}
        </div>

        <div className="hidden lg:block">
          <MessengerPreview pageName={primaryPageName} text={previewText} />
        </div>
      </div>

      {/* Mobile preview */}
      <div className="mt-6 lg:hidden">
        <MessengerPreview pageName={primaryPageName} text={previewText} />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur lg:left-[17.5rem]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {!selected.length
              ? 'Select at least one page'
              : !hasMessage
                ? 'Choose or write a message'
                : !compliance
                  ? 'Confirm the policy checkbox to send'
                  : `Ready · ~${estimated.toLocaleString()} reachable`}
          </div>
          <button
            type="button"
            className="btn-primary min-w-[148px]"
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
        pageName={primaryPageName}
        error={error}
        onClose={() => closeLibrary(true)}
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

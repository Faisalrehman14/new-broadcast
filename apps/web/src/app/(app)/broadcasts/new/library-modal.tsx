'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { TEMPLATE_QUICK_CHIPS, fillTemplateBody, type StarterTemplate } from './starters';

function LivePreview({ pageName, text }: { pageName: string; text: string }) {
  return (
    <div className="mx-auto w-full max-w-[260px]">
      <div className="overflow-hidden rounded-[1.6rem] border-[8px] border-slate-900 bg-slate-900 shadow-md">
        <div className="overflow-hidden rounded-[1.1rem] bg-[#eef2f7]">
          <div className="flex items-center gap-2 bg-[#0084ff] px-3 py-2 text-white">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
              {(pageName || 'P').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{pageName || 'Your Page'}</p>
              <p className="text-[9px] text-white/75">Messenger</p>
            </div>
          </div>
          <div className="max-h-[280px] min-h-[200px] overflow-y-auto bg-[linear-gradient(180deg,#f4f7fb_0%,#e8eef6_100%)] p-3 pb-4">
            <div className="flex justify-end">
              <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[#0084ff] px-3 py-2 text-[12px] leading-relaxed text-white shadow-sm">
                {text.trim() || 'Fill variables to preview…'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function highlightBody(body: string) {
  const parts = body.split(/(\{\{\d+\}\})/g);
  return parts.map((part, i) =>
    /^\{\{\d+\}\}$/.test(part) ? (
      <span
        key={i}
        className="rounded bg-amber-100 px-0.5 font-semibold text-amber-800"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function LibraryModal({
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
  pageName,
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
  pageName: string;
  error: string;
  onClose: () => void;
  onSelect: (tpl: StarterTemplate) => void;
  onSlotChange: (index: number, value: string) => void;
  onFocusSlot: (index: number) => void;
  onChip: (value: string) => void;
  onUseTemplate: () => void;
}) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open || !editing) return;
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open, editing?.id]);

  const numbered = useMemo(() => items.filter((t) => !t.instant && t.id !== 'custom'), [items]);
  const instant = useMemo(() => items.filter((t) => t.instant || t.id === 'custom'), [items]);

  const filteredNumbered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return numbered;
    return numbered.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
    );
  }, [numbered, query]);

  const filteredInstant = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return instant;
    return instant.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
    );
  }, [instant, query]);

  const livePreview = useMemo(() => {
    if (!editing) return '';
    if (editing.id === 'custom') return slots[0] || '';
    const values = editing.labels.map((_, i) => slots[i] || editing.examples[i] || `{{${i + 1}}}`);
    return fillTemplateBody(editing.body, values);
  }, [editing, slots]);

  if (!open) return null;

  function renderCard(tpl: StarterTemplate, kind: 'template' | 'instant') {
    const active = editing?.id === tpl.id;
    return (
      <button
        key={tpl.id}
        ref={active ? activeRef : undefined}
        type="button"
        disabled={busy}
        onClick={() => onSelect(tpl)}
        className={`w-full rounded-xl border p-3.5 text-left transition ${
          active
            ? kind === 'instant'
              ? 'border-emerald-500 bg-emerald-50/80 ring-1 ring-emerald-400/30'
              : 'border-primary bg-primary/5 ring-1 ring-primary/25'
            : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/90'
        }`}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm font-semibold text-slate-900">{tpl.title}</span>
          <span
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              kind === 'instant'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            {kind === 'instant' ? 'Instant' : 'EN'}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-600">
          {highlightBody(tpl.body)}
        </p>
        {tpl.labels.length > 0 && tpl.id !== 'custom' ? (
          <p className="mt-2 text-[10px] font-medium text-slate-400">
            {tpl.labels.length} variable{tpl.labels.length === 1 ? '' : 's'} ·{' '}
            {tpl.labels.join(' · ')}
          </p>
        ) : null}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="relative flex h-[min(96vh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-200/80 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="library-title" className="text-lg font-semibold tracking-tight text-slate-900">
              Template library
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Read the full message, fill variables, check the live preview.
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <input
              className="input h-9 flex-1 text-sm sm:w-56 sm:flex-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
              disabled={busy}
            />
            <button
              type="button"
              className="shrink-0 rounded-xl px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
              onClick={onClose}
              disabled={busy}
            >
              Close
            </button>
          </div>
        </div>

        <div className="relative grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.95fr)]">
          {approveWait ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/92 px-6 text-center backdrop-blur-sm">
              <div className="h-11 w-11 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm font-semibold text-slate-900">Checking template approval…</p>
              <p className="max-w-sm text-sm text-slate-600">{approveWait}</p>
              <p className="text-xs text-amber-700">Keep this window open.</p>
            </div>
          ) : null}

          {/* Browse — full template bodies */}
          <div ref={listRef} className="min-h-0 overflow-y-auto border-b border-slate-100 p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="section-label mb-0">Templates</p>
              <p className="text-[11px] text-slate-400">
                {filteredNumbered.length}
                {query ? ` of ${numbered.length}` : ''} shown
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {filteredNumbered.map((tpl) => renderCard(tpl, 'template'))}
              {!filteredNumbered.length ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  No templates match “{query}”.
                </p>
              ) : null}
            </div>

            {filteredInstant.length ? (
              <>
                <p className="section-label mb-3 mt-6">Instant · no Meta wait</p>
                <div className="flex flex-col gap-2.5">
                  {filteredInstant.map((tpl) => renderCard(tpl, 'instant'))}
                </div>
              </>
            ) : null}
          </div>

          {/* Edit + live preview */}
          <div className="flex min-h-0 flex-col overflow-y-auto bg-slate-50/60">
            {editing ? (
              <>
                <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-3">
                  <p className="section-label">Selected</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">{editing.title}</h3>
                  {libraryApproved ? (
                    <p className="mt-1 text-sm text-emerald-700">
                      Approved on {approvedPageCount || selectedCount} of {selectedCount} page
                      {selectedCount === 1 ? '' : 's'}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">
                      Syncing with Meta — fields unlock when approved.
                    </p>
                  )}
                </div>

                <div className="shrink-0 border-b border-slate-100 bg-[#f0f4f8] px-4 py-4">
                  <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Live preview
                  </p>
                  <LivePreview pageName={pageName} text={livePreview} />
                </div>

                <div className="flex flex-1 flex-col gap-4 p-4">
                  {libraryApproved ? (
                    editing.id === 'custom' ? (
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-slate-600">Your message</span>
                        <textarea
                          className="input min-h-[120px] w-full"
                          value={slots[0] || ''}
                          onFocus={() => onFocusSlot(0)}
                          onChange={(e) => onSlotChange(0, e.target.value)}
                          placeholder={editing.examples[0] || 'Write your Messenger message…'}
                        />
                      </label>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-slate-800">Fill BODY variables</p>
                        {editing.labels.map((label, i) => (
                          <label key={`${editing.id}-${i}`} className="block space-y-1.5">
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
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-primary hover:bg-primary/5 hover:text-primary"
                                onClick={() => onChip(chip.value)}
                              >
                                {chip.label}
                              </button>
                            ))}
                          </div>
                          <p className="mt-1.5 text-[10px] text-slate-400">
                            Inserts into BODY {`{{${focusedSlot + 1}}}`}
                          </p>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                      Variable fields unlock after Meta approval.
                      <p className="mt-2 text-xs text-slate-400">
                        Preview above uses sample values for now.
                      </p>
                    </div>
                  )}

                  {error ? <p className="text-sm text-red-600">{error}</p> : null}

                  <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row-reverse">
                    <button
                      type="button"
                      className="btn-primary w-full sm:flex-1"
                      disabled={busy || !libraryApproved}
                      onClick={onUseTemplate}
                    >
                      Use this template
                    </button>
                    <button
                      type="button"
                      className="btn-secondary w-full sm:w-auto"
                      disabled={busy}
                      onClick={onClose}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="px-4 py-16 text-center text-sm text-slate-500">
                Select a template on the left to preview and edit.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

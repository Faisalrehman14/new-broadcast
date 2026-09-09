'use client';

import { useEffect } from 'react';
import { TEMPLATE_QUICK_CHIPS, type StarterTemplate } from './starters';

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const numbered = items.filter((t) => !t.instant && t.id !== 'custom');
  const instant = items.filter((t) => t.instant || t.id === 'custom');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-[2px] sm:p-6"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="relative flex max-h-[min(92vh,880px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/80"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="library-title" className="text-lg font-semibold tracking-tight text-slate-900">
              Choose from Library
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              First use on a Page can take{' '}
              <span className="font-medium text-amber-700">30–60 seconds</span> for Meta approval.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="relative grid min-h-0 flex-1 lg:grid-cols-[1.2fr_0.8fr]">
          {approveWait ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/92 px-6 text-center backdrop-blur-sm">
              <div className="h-11 w-11 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm font-semibold text-slate-900">Checking template approval…</p>
              <p className="max-w-sm text-sm text-slate-600">{approveWait}</p>
              <p className="text-xs text-amber-700">Working on this one — keep this window open.</p>
            </div>
          ) : null}

          <div className="min-h-0 overflow-y-auto border-b border-slate-100 p-4 lg:border-b-0 lg:border-r">
            <p className="section-label mb-3">Templates</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {numbered.map((tpl) => {
                const active = editing?.id === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onSelect(tpl)}
                    className={`group rounded-2xl border p-3.5 text-left transition ${
                      active
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                        : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                        {tpl.title}
                      </span>
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        EN
                      </span>
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-600">
                      {tpl.body}
                    </p>
                    <p className="mt-2 text-[10px] font-medium text-slate-400">
                      {tpl.labels.length} variable{tpl.labels.length === 1 ? '' : 's'}
                    </p>
                  </button>
                );
              })}
            </div>

            {instant.length ? (
              <>
                <p className="section-label mb-3 mt-6">Instant · no Meta wait</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {instant.map((tpl) => {
                    const active = editing?.id === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        disabled={busy}
                        onClick={() => onSelect(tpl)}
                        className={`rounded-2xl border p-3.5 text-left transition ${
                          active
                            ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-400/30'
                            : 'border-slate-200/90 hover:border-emerald-200 hover:bg-emerald-50/40'
                        }`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                            {tpl.title}
                          </span>
                          <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                            Instant
                          </span>
                        </div>
                        <p className="line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-600">
                          {tpl.body}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>

          <div className="min-h-0 overflow-y-auto bg-slate-50/50 p-4">
            {editing ? (
              <div className="space-y-4">
                <div>
                  <p className="section-label">Selected</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">{editing.title}</h3>
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
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
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
              <p className="py-12 text-center text-sm text-slate-500">
                Select a template card to begin.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

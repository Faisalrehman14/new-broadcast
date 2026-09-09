'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Topbar({
  pages,
  activePageId,
  onSelectPage,
  onMenu,
  messagesRemaining,
  messagesLimit,
  planName,
  planExpired,
}: {
  pages: Array<{ pageId: string; name: string }>;
  activePageId?: string;
  onSelectPage: (id: string) => void;
  onMenu: () => void;
  messagesRemaining?: number;
  messagesLimit?: number;
  planName?: string;
  planExpired?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{
    broadcasts: Array<{ id: string; name: string }>;
    templates: Array<{ id: string; title: string }>;
  } | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api<{ unread: number }>('/api/notifications')
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      api<{
        contacts?: Array<{ id: string; name?: string }>;
        broadcasts: Array<{ id: string; name: string }>;
        templates: Array<{ id: string; title: string }>;
      }>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) =>
          setResults({
            broadcasts: r.broadcasts || [],
            templates: r.templates || [],
          })
        )
        .catch(() => setResults(null));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const hasResults = useMemo(
    () => results && (results.broadcasts.length || results.templates.length),
    [results]
  );

  const remaining = messagesRemaining ?? 0;
  const limit = messagesLimit ?? 0;
  const low =
    planExpired || remaining < 100 || (limit > 0 && remaining / limit < 0.1);

  const activeName = pages.find((p) => p.pageId === activePageId)?.name;

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink/8 bg-mist/80 px-4 py-3 backdrop-blur-md">
      <button
        type="button"
        className="btn-secondary !px-2.5 lg:hidden"
        onClick={onMenu}
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="hidden min-w-0 max-w-[200px] sm:block">
        <label className="sr-only" htmlFor="page-select">
          Context page
        </label>
        <select
          id="page-select"
          className="input !rounded-lg !border-ink/10 !bg-white/80 !py-2 text-sm font-medium"
          value={activePageId || ''}
          onChange={(e) => onSelectPage(e.target.value)}
          title={activeName || 'Select page'}
        >
          {pages.length === 0 ? <option value="">No pages</option> : null}
          {pages.map((p) => (
            <option key={p.pageId} value={p.pageId}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id="global-search"
          className="input !rounded-xl border-ink/8 bg-white/70 pl-9"
          placeholder="Search campaigns…  /"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => setOpen(true)}
        />
        {open && hasResults ? (
          <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-auto rounded-xl border border-ink/10 bg-white p-1.5 shadow-lift">
            {results!.broadcasts.map((b) => (
              <Link
                key={b.id}
                href={`/broadcasts/${b.id}`}
                className="block rounded-lg px-3 py-2 text-sm hover:bg-mist"
              >
                Campaign · {b.name}
              </Link>
            ))}
            {results!.templates.map((t) => (
              <Link
                key={t.id}
                href={`/templates?id=${t.id}`}
                className="block rounded-lg px-3 py-2 text-sm hover:bg-mist"
              >
                Template · {t.title}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <Link
        href="/billing"
        className={cn(
          'hidden items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold sm:flex',
          low
            ? 'border-amber-300/80 bg-amber-50 text-amber-950'
            : 'border-ink/8 bg-white/80 text-ink hover:bg-white'
        )}
        title={planExpired ? 'Plan expired — renew' : 'Messages remaining'}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {planName || 'Plan'}
        </span>
        <span className="tabular-nums">
          {planExpired ? 'Expired' : remaining.toLocaleString()}
        </span>
      </Link>

      <Link
        href="/notifications"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-ink/8 bg-white/80 text-ink hover:bg-white"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        ) : null}
      </Link>
    </header>
  );
}

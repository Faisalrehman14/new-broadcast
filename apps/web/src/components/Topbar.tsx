'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

export function Topbar({
  pages,
  activePageId,
  onSelectPage,
  onMenu,
}: {
  pages: Array<{ pageId: string; name: string }>;
  activePageId?: string;
  onSelectPage: (id: string) => void;
  onMenu: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{
    contacts: Array<{ id: string; name?: string }>;
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
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
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
      api<typeof results>(`/api/search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch(() => setResults(null));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const hasResults = useMemo(
    () =>
      results &&
      (results.contacts.length || results.broadcasts.length || results.templates.length),
    [results]
  );

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
      <button type="button" className="btn-secondary lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="h-4 w-4" />
      </button>

      <label className="sr-only" htmlFor="page-select">
        Page
      </label>
      <select
        id="page-select"
        className="input max-w-[200px]"
        value={activePageId || ''}
        onChange={(e) => onSelectPage(e.target.value)}
      >
        {pages.length === 0 ? <option value="">No pages</option> : null}
        {pages.map((p) => (
          <option key={p.pageId} value={p.pageId}>
            {p.name}
          </option>
        ))}
      </select>

      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id="global-search"
          className="input pl-9"
          placeholder="Search contacts, broadcasts, templates  ( / )"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => setOpen(true)}
        />
        {open && hasResults ? (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-card">
            {results!.contacts.map((c) => (
              <Link key={c.id} href={`/contacts?id=${c.id}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
                Contact · {c.name || c.id}
              </Link>
            ))}
            {results!.broadcasts.map((b) => (
              <Link key={b.id} href={`/broadcasts/${b.id}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
                Broadcast · {b.name}
              </Link>
            ))}
            {results!.templates.map((t) => (
              <Link key={t.id} href={`/templates?id=${t.id}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
                Template · {t.title}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <Link href="/notifications" className="btn-secondary relative" aria-label="Notifications">
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] text-white">
            {unread}
          </span>
        ) : null}
      </Link>
    </header>
  );
}

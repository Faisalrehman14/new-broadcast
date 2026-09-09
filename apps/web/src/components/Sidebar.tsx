'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import { messages } from '@/i18n/en';
import { api, setCsrfToken } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BrandLogo } from './BrandLogo';

type PageItem = {
  pageId: string;
  name: string;
  profileImage?: string | null;
  status: string;
  hasPageToken?: boolean;
};

const nav = [
  { href: '/dashboard', label: messages.nav.dashboard, icon: LayoutDashboard },
  { href: '/broadcasts', label: messages.nav.broadcasts, icon: Megaphone },
  { href: '/contacts', label: messages.nav.contacts, icon: Users },
  { href: '/analytics', label: messages.nav.analytics, icon: BarChart3 },
  { href: '/settings', label: messages.nav.settings, icon: Settings },
  { href: '/billing', label: messages.nav.billing, icon: CreditCard },
];

export function Sidebar({
  pages,
  activePageId,
  onSelectPage,
  userName,
  isAdmin,
  open,
  onClose,
  messagesRemaining,
  messagesLimit,
  planExpired,
}: {
  pages: PageItem[];
  activePageId?: string;
  onSelectPage: (id: string) => void;
  userName: string;
  isAdmin?: boolean;
  open?: boolean;
  onClose?: () => void;
  messagesRemaining?: number;
  messagesLimit?: number;
  planExpired?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active = pages.find((p) => p.pageId === activePageId) || pages[0];
  const remaining = messagesRemaining ?? 0;
  const lowCredits = planExpired || remaining < 100;

  async function logout() {
    onClose?.();
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* still leave the session UI */
    }
    setCsrfToken(null);
    try {
      sessionStorage.removeItem('pb_csrf');
      sessionStorage.removeItem('pb_active_page');
    } catch {
      /* ignore */
    }
    router.replace('/login');
  }

  return (
    <>
      <div
        className={cn('fixed inset-0 z-40 bg-dark/40 lg:hidden', open ? 'block' : 'hidden')}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[17.5rem] flex-col border-r border-slate-200/80 bg-white/95 backdrop-blur transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-5">
          <BrandLogo size={40} className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-dark">
              {messages.appName}
            </p>
            <p className="text-xs text-slate-400">Broadcast workspace</p>
          </div>
        </div>

        <div className="border-b border-slate-100 px-4 py-4">
          <p className="section-label">Active Page</p>
          {active ? (
            <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/80 p-2">
              <div className="flex items-center gap-3 px-1 py-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    active.profileImage ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(active.name)}`
                  }
                  alt=""
                  className="h-9 w-9 rounded-full object-cover ring-2 ring-white"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{active.name}</p>
                  <p
                    className={cn(
                      'flex items-center gap-1.5 text-xs',
                      active.hasPageToken === false || /error|expired|reauth/i.test(active.status)
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        active.hasPageToken === false ? 'bg-amber-500' : 'bg-emerald-500'
                      )}
                    />
                    {active.hasPageToken === false ? 'Needs reconnect' : 'Ready'}
                  </p>
                </div>
              </div>
              {pages.length > 1 ? (
                <label className="mt-2 block">
                  <span className="sr-only">Switch page</span>
                  <select
                    className="input py-1.5 text-xs"
                    value={active.pageId}
                    onChange={(e) => onSelectPage(e.target.value)}
                  >
                    {pages.map((p) => (
                      <option key={p.pageId} value={p.pageId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : (
            <Link href="/connect" className="mt-2 block text-sm font-medium text-primary">
              Connect a Page
            </Link>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {nav.map((item) => {
            const Icon = item.icon;
            const activeNav =
              item.href === '/broadcasts'
                ? pathname.startsWith('/broadcasts')
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const isBilling = item.href === '/billing';
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  activeNav
                    ? 'bg-primary/10 text-primary'
                    : isBilling && lowCredits
                      ? 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {isBilling ? (
                  <span className="tabular-nums text-[11px] text-slate-500">
                    {planExpired ? 'Expired' : remaining.toLocaleString()}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {isAdmin ? (
            <Link
              href="/admin"
              onClick={onClose}
              className={cn(
                'mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
                pathname.startsWith('/admin')
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <Shield className="h-4 w-4" aria-hidden />
              {messages.nav.admin}
            </Link>
          ) : null}
        </nav>

        <div className="space-y-2 border-t border-slate-100 px-4 py-4">
          <Link
            href="/reconnect"
            onClick={onClose}
            className="block text-xs font-medium text-slate-500 hover:text-primary"
          >
            Reconnect Facebook
          </Link>
          <Link
            href="/support"
            onClick={onClose}
            className="block text-xs font-medium text-slate-500 hover:text-primary"
          >
            Support
          </Link>
          <div className="pt-2">
            <p className="truncate text-sm font-medium text-slate-900">{userName}</p>
            <p className="text-xs text-slate-400">Workspace</p>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {messages.actions.logout}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

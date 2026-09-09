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
  userName,
  isAdmin,
  open,
  onClose,
  messagesRemaining,
  planExpired,
}: {
  pages: PageItem[];
  activePageId?: string;
  onSelectPage?: (id: string) => void;
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
  const remaining = messagesRemaining ?? 0;
  const lowCredits = planExpired || remaining < 100;
  const readyPages = pages.filter((p) => p.hasPageToken !== false).length;

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
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <BrandLogo size={40} className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-dark">
              {messages.appName}
            </p>
            <p className="text-xs text-slate-400">Broadcast workspace</p>
          </div>
        </div>

        {/* Workspace snapshot — replaces Active Page picker */}
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="section-label">Workspace</p>
          <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold tabular-nums text-slate-900">
                {readyPages}
                <span className="font-normal text-slate-400">
                  {pages.length > readyPages ? ` / ${pages.length}` : ''}
                </span>
              </p>
              <p className="text-[11px] font-medium text-slate-500">
                page{readyPages === 1 ? '' : 's'} connected
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200/70 pt-2">
              <p className="text-[11px] text-slate-500">
                {planExpired ? 'Plan expired' : 'Credits left'}
              </p>
              <p
                className={cn(
                  'text-xs font-semibold tabular-nums',
                  lowCredits ? 'text-amber-700' : 'text-slate-800'
                )}
              >
                {planExpired ? 'Renew' : remaining.toLocaleString()}
              </p>
            </div>
            {!pages.length ? (
              <Link
                href="/connect"
                onClick={onClose}
                className="mt-2 block text-xs font-semibold text-primary"
              >
                Connect a Page →
              </Link>
            ) : null}
          </div>
        </div>

        <nav className="space-y-0.5 overflow-y-auto px-3 py-3">
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

        {/* Account + logout sit directly under nav (not pushed to screen bottom) */}
        <div className="space-y-2 border-t border-slate-100 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{userName}</p>
              <p className="text-[11px] text-slate-400">Signed in</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              title={messages.actions.logout}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              {messages.actions.logout}
            </button>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Link
              href="/reconnect"
              onClick={onClose}
              className="text-[11px] font-medium text-slate-500 hover:text-primary"
            >
              Reconnect
            </Link>
            <Link
              href="/support"
              onClick={onClose}
              className="text-[11px] font-medium text-slate-500 hover:text-primary"
            >
              Support
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}

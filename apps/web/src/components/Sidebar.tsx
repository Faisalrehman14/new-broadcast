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
        className={cn('fixed inset-0 z-40 bg-ink/50 lg:hidden', open ? 'block' : 'hidden')}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[17.5rem] flex-col bg-ink text-white transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Main navigation"
      >
        <div className="border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={40} className="h-10 w-10 shrink-0 rounded-xl ring-1 ring-white/15" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold tracking-tight">
                {messages.appName}
              </p>
              <p className="truncate text-[11px] text-white/45">{userName}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
              title={messages.actions.logout}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Out
            </button>
          </div>
        </div>

        <div className="border-b border-white/10 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
            Workspace
          </p>
          <div className="mt-2 rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-display text-lg font-semibold tabular-nums tracking-tight">
                {readyPages}
                <span className="text-sm font-normal text-white/35">
                  {pages.length > readyPages ? `/${pages.length}` : ''}
                </span>
              </p>
              <p className="text-[11px] text-white/45">pages live</p>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
              <p className="text-[11px] text-white/45">
                {planExpired ? 'Plan expired' : 'Credits'}
              </p>
              <p
                className={cn(
                  'text-xs font-semibold tabular-nums',
                  lowCredits ? 'text-amber-300' : 'text-teal-300'
                )}
              >
                {planExpired ? 'Renew' : remaining.toLocaleString()}
              </p>
            </div>
            {!pages.length ? (
              <Link
                href="/connect"
                onClick={onClose}
                className="mt-2 block text-xs font-semibold text-teal-300 hover:text-teal-200"
              >
                Connect a Page →
              </Link>
            ) : null}
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
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
                    ? 'bg-primary text-white shadow-sm'
                    : isBilling && lowCredits
                      ? 'bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
                      : 'text-white/65 hover:bg-white/5 hover:text-white'
                )}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {isBilling ? (
                  <span className="tabular-nums text-[11px] text-white/45">
                    {planExpired ? '!' : remaining.toLocaleString()}
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
                  ? 'bg-primary text-white'
                  : 'text-white/65 hover:bg-white/5 hover:text-white'
              )}
            >
              <Shield className="h-4 w-4" aria-hidden />
              {messages.nav.admin}
            </Link>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 px-1 pt-3">
            <Link
              href="/reconnect"
              onClick={onClose}
              className="text-[11px] font-medium text-white/40 hover:text-teal-300"
            >
              Reconnect
            </Link>
            <Link
              href="/support"
              onClick={onClose}
              className="text-[11px] font-medium text-white/40 hover:text-teal-300"
            >
              Support
            </Link>
          </div>
        </nav>
      </aside>
    </>
  );
}

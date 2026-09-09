'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Bell,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  RefreshCw,
  Settings,
  Shield,
  Users,
  UsersRound,
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
};

const nav = [
  { href: '/dashboard', label: messages.nav.dashboard, icon: LayoutDashboard },
  { href: '/broadcasts', label: messages.nav.broadcasts, icon: Megaphone },
  { href: '/contacts', label: messages.nav.contacts, icon: Users },
  { href: '/analytics', label: messages.nav.analytics, icon: BarChart3 },
  { href: '/settings', label: messages.nav.settings, icon: Settings },
  { href: '/reconnect', label: messages.nav.reconnect, icon: RefreshCw },
  { href: '/support', label: messages.nav.support, icon: HelpCircle },
  { href: '/notifications', label: messages.nav.notifications, icon: Bell },
  { href: '/activity', label: messages.nav.activity, icon: Activity },
];

const optional = [
  { href: '/billing', label: messages.nav.billing, icon: CreditCard },
  { href: '/team', label: messages.nav.team, icon: UsersRound },
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
  const limit = messagesLimit ?? 0;
  const lowCredits =
    planExpired || remaining < 100 || (limit > 0 && remaining / limit < 0.1);

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
        className={cn(
          'fixed inset-0 z-40 bg-dark/40 lg:hidden',
          open ? 'block' : 'hidden'
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-5">
          <BrandLogo size={44} className="h-11 w-11 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-dark">{messages.appName}</p>
            <p className="text-xs text-slate-400">Messaging & broadcasts</p>
          </div>
        </div>

        <div className="border-b border-slate-100 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Connected Page
          </p>
          {active ? (
            <div className="mt-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-50"
                onClick={() => {
                  const idx = pages.findIndex((p) => p.pageId === active.pageId);
                  const next = pages[(idx + 1) % pages.length];
                  if (next) onSelectPage(next.pageId);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={active.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(active.name)}`}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{active.name}</p>
                  <p className="flex items-center gap-1 text-xs text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Connected
                  </p>
                </div>
                {pages.length > 1 ? (
                  <Link2 className="h-4 w-4 text-slate-400" aria-hidden />
                ) : null}
              </button>
            </div>
          ) : (
            <Link href="/connect" className="mt-2 block text-sm text-primary">
              Connect a Page
            </Link>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {nav.map((item) => {
            const Icon = item.icon;
            const activeNav = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                  activeNav ? 'bg-blue-50 text-primary' : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
          <div className="px-3 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Optional
          </div>
          {optional.map((item) => {
            const Icon = item.icon;
            const isBilling = item.href === '/billing';
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50',
                  isBilling && lowCredits ? 'bg-amber-50 font-medium text-amber-900' : 'text-slate-500'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {isBilling ? (
                  <span className="tabular-nums text-[11px]">
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
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                pathname.startsWith('/admin')
                  ? 'bg-blue-50 text-primary'
                  : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <Shield className="h-4 w-4" aria-hidden />
              {messages.nav.admin}
            </Link>
          ) : null}
        </nav>

        <div className="border-t border-slate-100 px-4 py-4">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="text-xs text-slate-400">Workspace owner</p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {messages.actions.logout}
          </button>
        </div>
      </aside>
    </>
  );
}

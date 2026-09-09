'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiClientError, setCsrfToken } from '@/lib/api';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { LoadingState } from './EmptyState';

type Me = {
  user: { id: string; email: string; name: string; role: string };
  csrfToken?: string;
  facebookConnected?: boolean;
  hasLiveToken?: boolean;
  planKey?: string;
  planName?: string;
  planExpiresAt?: string | null;
  planExpired?: boolean;
  messagesRemaining?: number;
  messagesLimit?: number;
  quota?: { creditsRemaining: number; creditsMonthly: number };
  pages: Array<{
    pageId: string;
    name: string;
    profileImage?: string | null;
    status: string;
    hasPageToken?: boolean;
  }>;
};

const PAGE_KEY = 'pb_active_page';
const ME_POLL_MS = 60_000;

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePageId, setActivePageId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function loadMe(opts?: { soft?: boolean }) {
      try {
        const data = await api<Me>('/api/auth/me');
        if (cancelled) return;
        if (data.csrfToken) setCsrfToken(data.csrfToken);
        setMe(data);
        setError(null);
        setActivePageId((prev) => {
          const stored = typeof window !== 'undefined' ? sessionStorage.getItem(PAGE_KEY) : null;
          if (prev && data.pages.some((p) => p.pageId === prev)) return prev;
          return (
            (stored && data.pages.some((p) => p.pageId === stored) && stored) ||
            data.pages[0]?.pageId
          );
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        if (!opts?.soft) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load workspace. Check API_URL on the web service.'
          );
        }
      } finally {
        if (!cancelled && !opts?.soft) setLoading(false);
      }
    }

    void loadMe();
    const timer = window.setInterval(() => void loadMe({ soft: true }), ME_POLL_MS);
    const onFocus = () => void loadMe({ soft: true });
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadMe({ soft: true });
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [router]);

  function selectPage(id: string) {
    setActivePageId(id);
    sessionStorage.setItem(PAGE_KEY, id);
  }

  if (loading) return <LoadingState label="Loading workspace..." />;

  if (!me) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4 text-center">
        <h1 className="text-xl font-semibold text-dark">CastMe Pro</h1>
        <p className="max-w-md text-sm text-slate-600">
          {error || 'Please sign in to continue.'}
        </p>
        <Link href="/login" className="btn-primary">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        pages={me.pages}
        userName={me.user.name}
        isAdmin={me.user.role === 'ADMIN'}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        messagesRemaining={me.messagesRemaining ?? me.quota?.creditsRemaining}
        messagesLimit={me.messagesLimit ?? me.quota?.creditsMonthly}
        planExpired={me.planExpired}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          pages={me.pages}
          activePageId={activePageId}
          onSelectPage={selectPage}
          onMenu={() => setMenuOpen(true)}
          messagesRemaining={me.messagesRemaining ?? me.quota?.creditsRemaining}
          messagesLimit={me.messagesLimit ?? me.quota?.creditsMonthly}
          planName={me.planName}
          planExpired={me.planExpired}
        />
        <main className="animate-fade-up flex-1 p-4 md:p-7 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

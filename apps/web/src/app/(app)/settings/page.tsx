'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Check,
  CreditCard,
  Database,
  Link2,
  LogOut,
  MessageSquare,
  Shield,
  User,
} from 'lucide-react';
import { api, setCsrfToken } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';

type Settings = {
  messagesPerSecond: number;
  messagesPerMinute: number;
  concurrentSends: number;
  maxRetries: number;
  notifyTemplateApproved: boolean;
  notifyTemplateRejected: boolean;
  notifyBroadcastCompleted: boolean;
  notifyBroadcastFailed: boolean;
  notifyConnectionLost: boolean;
  retentionDays: number;
};

type SessionRow = {
  id: string;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
  expiresAt?: string;
};

type LoginRow = {
  id: string;
  success: boolean;
  ip?: string | null;
  createdAt: string;
};

type Me = {
  user: { id: string; email: string; name: string; role: string };
  facebookConnected?: boolean;
  hasLiveToken?: boolean;
  planName?: string;
  planExpired?: boolean;
  messagesRemaining?: number;
  messagesLimit?: number;
  pages: Array<{ pageId: string; name: string; hasPageToken?: boolean }>;
};

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'messaging', label: 'Messaging', icon: MessageSquare },
  { id: 'notifications', label: 'Alerts', icon: Bell },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'security', label: 'Security', icon: Shield },
] as const;

const SPEED_PRESETS = [
  {
    id: 'safe',
    label: 'Safe',
    hint: 'Gentlest on Meta limits',
    values: { messagesPerSecond: 2, messagesPerMinute: 60, concurrentSends: 1, maxRetries: 5 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Recommended default',
    values: { messagesPerSecond: 5, messagesPerMinute: 200, concurrentSends: 3, maxRetries: 5 },
  },
  {
    id: 'fast',
    label: 'Fast',
    hint: 'Higher throughput',
    values: { messagesPerSecond: 10, messagesPerMinute: 400, concurrentSends: 8, maxRetries: 3 },
  },
  {
    id: 'turbo',
    label: 'Turbo',
    hint: 'Max speed — watch limits',
    values: { messagesPerSecond: 20, messagesPerMinute: 800, concurrentSends: 15, maxRetries: 2 },
  },
] as const;

const NOTIFY_FIELDS: Array<{ key: keyof Settings; title: string; desc: string }> = [
  {
    key: 'notifyTemplateApproved',
    title: 'Template approved',
    desc: 'When Meta approves a utility template on a Page.',
  },
  {
    key: 'notifyTemplateRejected',
    title: 'Template rejected',
    desc: 'When Meta rejects or fails a template submission.',
  },
  {
    key: 'notifyBroadcastCompleted',
    title: 'Campaign completed',
    desc: 'When a broadcast finishes sending.',
  },
  {
    key: 'notifyBroadcastFailed',
    title: 'Campaign failed',
    desc: 'When a campaign stops with errors.',
  },
  {
    key: 'notifyConnectionLost',
    title: 'Connection lost',
    desc: 'When a Facebook session or Page token needs attention.',
  },
];

const RATE_FIELDS: Array<{
  key: keyof Settings;
  label: string;
  hint: string;
  min: number;
  max: number;
}> = [
  {
    key: 'messagesPerSecond',
    label: 'Messages / second',
    hint: 'Burst rate toward Meta (1–30)',
    min: 1,
    max: 30,
  },
  {
    key: 'messagesPerMinute',
    label: 'Messages / minute',
    hint: 'Sustained cap (10–2000)',
    min: 10,
    max: 2000,
  },
  {
    key: 'concurrentSends',
    label: 'Concurrent sends',
    hint: 'Parallel delivery workers (1–50)',
    min: 1,
    max: 50,
  },
  {
    key: 'maxRetries',
    label: 'Max retries',
    hint: 'Retry failed deliveries (0–10)',
    min: 0,
    max: 10,
  },
];

function summarizeUa(ua?: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS|Macintosh/i.test(ua)
      ? 'macOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad/i.test(ua)
          ? 'iOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Device';
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  return `${browser} on ${os}${mobile ? ' · mobile' : ''}`;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-slate-200'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition',
          checked && 'translate-x-5'
        )}
      />
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [baseline, setBaseline] = useState<Settings | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginRow[]>([]);
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('profile');
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showAdvancedRates, setShowAdvancedRates] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

  const load = useCallback(async () => {
    const [meRes, setRes] = await Promise.all([
      api<Me>('/api/auth/me'),
      api<{
        settings: Settings;
        sessions: SessionRow[];
        loginHistory: LoginRow[];
      }>('/api/settings'),
    ]);
    setMe(meRes);
    const s: Settings = {
      messagesPerSecond: Number(setRes.settings.messagesPerSecond ?? 5),
      messagesPerMinute: Number(setRes.settings.messagesPerMinute ?? 200),
      concurrentSends: Number(setRes.settings.concurrentSends ?? 3),
      maxRetries: Number(setRes.settings.maxRetries ?? 5),
      notifyTemplateApproved: Boolean(setRes.settings.notifyTemplateApproved),
      notifyTemplateRejected: Boolean(setRes.settings.notifyTemplateRejected),
      notifyBroadcastCompleted: Boolean(setRes.settings.notifyBroadcastCompleted),
      notifyBroadcastFailed: Boolean(setRes.settings.notifyBroadcastFailed),
      notifyConnectionLost: Boolean(setRes.settings.notifyConnectionLost),
      retentionDays: Number(setRes.settings.retentionDays ?? 365),
    };
    setSettings(s);
    setBaseline(s);
    setSessions(setRes.sessions || []);
    setLoginHistory(setRes.loginHistory || []);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load settings'));
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const dirty = useMemo(() => {
    if (!settings || !baseline) return false;
    return JSON.stringify(settings) !== JSON.stringify(baseline);
  }, [settings, baseline]);

  const activePreset = useMemo(() => {
    if (!settings) return null;
    return (
      SPEED_PRESETS.find(
        (p) =>
          p.values.messagesPerSecond === settings.messagesPerSecond &&
          p.values.messagesPerMinute === settings.messagesPerMinute &&
          p.values.concurrentSends === settings.concurrentSends &&
          p.values.maxRetries === settings.maxRetries
      )?.id ?? null
    );
  }, [settings]);

  const readyPages = me?.pages.filter((p) => p.hasPageToken !== false).length ?? 0;

  async function save() {
    if (!settings || !dirty) return;
    setBusy(true);
    setError('');
    try {
      const res = await api<{ settings: Settings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          messagesPerSecond: settings.messagesPerSecond,
          messagesPerMinute: settings.messagesPerMinute,
          concurrentSends: settings.concurrentSends,
          maxRetries: settings.maxRetries,
          notifyTemplateApproved: settings.notifyTemplateApproved,
          notifyTemplateRejected: settings.notifyTemplateRejected,
          notifyBroadcastCompleted: settings.notifyBroadcastCompleted,
          notifyBroadcastFailed: settings.notifyBroadcastFailed,
          notifyConnectionLost: settings.notifyConnectionLost,
          retentionDays: settings.retentionDays,
        }),
      });
      const next: Settings = {
        messagesPerSecond: Number(res.settings.messagesPerSecond),
        messagesPerMinute: Number(res.settings.messagesPerMinute),
        concurrentSends: Number(res.settings.concurrentSends),
        maxRetries: Number(res.settings.maxRetries),
        notifyTemplateApproved: Boolean(res.settings.notifyTemplateApproved),
        notifyTemplateRejected: Boolean(res.settings.notifyTemplateRejected),
        notifyBroadcastCompleted: Boolean(res.settings.notifyBroadcastCompleted),
        notifyBroadcastFailed: Boolean(res.settings.notifyBroadcastFailed),
        notifyConnectionLost: Boolean(res.settings.notifyConnectionLost),
        retentionDays: Number(res.settings.retentionDays ?? settings.retentionDays),
      };
      setSettings(next);
      setBaseline(next);
      setToast('Settings saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings');
    } finally {
      setBusy(false);
    }
  }

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function applyPreset(id: (typeof SPEED_PRESETS)[number]['id']) {
    const preset = SPEED_PRESETS.find((p) => p.id === id);
    if (!preset || !settings) return;
    setSettings({ ...settings, ...preset.values });
  }

  function setAllNotifications(on: boolean) {
    if (!settings) return;
    setSettings({
      ...settings,
      notifyTemplateApproved: on,
      notifyTemplateRejected: on,
      notifyBroadcastCompleted: on,
      notifyBroadcastFailed: on,
      notifyConnectionLost: on,
    });
  }

  async function logoutThisDevice() {
    setLoggingOut(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* continue */
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

  async function logoutAllDevices() {
    setBusy(true);
    setError('');
    try {
      await api('/api/settings/logout-all', { method: 'POST' });
      setCsrfToken(null);
      try {
        sessionStorage.removeItem('pb_csrf');
        sessionStorage.removeItem('pb_active_page');
      } catch {
        /* ignore */
      }
      router.replace('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end sessions');
      setBusy(false);
      setConfirmLogoutAll(false);
    }
  }

  if (!settings || !me) {
    return error ? (
      <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 px-5 py-8 text-center">
        <p className="text-sm text-red-800">{error}</p>
        <button type="button" className="btn-primary mt-4" onClick={() => void load()}>
          Retry
        </button>
      </div>
    ) : (
      <LoadingState label="Loading settings…" />
    );
  }

  return (
    <div className="mx-auto max-w-5xl pb-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Account, delivery defaults, alerts, and security.</p>
        </div>
        {dirty ? (
          <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            Unsaved changes
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {toast ? (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <Check className="h-4 w-4" aria-hidden />
          {toast}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="card h-fit space-y-0.5 p-2 lg:sticky lg:top-20">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div className="space-y-5">
          {section === 'profile' ? (
            <>
              <section className="card overflow-hidden">
                <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white px-5 py-5">
                  <p className="section-label">Account</p>
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-lg font-semibold text-primary">
                      {(me.user.name || me.user.email || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-slate-900">
                        {me.user.name}
                      </h2>
                      <p className="truncate text-sm text-slate-500">{me.user.email}</p>
                      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                        {me.user.role === 'ADMIN' ? 'Admin' : 'Member'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
                  <div className="bg-white px-5 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Plan
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {me.planName || '—'}
                      {me.planExpired ? (
                        <span className="ml-2 text-xs font-medium text-amber-700">Expired</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="bg-white px-5 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Credits
                    </p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                      {(me.messagesRemaining ?? 0).toLocaleString()}
                      {me.messagesLimit != null ? (
                        <span className="font-normal text-slate-400">
                          {' '}
                          / {me.messagesLimit.toLocaleString()}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="bg-white px-5 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Pages
                    </p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                      {readyPages}
                      <span className="font-normal text-slate-400">
                        {' '}
                        / {me.pages.length} connected
                      </span>
                    </p>
                  </div>
                </div>
              </section>

              <section className="card space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Facebook connection</h2>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Keep Page tokens fresh for Instant and Utility sends.
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold',
                      me.hasLiveToken
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900'
                    )}
                  >
                    {me.hasLiveToken ? 'Connected' : 'Needs reconnect'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/reconnect" className="btn-secondary !py-2 text-sm">
                    <Link2 className="h-4 w-4" aria-hidden />
                    Reconnect Facebook
                  </Link>
                  <Link href="/billing" className="btn-secondary !py-2 text-sm">
                    <CreditCard className="h-4 w-4" aria-hidden />
                    Manage billing
                  </Link>
                </div>
              </section>

              <section className="card space-y-3 p-5">
                <h2 className="text-base font-semibold text-slate-900">Session</h2>
                <p className="text-sm text-slate-500">Sign out of CastMe Pro on this device only.</p>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loggingOut}
                  onClick={() => void logoutThisDevice()}
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  {loggingOut ? 'Signing out…' : 'Log out this device'}
                </button>
              </section>
            </>
          ) : null}

          {section === 'messaging' ? (
            <section className="card space-y-5 p-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Delivery defaults</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Applied when campaigns use your account send limits. Campaign speed presets still
                  override delay per send.
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Quick presets
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SPEED_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id)}
                      className={cn(
                        'rounded-xl border px-3.5 py-3 text-left transition',
                        activePreset === p.id
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      )}
                    >
                      <span className="block text-sm font-semibold text-slate-900">{p.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="text-xs font-medium text-slate-500 hover:text-primary"
                onClick={() => setShowAdvancedRates((v) => !v)}
              >
                {showAdvancedRates ? 'Hide fine-tune' : 'Fine-tune rates'}
              </button>

              {showAdvancedRates ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {RATE_FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="label">{f.label}</span>
                      <input
                        className="input"
                        type="number"
                        min={f.min}
                        max={f.max}
                        value={Number(settings[f.key])}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n)) patch(f.key, n as never);
                        }}
                      />
                      <span className="mt-1 block text-[11px] text-slate-400">{f.hint}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <dl className="grid gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Per second</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {settings.messagesPerSecond}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Per minute</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {settings.messagesPerMinute}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Concurrent</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {settings.concurrentSends}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Retries</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {settings.maxRetries}
                    </dd>
                  </div>
                </dl>
              )}
            </section>
          ) : null}

          {section === 'notifications' ? (
            <section className="card space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Workspace alerts</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Choose which events show up in your notification center.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary !px-3 !py-1.5 text-xs"
                    onClick={() => setAllNotifications(true)}
                  >
                    Enable all
                  </button>
                  <button
                    type="button"
                    className="btn-secondary !px-3 !py-1.5 text-xs"
                    onClick={() => setAllNotifications(false)}
                  >
                    Disable all
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {NOTIFY_FIELDS.map((f) => (
                  <li
                    key={f.key}
                    className="flex items-center justify-between gap-4 px-4 py-3.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{f.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{f.desc}</p>
                    </div>
                    <Toggle
                      checked={Boolean(settings[f.key])}
                      onChange={(v) => patch(f.key, v as never)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {section === 'data' ? (
            <section className="card space-y-5 p-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Data retention</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  How long campaign and activity history is kept for your workspace.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {[90, 180, 365, 730].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => patch('retentionDays', days)}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-center text-sm font-semibold transition',
                      settings.retentionDays === days
                        ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary/25'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    )}
                  >
                    {days < 365 ? `${days} days` : `${Math.round(days / 365)} year${days > 365 ? 's' : ''}`}
                  </button>
                ))}
              </div>
              <label className="block max-w-xs">
                <span className="label">Custom (days)</span>
                <input
                  className="input"
                  type="number"
                  min={30}
                  max={3650}
                  value={settings.retentionDays}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) patch('retentionDays', n);
                  }}
                />
                <span className="mt-1 block text-[11px] text-slate-400">Between 30 and 3650 days</span>
              </label>
            </section>
          ) : null}

          {section === 'security' ? (
            <>
              <section className="card space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Active sessions</h2>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Devices currently signed in to your account.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-danger !py-2 text-sm"
                    onClick={() => setConfirmLogoutAll(true)}
                  >
                    End all sessions
                  </button>
                </div>
                <ul className="space-y-2">
                  {sessions.length ? (
                    sessions.map((s, i) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {summarizeUa(s.userAgent)}
                            {i === 0 ? (
                              <span className="ml-2 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                Recent
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {s.ip || 'Unknown IP'} · signed in{' '}
                            {new Date(s.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </li>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No active sessions listed.</p>
                  )}
                </ul>
                {confirmLogoutAll ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                    <p className="font-medium">Sign out everywhere?</p>
                    <p className="mt-1 text-red-800/80">
                      You’ll need to log in again on every device, including this one.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-danger !py-2 text-sm"
                        disabled={busy}
                        onClick={() => void logoutAllDevices()}
                      >
                        {busy ? 'Signing out…' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary !py-2 text-sm"
                        disabled={busy}
                        onClick={() => setConfirmLogoutAll(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="card space-y-4 p-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Login history</h2>
                  <p className="mt-0.5 text-sm text-slate-500">Recent sign-in attempts.</p>
                </div>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {loginHistory.length ? (
                    loginHistory.map((l) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              l.success ? 'bg-emerald-500' : 'bg-red-500'
                            )}
                          />
                          <span className="font-medium text-slate-800">
                            {l.success ? 'Successful' : 'Failed'}
                          </span>
                          <span className="text-slate-400">{l.ip || '—'}</span>
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(l.createdAt).toLocaleString()}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="px-4 py-6 text-center text-sm text-slate-500">No history yet.</li>
                  )}
                </ul>
                <p className="text-xs text-slate-500">
                  Forgot your password? Use{' '}
                  <Link href="/login" className="font-medium text-primary hover:underline">
                    Sign in → Forgot password
                  </Link>
                  .
                </p>
              </section>
            </>
          ) : null}
        </div>
      </div>

      {dirty ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur lg:left-[17.5rem]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">You have unsaved settings changes.</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => baseline && setSettings(baseline)}
              >
                Discard
              </button>
              <button
                type="button"
                className="btn-primary min-w-[120px]"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

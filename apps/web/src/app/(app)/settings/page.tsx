'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setCsrfToken } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [sessions, setSessions] = useState<Array<{ id: string; ip?: string; userAgent?: string; createdAt: string }>>([]);
  const [loginHistory, setLoginHistory] = useState<Array<{ id: string; success: boolean; ip?: string; createdAt: string }>>([]);
  const [saved, setSaved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    api<{ settings: Record<string, unknown>; sessions: typeof sessions; loginHistory: typeof loginHistory }>(
      '/api/settings'
    ).then((r) => {
      setSettings(r.settings);
      setSessions(r.sessions);
      setLoginHistory(r.loginHistory);
    });
  }, []);

  if (!settings) return <LoadingState label="Loading settings..." />;

  async function save() {
    const res = await api<{ settings: Record<string, unknown> }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        messagesPerSecond: Number(settings!.messagesPerSecond),
        messagesPerMinute: Number(settings!.messagesPerMinute),
        concurrentSends: Number(settings!.concurrentSends),
        maxRetries: Number(settings!.maxRetries),
        notifyTemplateApproved: Boolean(settings!.notifyTemplateApproved),
        notifyTemplateRejected: Boolean(settings!.notifyTemplateRejected),
        notifyBroadcastCompleted: Boolean(settings!.notifyBroadcastCompleted),
        notifyBroadcastFailed: Boolean(settings!.notifyBroadcastFailed),
        notifyConnectionLost: Boolean(settings!.notifyConnectionLost),
      }),
    });
    setSettings(res.settings);
    setSaved(true);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">Account, messaging defaults, notifications, security</p>
      </div>

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">Messaging</h2>
        {(['messagesPerSecond', 'messagesPerMinute', 'concurrentSends', 'maxRetries'] as const).map((key) => (
          <div key={key}>
            <label className="label" htmlFor={key}>{key}</label>
            <input
              id={key}
              className="input"
              type="number"
              value={Number(settings[key] ?? 0)}
              onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
            />
          </div>
        ))}
      </section>

      <section className="card space-y-3 p-6">
        <h2 className="font-semibold">Notifications</h2>
        {(
          [
            'notifyTemplateApproved',
            'notifyTemplateRejected',
            'notifyBroadcastCompleted',
            'notifyBroadcastFailed',
            'notifyConnectionLost',
          ] as const
        ).map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(settings[key])}
              onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
            />
            {key.replace('notify', '').replace(/([A-Z])/g, ' $1')}
          </label>
        ))}
      </section>

      <button className="btn-primary" onClick={save}>Save settings</button>
      {saved ? <p className="text-sm text-success">Saved.</p> : null}

      <section className="card space-y-3 p-6">
        <h2 className="font-semibold">Account</h2>
        <p className="text-sm text-slate-500">Sign out of CastMe Pro on this device.</p>
        <button
          type="button"
          className="btn-secondary"
          disabled={loggingOut}
          onClick={() => {
            void (async () => {
              setLoggingOut(true);
              try {
                await api('/api/auth/logout', { method: 'POST' });
              } catch {
                /* continue to login */
              }
              setCsrfToken(null);
              try {
                sessionStorage.removeItem('pb_csrf');
                sessionStorage.removeItem('pb_active_page');
              } catch {
                /* ignore */
              }
              router.replace('/login');
            })();
          }}
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold">Security · Active sessions</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-lg bg-slate-50 px-3 py-2">
              {s.ip || 'Unknown IP'} · {new Date(s.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
        <button
          className="btn-danger mt-4"
          onClick={() =>
            void api('/api/settings/logout-all', { method: 'POST' }).then(() => {
              setCsrfToken(null);
              router.replace('/login');
            })
          }
        >
          Logout all devices
        </button>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold">Login history</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {loginHistory.map((l) => (
            <li key={l.id}>
              {l.success ? 'Success' : 'Failed'} · {l.ip || '—'} ·{' '}
              {new Date(l.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

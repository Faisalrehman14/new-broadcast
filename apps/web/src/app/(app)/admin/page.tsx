'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';

type Tab = 'overview' | 'users' | 'plans' | 'payments' | 'broadcasts' | 'system';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [plans, setPlans] = useState<Array<Record<string, unknown>>>([]);
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [broadcasts, setBroadcasts] = useState<Record<string, unknown> | null>(null);
  const [system, setSystem] = useState<Record<string, unknown> | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const loadTab = useCallback(async (t: Tab) => {
    setError('');
    if (t === 'overview') setOverview(await api('/api/admin/overview'));
    if (t === 'users') {
      const res = await api<{ users: Array<Record<string, unknown>> }>(
        `/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`
      );
      setUsers(res.users);
    }
    if (t === 'plans') {
      const res = await api<{ plans: Array<Record<string, unknown>> }>('/api/admin/plans');
      setPlans(res.plans);
    }
    if (t === 'payments') {
      const res = await api<{ orders: Array<Record<string, unknown>> }>('/api/admin/payment-orders');
      setOrders(res.orders);
    }
    if (t === 'broadcasts') setBroadcasts(await api('/api/admin/broadcasts'));
    if (t === 'system') setSystem(await api('/api/admin/system'));
  }, [q]);

  useEffect(() => {
    loadTab(tab).catch((e) => setError(e instanceof Error ? e.message : 'Forbidden'));
  }, [tab, loadTab]);

  async function run(action: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    setError('');
    setToast('');
    try {
      await action();
      setToast(okMsg);
      await loadTab(tab);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (error && !overview && tab === 'overview') {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-slate-500">{error}</p>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'plans', label: 'Plans' },
    { id: 'payments', label: 'Payments' },
    { id: 'broadcasts', label: 'Broadcasts' },
    { id: 'system', label: 'System' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-slate-500">Analyze, control plans/quota, and manage payments</p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {toast ? <p className="text-sm text-emerald-700">{toast}</p> : null}

      {tab === 'overview' ? (
        !overview ? (
          <LoadingState label="Loading overview..." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(overview).map(([k, v]) => (
              <div key={k} className="card p-4">
                <p className="text-xs uppercase text-slate-400">{k}</p>
                <p className="mt-2 break-all text-2xl font-semibold">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </p>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'users' ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              className="input max-w-sm"
              placeholder="Search email or name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void loadTab('users')}>
              Search
            </button>
          </div>
          <div className="card overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Messages</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const quota = u.quota as { creditsRemaining?: number; creditsMonthly?: number } | null;
                  return (
                    <tr key={String(u.id)} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <div className="font-medium">{String(u.name)}</div>
                        <div className="text-xs text-slate-500">{String(u.email)}</div>
                      </td>
                      <td className="px-4 py-3">
                        {String(u.planKey)}
                        <div className="text-xs text-slate-500">
                          {u.planExpiresAt
                            ? new Date(String(u.planExpiresAt)).toLocaleDateString()
                            : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {(quota?.creditsRemaining ?? 0).toLocaleString()} /{' '}
                        {(quota?.creditsMonthly ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {['starter', 'sapphire', 'platinum', 'free'].map((plan) => (
                            <button
                              key={plan}
                              type="button"
                              className="rounded bg-slate-100 px-2 py-1 text-xs"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    api(`/api/admin/users/${u.id}/plan`, {
                                      method: 'POST',
                                      body: JSON.stringify({ planKey: plan }),
                                    }),
                                  `Set ${plan}`
                                )
                              }
                            >
                              {plan}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="rounded bg-blue-50 px-2 py-1 text-xs text-primary"
                            disabled={busy}
                            onClick={() => {
                              const amount = Number(prompt('Grant how many messages?', '1000'));
                              if (!amount) return;
                              void run(
                                () =>
                                  api(`/api/admin/users/${u.id}/grant-messages`, {
                                    method: 'POST',
                                    body: JSON.stringify({ amount }),
                                  }),
                                'Granted'
                              );
                            }}
                          >
                            +msgs
                          </button>
                          <button
                            type="button"
                            className="rounded bg-slate-100 px-2 py-1 text-xs"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  api(`/api/admin/users/${u.id}/reset-quota`, {
                                    method: 'POST',
                                    body: '{}',
                                  }),
                                'Quota reset'
                              )
                            }
                          >
                            reset
                          </button>
                          <button
                            type="button"
                            className="rounded bg-red-50 px-2 py-1 text-xs text-red-700"
                            disabled={busy}
                            onClick={() => {
                              const currentlyEnabled =
                                (u.settings as { broadcastSend?: boolean } | null)?.broadcastSend !==
                                false;
                              void run(
                                () =>
                                  api(`/api/admin/users/${u.id}/broadcast-send`, {
                                    method: 'POST',
                                    body: JSON.stringify({ enabled: !currentlyEnabled }),
                                  }),
                                currentlyEnabled ? 'Send disabled' : 'Send enabled'
                              );
                            }}
                          >
                            toggle send
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'plans' ? (
        <div className="space-y-3">
          {plans.map((p) => (
            <div key={String(p.key)} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">
                  {String(p.name)} <span className="text-sm text-slate-500">({String(p.key)})</span>
                </p>
                <p className="text-sm text-slate-600">
                  ${(Number(p.amountCents) / 100).toFixed(2)} ·{' '}
                  {Number(p.messageLimit).toLocaleString()} msgs ·{' '}
                  {p.active ? 'active' : 'inactive'}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => {
                  const amountCents = Number(
                    prompt('Amount cents', String(p.amountCents))
                  );
                  const messageLimit = Number(
                    prompt('Message limit', String(p.messageLimit))
                  );
                  if (!Number.isFinite(amountCents) || !Number.isFinite(messageLimit)) return;
                  void run(
                    () =>
                      api(`/api/admin/plans/${p.key}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ amountCents, messageLimit }),
                      }),
                    'Plan updated'
                  );
                }}
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'payments' ? (
        <div className="space-y-4">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() =>
              void run(
                () => api('/api/admin/billing/reclaim', { method: 'POST', body: '{}' }),
                'Reclaim ran'
              )
            }
          >
            Reclaim pending Alby orders
          </button>
          <div className="card overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={String(o.id)} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs">{String(o.id).slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-xs">
                      {String((o.user as { email?: string } | undefined)?.email || '—')}
                    </td>
                    <td className="px-4 py-3">
                      {String(o.planKey)} · ${(Number(o.amountCents) / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">{String(o.status)}</td>
                    <td className="px-4 py-3">
                      {o.status !== 'activated' ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                api(`/api/admin/payment-orders/${o.id}/activate`, {
                                  method: 'POST',
                                  body: '{}',
                                }),
                              'Activated'
                            )
                          }
                        >
                          Force activate
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'broadcasts' ? (
        !broadcasts ? (
          <LoadingState label="Loading broadcasts..." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <pre className="card overflow-auto p-4 text-xs">
              {JSON.stringify(broadcasts.campaigns || [], null, 2)}
            </pre>
            <pre className="card overflow-auto p-4 text-xs">
              {JSON.stringify(broadcasts.broadcasts || [], null, 2)}
            </pre>
          </div>
        )
      ) : null}

      {tab === 'system' ? (
        !system ? (
          <LoadingState label="Loading system..." />
        ) : (
          <div className="space-y-4">
            <div className="card p-4 text-sm">
              <p>Alby configured: {String(system.albyConfigured)}</p>
              <p>Email: {JSON.stringify(system.email)}</p>
              <p>NODE_ENV: {String(system.nodeEnv)}</p>
            </div>
            <div className="card overflow-auto p-4">
              <h3 className="mb-2 font-semibold">Recent audit</h3>
              <pre className="text-xs">{JSON.stringify(system.recentAudit || [], null, 2)}</pre>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

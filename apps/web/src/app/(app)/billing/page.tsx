'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';

type Plan = {
  key: string;
  name: string;
  amountCents: number;
  messageLimit: number;
  interval: string;
  priceUsd: string;
};

type Status = {
  planKey: string;
  planName: string;
  planExpiresAt?: string | null;
  expired: boolean;
  messagesRemaining: number;
  messagesLimit: number;
  albyConfigured: boolean;
};

type Checkout = {
  orderId: string;
  bolt11?: string | null;
  qrDataUrl?: string | null;
  sats?: number | null;
  expiresAt?: string | null;
  status: string;
};

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [payStatus, setPayStatus] = useState('');

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      api<{ plans: Plan[] }>('/api/billing/plans'),
      api<Status>('/api/billing/status'),
    ]);
    setPlans(p.plans);
    setStatus(s);
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load billing'))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!checkout?.orderId || payStatus === 'activated') return;
    const t = setInterval(() => {
      api<{ activated: boolean; status: string }>(`/api/billing/orders/${checkout.orderId}`)
        .then((r) => {
          setPayStatus(r.status);
          if (r.activated) {
            setPayStatus('activated');
            void load();
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [checkout?.orderId, payStatus, load]);

  async function buy(planKey: string) {
    setBusy(true);
    setError('');
    setPayStatus('');
    try {
      const order = await api<Checkout>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan: planKey }),
      });
      setCheckout(order);
      setPayStatus(order.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading billing..." />;

  const used = status ? Math.max(0, status.messagesLimit - status.messagesRemaining) : 0;
  const pct =
    status && status.messagesLimit > 0
      ? Math.min(100, Math.round((used / status.messagesLimit) * 100))
      : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-slate-500">
          Prepaid Messenger plans · pay with Bitcoin Lightning (Alby)
        </p>
      </div>

      {status ? (
        <section className="card space-y-3 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Current plan</p>
              <p className="text-xl font-semibold">
                {status.planName}
                {status.expired ? (
                  <span className="ml-2 text-sm font-medium text-amber-700">Expired</span>
                ) : null}
              </p>
              <p className="text-sm text-slate-500">
                {status.planExpiresAt
                  ? `Expires ${new Date(status.planExpiresAt).toLocaleString()}`
                  : 'No expiry set'}
              </p>
            </div>
            <p className="text-sm tabular-nums text-slate-700">
              {status.messagesRemaining.toLocaleString()} / {status.messagesLimit.toLocaleString()}{' '}
              messages left
            </p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          {!status.albyConfigured ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Self-serve Lightning checkout is not configured yet. An admin can activate your plan
              from the Admin console.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <div key={p.key} className="card flex flex-col p-6">
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <p className="mt-2 text-3xl font-semibold">
              ${p.priceUsd}
              <span className="text-sm font-normal text-slate-500">/{p.interval}</span>
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {p.messageLimit.toLocaleString()} messages
            </p>
            <ul className="mt-4 flex-1 space-y-1 text-sm text-slate-600">
              <li>Multi-page Messenger campaigns</li>
              <li>UTILITY templates outside 24h</li>
              <li>Prepaid — no auto-charge</li>
            </ul>
            <button
              type="button"
              className="btn-primary mt-6 w-full"
              disabled={busy || (status ? !status.albyConfigured : true)}
              onClick={() => void buy(p.key)}
            >
              {busy ? 'Creating invoice…' : 'Pay with Lightning'}
            </button>
          </div>
        ))}
      </section>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {checkout ? (
        <section className="card space-y-4 p-6">
          <h2 className="font-semibold">Complete Lightning payment</h2>
          <p className="text-sm text-slate-600">
            Status: <strong>{payStatus}</strong>
            {checkout.sats ? ` · ${checkout.sats.toLocaleString()} sats` : ''}
          </p>
          {checkout.qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={checkout.qrDataUrl}
              alt="Lightning invoice QR"
              className="mx-auto h-56 w-56 rounded-xl border border-slate-200 bg-white p-2"
            />
          ) : null}
          {checkout.bolt11 ? (
            <div>
              <label className="label">Bolt11 invoice</label>
              <textarea className="input min-h-[88px] font-mono text-xs" readOnly value={checkout.bolt11} />
              <button
                type="button"
                className="btn-secondary mt-2"
                onClick={() => void navigator.clipboard.writeText(checkout.bolt11 || '')}
              >
                Copy invoice
              </button>
            </div>
          ) : null}
          {payStatus === 'activated' ? (
            <p className="text-sm text-emerald-700">Payment confirmed — plan activated.</p>
          ) : (
            <p className="text-sm text-slate-500">
              Keep this page open. We poll Alby every few seconds (and reclaim in the background if
              you close the tab).
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

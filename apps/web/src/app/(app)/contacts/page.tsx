'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRelative } from '@/lib/utils';
import { messages } from '@/i18n/en';
import Link from 'next/link';

type Contact = {
  id: string;
  name?: string;
  profileImage?: string;
  platformUserId: string;
  firstSeenAt: string;
  lastInteractionAt?: string;
  status: string;
  broadcastsReceived: number;
  lastBroadcastAt?: string;
  page: { id: string; name: string };
  tags: Array<{ id: string; name: string }>;
};

export default function ContactsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Contact | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      setLoading(true);
      api<{ data: Contact[] }>(`/api/contacts?${params}`)
        .then((r) => setData(r.data))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-slate-500">Customers synced from your connected Pages</p>
        </div>
        <Link href="/dashboard" className="btn-secondary">
          Sync Customers
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-sm"
          placeholder="Search name or platform ID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {loading ? (
        <LoadingState label="Loading contacts..." />
      ) : data.length === 0 ? (
        <EmptyState
          title={messages.empty.contacts}
          action={
            <Link href="/dashboard" className="btn-primary">
              Sync Customers
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="card overflow-hidden lg:col-span-2">
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Page</th>
                    <th className="px-4 py-3">Platform ID</th>
                    <th className="px-4 py-3">Last interaction</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Broadcasts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      onClick={() => setSelected(c)}
                    >
                      <td className="px-4 py-3 font-medium">{c.name || 'Unknown'}</td>
                      <td className="px-4 py-3 text-slate-500">{c.page.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{c.platformUserId}</td>
                      <td className="px-4 py-3">{formatRelative(c.lastInteractionAt)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3">{c.broadcastsReceived}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 p-4 md:hidden">
              {data.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full rounded-xl border border-slate-100 p-4 text-left"
                  onClick={() => setSelected(c)}
                >
                  <p className="font-medium">{c.name || 'Unknown'}</p>
                  <p className="text-xs text-slate-500">{c.page.name}</p>
                  <div className="mt-2">
                    <StatusBadge status={c.status} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5">
            {selected ? (
              <div className="space-y-3 text-sm">
                <h2 className="text-lg font-semibold">{selected.name || 'Contact'}</h2>
                <p className="text-slate-500">{selected.page.name}</p>
                <p>
                  <span className="text-slate-400">Platform ID</span>
                  <br />
                  <span className="font-mono text-xs">{selected.platformUserId}</span>
                </p>
                <p>First seen: {formatRelative(selected.firstSeenAt)}</p>
                <p>Last interaction: {formatRelative(selected.lastInteractionAt)}</p>
                <p>Broadcasts received: {selected.broadcastsReceived}</p>
                <p>Last broadcast: {formatRelative(selected.lastBroadcastAt)}</p>
                <StatusBadge status={selected.status} />
              </div>
            ) : (
              <p className="text-sm text-slate-500">Select a contact to view details.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

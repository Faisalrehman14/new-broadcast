'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { formatRelative } from '@/lib/utils';

export default function NotificationsPage() {
  const [items, setItems] = useState<
    Array<{ id: string; title: string; body: string; readAt?: string; createdAt: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await api<{ notifications: typeof items }>('/api/notifications');
    setItems(r.notifications);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <button
          className="btn-secondary"
          onClick={async () => {
            await api('/api/notifications/read-all', { method: 'POST' });
            await load();
          }}
        >
          Mark all read
        </button>
      </div>
      <div className="card divide-y divide-slate-100">
        {items.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`block w-full px-5 py-4 text-left ${n.readAt ? '' : 'bg-blue-50/40'}`}
            onClick={async () => {
              await api(`/api/notifications/${n.id}/read`, { method: 'POST' });
              await load();
            }}
          >
            <p className="font-medium">{n.title}</p>
            <p className="text-sm text-slate-600">{n.body}</p>
            <p className="mt-1 text-xs text-slate-400">{formatRelative(n.createdAt)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

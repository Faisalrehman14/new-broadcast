'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';

export default function AdminPage() {
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Record<string, number>>('/api/admin/overview')
      .then(setOverview)
      .catch((e) => setError(e instanceof Error ? e.message : 'Forbidden'));
  }, []);

  if (error) {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-slate-500">{error}</p>
      </div>
    );
  }
  if (!overview) return <LoadingState label="Loading admin overview..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-slate-500">System health — tokens are never displayed</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(overview).map(([k, v]) => (
          <div key={k} className="card p-4">
            <p className="text-xs uppercase text-slate-400">{k}</p>
            <p className="mt-2 text-2xl font-semibold">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { formatRelative } from '@/lib/utils';

export default function ActivityPage() {
  const [activity, setActivity] = useState<
    Array<{ id: string; action: string; resource: string; resourceId?: string; createdAt: string }>
  >([]);

  useEffect(() => {
    api<{ activity: typeof activity }>('/api/activity').then((r) => setActivity(r.activity));
  }, []);

  if (!activity) return <LoadingState />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Activity Logs</h1>
      <div className="card divide-y divide-slate-100">
        {activity.map((a) => (
          <div key={a.id} className="px-5 py-4 text-sm">
            <p className="font-medium">{a.action}</p>
            <p className="text-slate-500">
              {a.resource}
              {a.resourceId ? ` · ${a.resourceId}` : ''}
            </p>
            <p className="text-xs text-slate-400">{formatRelative(a.createdAt)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

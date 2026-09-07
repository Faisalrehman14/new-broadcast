'use client';

import { useEffect, useState } from 'react';
import { api, apiUrl } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRelative } from '@/lib/utils';
import { messages } from '@/i18n/en';

export default function ReconnectPage() {
  const [data, setData] = useState<{
    facebook: {
      status: string;
      tokenExpiresAt?: string;
      lastApiSuccessAt?: string;
    } | null;
    pages: Array<{
      pageId: string;
      name: string;
      profileImage?: string;
      status: string;
      healthStatus: string;
      lastSyncedAt?: string;
      lastWebhookAt?: string;
    }>;
    lastWebhookEventAt?: string | null;
  } | null>(null);

  useEffect(() => {
    api<typeof data>('/api/facebook/connection-health').then(setData);
  }, []);

  if (!data) return <LoadingState label="Checking connection health..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reconnect</h1>
        <p className="text-sm text-slate-500">
          Reauthorize Facebook without deleting contacts or broadcast history.
        </p>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold">Facebook connection</h2>
        {data.facebook ? (
          <div className="mt-4 space-y-2 text-sm">
            <StatusBadge status={data.facebook.status} />
            <p>Last successful API call: {formatRelative(data.facebook.lastApiSuccessAt)}</p>
            <p>Token expires: {formatRelative(data.facebook.tokenExpiresAt)}</p>
            <p>Last webhook event: {formatRelative(data.lastWebhookEventAt)}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No Facebook account connected.</p>
        )}
        <a href={apiUrl('/api/facebook/connect')} className="btn-primary mt-6 inline-flex">
          {messages.actions.connectFacebook.replace('Connect', 'Reconnect')}
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {data.pages.map((p) => (
          <div key={p.pageId} className="card p-5">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}`}
                alt=""
                className="h-10 w-10 rounded-full"
              />
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-slate-500">{p.healthStatus}</p>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              <StatusBadge status={p.status} />
              <p>Last sync: {formatRelative(p.lastSyncedAt)}</p>
              <p>Last webhook: {formatRelative(p.lastWebhookAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

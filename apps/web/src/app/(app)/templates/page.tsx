'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<
    Array<{
      id: string;
      title: string;
      metaName: string;
      category: string;
      source: string;
      bodyStatus: string;
      status: string;
      body: string | null;
      isCustom: boolean;
    }>
  >([]);
  const [tab, setTab] = useState('PAGEINTERACT');

  useEffect(() => {
    api<{ templates: typeof templates }>('/api/templates').then((r) => setTemplates(r.templates));
  }, []);

  if (!templates.length) return <LoadingState label="Loading templates..." />;

  const filtered = templates.filter((t) => {
    if (tab === 'CUSTOM') return t.isCustom || t.source === 'CUSTOM';
    return t.source === tab;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="text-sm text-slate-500">Core PageInteract, Library Extras, and Custom</p>
      </div>
      <div className="flex gap-2">
        {[
          ['PAGEINTERACT', 'Core PageInteract'],
          ['LIBRARY', 'Library Extras'],
          ['CUSTOM', 'Custom'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => (
          <div key={t.id} className="card p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{t.title}</p>
                <p className="text-xs text-slate-400">{t.metaName}</p>
              </div>
              <StatusBadge status={t.status} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{t.category}</p>
            {t.bodyStatus === 'requires_import' ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                body_status = requires_import — use admin JSON import
              </p>
            ) : (
              <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
                {t.body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

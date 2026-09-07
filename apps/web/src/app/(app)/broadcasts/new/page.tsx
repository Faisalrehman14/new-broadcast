'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { renderPreview } from '@/lib/utils';
import { messages } from '@/i18n/en';

type Template = {
  id: string;
  title: string;
  metaName: string;
  category: string;
  body: string | null;
  bodyStatus: string;
  source: string;
  isCustom: boolean;
  status: string;
  variables: Array<{ key: string; position: number; label?: string }>;
  approvals: Array<{ pageId: string; status: string }>;
};

export default function NewBroadcastPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [pages, setPages] = useState<Array<{ pageId: string; name: string }>>([]);
  const [pageId, setPageId] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState('');
  const [estimated, setEstimated] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<'PAGEINTERACT' | 'LIBRARY' | 'CUSTOM'>('PAGEINTERACT');

  useEffect(() => {
    Promise.all([
      api<{ pages: Array<{ pageId: string; name: string }> }>('/api/auth/me'),
      api<{ templates: Template[] }>('/api/templates'),
    ])
      .then(([me, tpl]) => {
        setPages(me.pages);
        setPageId(me.pages[0]?.pageId || '');
        setTemplates(tpl.templates);
      })
      .finally(() => setLoading(false));
  }, []);

  const template = templates.find((t) => t.id === templateId);
  const filtered = templates.filter((t) => {
    if (category === 'CUSTOM') return t.isCustom || t.source === 'CUSTOM';
    if (category === 'LIBRARY') return t.source === 'LIBRARY';
    return t.source === 'PAGEINTERACT';
  });

  const preview = useMemo(() => {
    if (!template) return '';
    if (template.isCustom) return customText || template.body || '';
    return renderPreview(template.body || '', values);
  }, [template, values, customText]);

  useEffect(() => {
    if (!pageId) return;
    // Estimate via creating draft isn't needed — use contacts count for ALL_ELIGIBLE approx from me pages
    api<{ data: unknown[]; pagination: { total: number } }>(`/api/contacts?pageId=${pageId}&pageSize=1`)
      .then((r) => setEstimated(r.pagination.total))
      .catch(() => setEstimated(null));
  }, [pageId]);

  async function create() {
    if (!template) return;
    setSaving(true);
    setError('');
    try {
      const variableValues = template.isCustom
        ? { text: customText }
        : values;
      const bodyForCustom =
        template.isCustom && customText
          ? await api<{ template: Template }>('/api/templates/' + template.id).then(async () => {
              // update custom body
              await api(`/api/templates/${template.id}`, {
                method: 'PUT',
                body: JSON.stringify({ body: customText }),
              });
            })
          : null;
      void bodyForCustom;

      if (!template.isCustom && template.body) {
        for (const v of template.variables) {
          if (!values[v.key]?.trim()) {
            throw new Error(`Variable {{${v.key}}} is required`);
          }
        }
      }

      const res = await api<{ broadcast: { id: string } }>('/api/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          name,
          pageId,
          templateId: template.id,
          recipientMode: 'ALL_ELIGIBLE',
          variableValues,
        }),
      });
      router.push(`/broadcasts/${res.broadcast.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create broadcast');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading broadcast wizard..." />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create Broadcast</h1>
        <p className="text-sm text-slate-500">Step {step} of 4</p>
      </div>

      {step === 1 ? (
        <div className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="bname">Broadcast name</label>
            <input
              id="bname"
              className="input"
              placeholder="September Customer Update"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="page">Page</label>
            <select id="page" className="input" value={pageId} onChange={(e) => setPageId(e.target.value)}>
              {pages.map((p) => (
                <option key={p.pageId} value={p.pageId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-slate-600">
            Recipients: All eligible contacts
            {estimated !== null ? (
              <span className="ml-2 font-semibold text-dark">
                {estimated.toLocaleString()} eligible recipients
              </span>
            ) : null}
          </p>
          <button className="btn-primary" disabled={!name || !pageId} onClick={() => setStep(2)}>
            Continue
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['PAGEINTERACT', 'LIBRARY', 'CUSTOM'] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={category === c ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setCategory(c)}
              >
                {c === 'PAGEINTERACT' ? 'Core PageInteract' : c === 'LIBRARY' ? 'Library Extras' : 'Custom'}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`card p-4 text-left ${templateId === t.id ? 'ring-2 ring-primary' : ''}`}
                onClick={() => {
                  setTemplateId(t.id);
                  setValues({});
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{t.title}</p>
                    <p className="text-xs text-slate-400">{t.metaName}</p>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
                <p className="mt-2 text-xs text-slate-500">{t.category}</p>
                {t.bodyStatus === 'requires_import' ? (
                  <p className="mt-2 text-xs text-amber-700">Body requires import</p>
                ) : (
                  <pre className="mt-3 max-h-24 overflow-hidden whitespace-pre-wrap text-xs text-slate-600">
                    {(t.body || '').slice(0, 180)}
                  </pre>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button
              className="btn-primary"
              disabled={
                !templateId ||
                templates.find((t) => t.id === templateId)?.bodyStatus === 'requires_import'
              }
              onClick={() => setStep(3)}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && template ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-4 p-6">
            <h2 className="font-semibold">Template variables</h2>
            {template.isCustom ? (
              <>
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  {messages.approval.customWarning}
                </p>
                <textarea
                  className="input min-h-[180px]"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Enter freeform message..."
                />
              </>
            ) : (
              template.variables.map((v) => (
                <div key={v.key}>
                  <label className="label" htmlFor={`var-${v.key}`}>
                    {`{{${v.key}}}`} {v.label || ''}
                  </label>
                  <input
                    id={`var-${v.key}`}
                    className="input"
                    value={values[v.key] || ''}
                    onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}
                  />
                </div>
              ))
            )}
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setStep(2)}>Back</button>
              <button className="btn-primary" onClick={() => setStep(4)}>Preview</button>
            </div>
          </div>
          <div className="card p-6">
            <h2 className="font-semibold">Live preview</h2>
            <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-relaxed">
              {preview || 'Preview will appear here'}
            </pre>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="card space-y-4 p-6">
          <h2 className="font-semibold">Validate & create</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-400">Broadcast</dt>
              <dd className="font-medium">{name}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Template</dt>
              <dd className="font-medium">{template?.title}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Recipients</dt>
              <dd className="font-medium">{estimated?.toLocaleString() ?? '—'}</dd>
            </div>
          </dl>
          <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm">{preview}</pre>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setStep(3)}>Back</button>
            <button className="btn-primary" disabled={saving} onClick={create}>
              {saving ? 'Creating...' : 'Create broadcast'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

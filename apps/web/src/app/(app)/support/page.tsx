'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';

const FAQ = [
  {
    q: 'How long does Meta template approval take?',
    a: 'For Messenger Page broadcasts, CastMe Pro activates ready library templates for your Page instantly — no WhatsApp-style Meta review wait. Connect a Page (or use Approve all on Templates), then start sending. Meta still enforces messaging windows and tags at send time.',
  },
  {
    q: 'Why can’t I start a broadcast while pending approval?',
    a: 'If a broadcast is stuck pending, open Templates → Approve all for this Page, or click Activate template on the broadcast. Library templates should become APPROVED immediately for Messenger.',
  },
  {
    q: 'Are access tokens stored in the browser?',
    a: 'No. Tokens are encrypted at rest on the server and never exposed to the frontend.',
  },
];

export default function SupportPage() {
  const [tickets, setTickets] = useState<Array<{ id: string; subject: string; status: string; priority: string }>>([]);
  const [form, setForm] = useState({
    subject: '',
    category: 'GENERAL',
    description: '',
    priority: 'MEDIUM',
  });
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api<{ tickets: typeof tickets }>('/api/support/tickets').then((r) => setTickets(r.tickets));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api('/api/support/tickets', { method: 'POST', body: JSON.stringify(form) });
    setOk(true);
    const r = await api<{ tickets: typeof tickets }>('/api/support/tickets');
    setTickets(r.tickets);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Support</h1>
        <p className="text-sm text-slate-500">FAQ, documentation, and tickets</p>
      </div>

      <section className="card p-6">
        <h2 className="font-semibold">FAQ</h2>
        <div className="mt-4 space-y-4">
          {FAQ.map((item) => (
            <div key={item.q}>
              <p className="font-medium">{item.q}</p>
              <p className="mt-1 text-sm text-slate-600">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold">Documentation</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-primary">
          <li>Production deployment guide (docs/DEPLOYMENT.md)</li>
          <li>Meta provider configuration (.env.example)</li>
          <li>Webhook setup & signature verification</li>
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold">Contact support / Report a problem</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input className="input" placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="GENERAL">General</option>
            <option value="TECHNICAL">Technical</option>
            <option value="META">Meta / Facebook</option>
            <option value="BILLING">Billing</option>
            <option value="OTHER">Other</option>
          </select>
          <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
          <textarea className="input min-h-[120px]" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          <button className="btn-primary">Submit ticket</button>
          {ok ? <p className="text-sm text-success">Ticket submitted.</p> : null}
        </form>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold">Your tickets</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {tickets.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 border-b border-slate-50 py-2">
              <span>{t.subject}</span>
              <StatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

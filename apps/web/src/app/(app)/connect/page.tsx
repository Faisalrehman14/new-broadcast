'use client';

import { messages } from '@/i18n/en';
import { apiUrl } from '@/lib/api';
import { BrandLogo } from '@/components/BrandLogo';

export default function ConnectPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 px-8 py-12 text-white">
          <BrandLogo size={64} className="mb-4 h-16 w-16 rounded-full bg-white/90 p-1" />
          <p className="text-sm uppercase tracking-wide text-teal-200">{messages.appName}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Connect Facebook</h1>
          <p className="mt-3 max-w-lg text-sm text-slate-300">
            Securely authorize CastMe Pro to discover your Pages, sync Messenger contacts,
            and send approved template broadcasts. Access tokens never leave the server.
          </p>
        </div>
        <div className="space-y-4 p-8">
          <ul className="space-y-2 text-sm text-slate-600">
            <li>• OAuth with Facebook</li>
            <li>• Discover eligible Pages</li>
            <li>• Encrypted token storage</li>
            <li>• Background contact sync + webhooks</li>
          </ul>
          <a href={apiUrl('/api/facebook/connect')} className="btn-primary inline-flex">
            {messages.actions.connectFacebook}
          </a>
        </div>
      </div>
    </div>
  );
}

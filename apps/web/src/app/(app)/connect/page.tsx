'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { messages } from '@/i18n/en';
import { apiUrl } from '@/lib/api';
import { BrandLogo } from '@/components/BrandLogo';

const ERROR_COPY: Record<string, string> = {
  denied:
    'Facebook authorization was cancelled. Click Connect again → choose your Business → tick EVERY Page you send from → enable Utility Messaging → Continue.',
  invalid_state: 'Your connect session expired. Click Connect Facebook again.',
  expired:
    'Your stored Facebook access token is invalid. Click Connect Facebook again and approve all permissions.',
  token:
    'Facebook could not finish login (token exchange failed). Confirm Meta App ID, App Secret, and the OAuth redirect URI match exactly in Meta Developer settings, then reconnect.',
  secret:
    'The Facebook App Secret looks wrong. Update it in your server settings from Meta → Settings → Basic, then reconnect.',
  redirect:
    'OAuth redirect URI mismatch. The server redirect URI and Meta Valid OAuth Redirect URIs must match exactly (no trailing slash).',
  long_lived:
    'Long-lived token exchange failed — usually a wrong App Secret. Fix the secret, restart the API, then reconnect.',
  profile:
    'Could not finish Facebook login. Click Connect again, select your Business, tick every Page, allow all permissions, then Continue.',
  config: 'Server configuration error. Check encryption settings on the API service.',
  facebook:
    'Facebook connect failed. Verify App ID, App Secret, and OAuth redirect URI, then reconnect.',
};

function ConnectInner() {
  const search = useSearchParams();
  const err = search.get('error');
  const errMsg = err ? ERROR_COPY[err] || ERROR_COPY.facebook : null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 px-8 py-12 text-white">
          <BrandLogo size={64} className="mb-4 h-16 w-16 rounded-full bg-white/90 p-1" />
          <p className="text-sm uppercase tracking-wide text-teal-200">{messages.appName}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Connect Facebook</h1>
          <p className="mt-3 max-w-lg text-sm text-slate-300">
            Securely authorize CastMe Pro to discover your Pages, sync Messenger contacts,
            and send approved template broadcasts. Short-lived tokens are exchanged for
            long-lived tokens (~60 days) and never leave the server.
          </p>
        </div>
        <div className="space-y-4 p-8">
          {errMsg ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {errMsg}
            </div>
          ) : null}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">If Facebook shows Business / Page checkboxes</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Select your Business (do not leave it empty).</li>
              <li>Tick every Page you broadcast from (e.g. Dragon House + Patrick).</li>
              <li>Allow Utility Messaging / pages_utility_messaging.</li>
              <li>Click Continue — never Cancel (Cancel lands on facebook.com/…/oauth/business/cancel).</li>
            </ol>
          </div>
          <ul className="space-y-2 text-sm text-slate-600">
            <li>• OAuth with Facebook (rerequest Utility Messaging)</li>
            <li>• Long-lived user token stored encrypted</li>
            <li>• Discover eligible Pages</li>
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

export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading…</div>}>
      <ConnectInner />
    </Suspense>
  );
}

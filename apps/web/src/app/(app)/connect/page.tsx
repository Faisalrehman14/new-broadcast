'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { messages } from '@/i18n/en';
import { apiUrl } from '@/lib/api';
import { BrandLogo } from '@/components/BrandLogo';

const ERROR_COPY: Record<string, string> = {
  denied:
    'Facebook authorization was cancelled (or Business Login finished without a business selected). Click Connect again → choose your Business → tick EVERY Page you send from → enable Utility Messaging → Continue (do not Cancel).',
  invalid_state: 'Your connect session expired. Click Connect Facebook again.',
  expired:
    'Your stored Facebook access token is invalid. Click Connect Facebook again and approve all permissions.',
  token:
    'Facebook code→token exchange failed. In Railway set META_REDIRECT_URI exactly to https://pagebroadcastweb-production.up.railway.app/api/facebook/callback and add the same URI under Meta → Facebook Login → Valid OAuth Redirect URIs. Also verify META_APP_ID / META_APP_SECRET.',
  secret:
    'META_APP_SECRET looks wrong. Copy a fresh App Secret from Meta → Settings → Basic, set it on the API service, redeploy, then reconnect.',
  redirect:
    'OAuth redirect_uri mismatch. META_REDIRECT_URI and Meta Valid OAuth Redirect URIs must match exactly (no trailing slash).',
  long_lived:
    'Long-lived token exchange failed — usually wrong META_APP_SECRET. Fix the secret, redeploy API, then reconnect.',
  profile:
    'Could not read your Facebook profile after login. Ensure the Meta app includes public_profile, you are an App admin/tester (if app is in Development), then reconnect.',
  config: 'Server encryption/config error. Check ENCRYPTION_KEY on the API service.',
  facebook:
    'Facebook connect failed. Check META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, and Meta Valid OAuth Redirect URIs, then reconnect.',
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

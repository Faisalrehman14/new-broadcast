'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { messages } from '@/i18n/en';
import { BrandLogo } from '@/components/BrandLogo';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('demo@pagebroadcast.local');
  const [password, setPassword] = useState('DemoPassword123!');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'login') {
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        router.replace('/dashboard');
        return;
      }
      if (mode === 'forgot') {
        await api('/api/auth/forgot-password/send-otp', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        setInfo('If an account exists, a reset code was sent to your email.');
        setMode('reset');
        return;
      }
      await api('/api/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({ email, otp, password: newPassword }),
      });
      setInfo('Password updated. Sign in with your new password.');
      setMode('login');
      setPassword(newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen">
      <div className="relative hidden w-[46%] overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(600px 400px at 20% 10%, rgba(15,118,110,0.5), transparent 60%), radial-gradient(500px 360px at 90% 90%, rgba(45,212,191,0.12), transparent 55%)',
          }}
        />
        <div className="relative">
          <BrandLogo size={56} priority className="h-14 w-14 rounded-2xl ring-1 ring-white/15" />
          <p className="mt-8 font-display text-3xl font-semibold tracking-tight text-white">
            {messages.appName}
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/55">
            {messages.tagline}
          </p>
        </div>
        <p className="relative text-xs text-white/35">
          Messenger Page broadcasts · Utility-ready delivery
        </p>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(700px 400px at 80% -10%, rgba(15,118,110,0.08), transparent 50%)',
          }}
        />
        <div className="relative w-full max-w-md animate-fade-up">
          <div className="mb-8 lg:hidden">
            <BrandLogo size={56} priority className="mb-4 h-14 w-14" />
            <h1 className="font-display text-2xl font-semibold tracking-tight">{messages.appName}</h1>
            <p className="mt-1 text-sm text-slate-500">{messages.tagline}</p>
          </div>

          <div className="card p-7 md:p-8">
            <h2 className="font-display text-xl font-semibold text-ink">
              {mode === 'login'
                ? 'Sign in'
                : mode === 'forgot'
                  ? 'Reset password'
                  : 'Enter reset code'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'login'
                ? 'Welcome back to your workspace.'
                : mode === 'forgot'
                  ? 'We’ll email a one-time code.'
                  : 'Use the code from your inbox.'}
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {mode === 'login' ? (
                <div>
                  <label className="label" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              ) : null}
              {mode === 'reset' ? (
                <>
                  <div>
                    <label className="label" htmlFor="otp">
                      Code
                    </label>
                    <input
                      id="otp"
                      className="input"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="newPassword">
                      New password
                    </label>
                    <input
                      id="newPassword"
                      className="input"
                      type="password"
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                </>
              ) : null}
              {info ? <p className="text-sm text-emerald-700">{info}</p> : null}
              {error ? (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              <button className="btn-primary w-full" disabled={loading}>
                {loading
                  ? 'Please wait…'
                  : mode === 'login'
                    ? 'Sign in'
                    : mode === 'forgot'
                      ? 'Send reset code'
                      : 'Update password'}
              </button>
            </form>

            <div className="mt-5 flex justify-between text-sm">
              {mode === 'login' ? (
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setMode('forgot')}
                >
                  Forgot password?
                </button>
              ) : (
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setMode('login')}
                >
                  Back to sign in
                </button>
              )}
              <Link href="/register" className="font-semibold text-primary hover:underline">
                Create account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#dbeafe_0%,_#f8fafc_55%,_#e2e8f0_100%)]" />
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,#94a3b822_1px,transparent_1px),linear-gradient(to_bottom,#94a3b822_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative w-full max-w-md card p-8">
        <div className="mb-8">
          <BrandLogo size={72} priority className="mb-4 h-[72px] w-[72px]" />
          <h1 className="text-2xl font-semibold tracking-tight">{messages.appName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'login' ? messages.tagline : mode === 'forgot' ? 'Reset password' : 'Enter reset code'}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {mode === 'login' ? (
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          ) : null}
          {mode === 'reset' ? (
            <>
              <div>
                <label className="label" htmlFor="otp">Code</label>
                <input id="otp" className="input" value={otp} onChange={(e) => setOtp(e.target.value)} required />
              </div>
              <div>
                <label className="label" htmlFor="newPassword">New password</label>
                <input id="newPassword" className="input" type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              </div>
            </>
          ) : null}
          {info ? <p className="text-sm text-emerald-700">{info}</p> : null}
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
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
        <div className="mt-4 flex justify-between text-sm">
          {mode === 'login' ? (
            <button type="button" className="text-primary" onClick={() => setMode('forgot')}>
              Forgot password?
            </button>
          ) : (
            <button type="button" className="text-primary" onClick={() => setMode('login')}>
              Back to sign in
            </button>
          )}
          <Link href="/register" className="font-medium text-primary">
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}

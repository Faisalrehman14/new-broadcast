'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { messages } from '@/i18n/en';
import { BrandLogo } from '@/components/BrandLogo';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<'details' | 'otp'>('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      await api('/api/auth/register/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setInfo('Check your Gmail (or inbox) for a 6-digit code.');
      setStep('otp');
      setCooldown(60);
      const t = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(t);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code');
    } finally {
      setLoading(false);
    }
  }

  async function onDetails(e: React.FormEvent) {
    e.preventDefault();
    await sendOtp();
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, otp }),
      });
      router.replace('/connect');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#dbeafe_0%,_#f8fafc_55%,_#e2e8f0_100%)]" />
      <div className="relative w-full max-w-md card p-8">
        <BrandLogo size={64} priority className="mb-4 h-16 w-16" />
        <h1 className="text-2xl font-semibold">{messages.appName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {step === 'details' ? 'Create your workspace' : 'Verify your email'}
        </p>

        {step === 'details' ? (
          <form onSubmit={onDetails} className="mt-8 space-y-4">
            <div>
              <label className="label" htmlFor="name">Name</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="email">Gmail / email</label>
              <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="input" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? 'Sending code…' : 'Send verification code'}
            </button>
          </form>
        ) : (
          <form onSubmit={onRegister} className="mt-8 space-y-4">
            <p className="text-sm text-slate-600">
              We sent a code to <strong>{email}</strong>
            </p>
            <div>
              <label className="label" htmlFor="otp">6-digit code</label>
              <input
                id="otp"
                className="input tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
              />
            </div>
            {info ? <p className="text-sm text-emerald-700">{info}</p> : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating…' : 'Verify & create account'}
            </button>
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={loading || cooldown > 0}
              onClick={() => void sendOtp()}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
            <button type="button" className="w-full text-sm text-slate-500" onClick={() => setStep('details')}>
              Change email
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

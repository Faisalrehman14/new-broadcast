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
        <p className="relative text-xs text-white/35">Start free · connect Pages in minutes</p>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(700px 400px at 80% -10%, rgba(15,118,110,0.08), transparent 50%)',
          }}
        />
        <div className="relative w-full max-w-md animate-fade-up card p-7 md:p-8">
          <div className="mb-6 lg:hidden">
            <BrandLogo size={56} priority className="mb-4 h-14 w-14" />
          </div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            {step === 'details' ? 'Create your workspace' : 'Verify your email'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {step === 'details'
              ? 'One account for all your Messenger Pages.'
              : `Enter the code we sent to ${email || 'your email'}.`}
          </p>

        {step === 'details' ? (
          <form onSubmit={onDetails} className="mt-6 space-y-4">
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
          <form onSubmit={onRegister} className="mt-6 space-y-4">
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
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
        </div>
      </div>
    </div>
  );
}

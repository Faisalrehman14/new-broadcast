'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { messages } from '@/i18n/en';
import { BrandLogo } from '@/components/BrandLogo';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('demo@pagebroadcast.local');
  const [password, setPassword] = useState('DemoPassword123!');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
          <p className="mt-1 text-sm text-slate-500">{messages.tagline}</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          No account?{' '}
          <Link href="/register" className="font-medium text-primary">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

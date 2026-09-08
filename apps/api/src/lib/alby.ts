/**
 * Alby Lightning checkout helpers (BTC invoices).
 */

const ALBY_API_BASE = 'https://api.getalby.com';
const RATE_CACHE_TTL_MS = 5 * 60 * 1000;
let btcUsdCache = { rate: 0, at: 0 };

function stripQuotes(v: string): string {
  const s = String(v || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

export function getAlbyToken(): string {
  const raw = stripQuotes(process.env.ALBY_API_TOKEN || process.env.ALBY_TOKEN || '');
  if (!raw || raw === 'your_token_here' || raw.includes('paste_here')) return '';
  if (raw.startsWith('nostr+walletconnect://')) return '';
  return raw;
}

export function getLightningAddress(): string {
  const addr = stripQuotes(process.env.ALBY_LIGHTNING_ADDRESS || '').toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : '';
}

export function isAlbyConfigured(): boolean {
  return Boolean(getAlbyToken() || getLightningAddress());
}

async function albyFetch(endpoint: string, options: RequestInit = {}) {
  const token = getAlbyToken();
  if (!token) throw Object.assign(new Error('ALBY_API_TOKEN is required'), { status: 503 });
  const response = await fetch(`${ALBY_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw Object.assign(
      new Error(String(data.message || data.error || `Alby API error (${response.status})`)),
      { status: response.status >= 500 ? 502 : 400 }
    );
  }
  return data;
}

export async function fetchBtcUsdRate(): Promise<number> {
  const now = Date.now();
  if (btcUsdCache.rate > 0 && now - btcUsdCache.at < RATE_CACHE_TTL_MS) return btcUsdCache.rate;
  const override = Number(process.env.BTC_USD_RATE || 0);
  if (override > 0) {
    btcUsdCache = { rate: override, at: now };
    return override;
  }
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { signal: AbortSignal.timeout(8000) }
    );
    const data = (await res.json()) as { bitcoin?: { usd?: number } };
    const rate = Number(data?.bitcoin?.usd);
    if (rate > 0) {
      btcUsdCache = { rate, at: now };
      return rate;
    }
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch('https://blockchain.info/ticker', {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { USD?: { last?: number; buy?: number } };
    const rate = Number(data?.USD?.last || data?.USD?.buy);
    if (rate > 0) {
      btcUsdCache = { rate, at: now };
      return rate;
    }
  } catch {
    /* fall through */
  }
  throw Object.assign(new Error('Could not fetch BTC/USD rate'), { status: 503 });
}

export function usdCentsToSats(amountCents: number, btcUsd: number): number {
  const usd = Math.max(0, Number(amountCents) || 0) / 100;
  const rate = Number(btcUsd) || 0;
  if (usd <= 0 || rate <= 0) return 0;
  return Math.max(1, Math.ceil((usd / rate) * 1e8));
}

async function createInvoiceViaLnurl(sats: number, description: string) {
  const address = getLightningAddress();
  if (!address) throw new Error('Lightning address not configured');
  const [user, domain] = address.split('@');
  const msats = Math.max(1, Math.round(Number(sats) * 1000));
  const lnurlpRes = await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user!)}`);
  const lnurlp = (await lnurlpRes.json().catch(() => ({}))) as {
    callback?: string;
    reason?: string;
    minSendable?: number;
    maxSendable?: number;
  };
  if (!lnurlpRes.ok || !lnurlp.callback) {
    throw new Error(lnurlp.reason || 'Could not load Lightning Address');
  }
  if (typeof lnurlp.minSendable === 'number' && msats < lnurlp.minSendable) {
    throw new Error('Amount too small for this Lightning Address');
  }
  if (typeof lnurlp.maxSendable === 'number' && msats > lnurlp.maxSendable) {
    throw new Error('Amount too large for this Lightning Address');
  }
  const callbackUrl = new URL(lnurlp.callback);
  callbackUrl.searchParams.set('amount', String(msats));
  if (description) callbackUrl.searchParams.set('comment', description.slice(0, 120));
  const invRes = await fetch(callbackUrl.toString());
  const inv = (await invRes.json().catch(() => ({}))) as {
    pr?: string;
    payment_hash?: string;
    reason?: string;
  };
  if (!invRes.ok || !inv.pr) throw new Error(inv.reason || 'LNURL invoice failed');
  return {
    bolt11: inv.pr,
    paymentHash: inv.payment_hash || '',
    sats,
  };
}

async function createInvoiceViaApi(sats: number, description: string) {
  const data = await albyFetch('/invoices', {
    method: 'POST',
    body: JSON.stringify({
      amount: sats,
      description: description.slice(0, 120),
      expiry: 3600,
    }),
  });
  return {
    bolt11: String(data.payment_request || data.bolt11 || ''),
    paymentHash: String(data.payment_hash || data.hash || ''),
    sats,
  };
}

export async function createLightningInvoice(input: {
  amountCents: number;
  description: string;
}): Promise<{ bolt11: string; paymentHash: string; sats: number; qrDataUrl: string }> {
  if (!isAlbyConfigured()) {
    throw Object.assign(new Error('Alby is not configured'), { status: 503 });
  }
  const rate = await fetchBtcUsdRate();
  const sats = usdCentsToSats(input.amountCents, rate);
  if (sats <= 0) throw new Error('Invalid invoice amount');

  let invoice: { bolt11: string; paymentHash: string; sats: number };
  if (getAlbyToken()) {
    try {
      invoice = await createInvoiceViaApi(sats, input.description);
    } catch (err) {
      if (!getLightningAddress()) throw err;
      invoice = await createInvoiceViaLnurl(sats, input.description);
    }
  } else {
    invoice = await createInvoiceViaLnurl(sats, input.description);
  }
  if (!invoice.bolt11) throw new Error('Alby returned empty invoice');

  const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(invoice.bolt11)}`;
  return { ...invoice, qrDataUrl };
}

export async function isInvoiceSettled(paymentHash: string): Promise<boolean> {
  if (!paymentHash) return false;
  if (!getAlbyToken()) {
    // Without API token we cannot verify settlement — reclaim will skip.
    return false;
  }
  try {
    const data = await albyFetch(`/invoices/${encodeURIComponent(paymentHash)}`);
    const state = String(data.state || data.status || '').toLowerCase();
    return state === 'settled' || Boolean(data.settled);
  } catch {
    return false;
  }
}

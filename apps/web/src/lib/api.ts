/**
 * In the browser, call same-origin `/api/...` (Next.js proxies to the API service).
 * On the server, prefer API_URL / NEXT_PUBLIC_API_URL when set.
 */
function getApiBase(): string {
  if (typeof window !== 'undefined') {
    return '';
  }
  return (
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:4000'
  );
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

let csrfTokenMemory: string | null = null;

export function setCsrfToken(token: string | null | undefined) {
  csrfTokenMemory = token || null;
  if (typeof window !== 'undefined' && token) {
    try {
      window.sessionStorage.setItem('pb_csrf', token);
    } catch {
      /* ignore */
    }
  }
}

export function getCsrfToken(): string | null {
  if (csrfTokenMemory) return csrfTokenMemory;
  if (typeof window !== 'undefined') {
    try {
      return window.sessionStorage.getItem('pb_csrf');
    } catch {
      return null;
    }
  }
  return null;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();
  const hasBody = options.body !== undefined && options.body !== null && options.body !== '';
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = getCsrfToken() || readCookie('pb_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new ApiClientError(
      'Cannot reach the API. Set API_URL on the web service to your API Railway URL.',
      'NETWORK',
      0
    );
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  const maybeCsrf = (data as { csrfToken?: string } | null)?.csrfToken;
  if (maybeCsrf) setCsrfToken(maybeCsrf);

  if (!res.ok) {
    const err = data as { error?: { message?: string; code?: string } } | null;
    throw new ApiClientError(
      err?.error?.message || 'Something went wrong. Please try again.',
      err?.error?.code,
      res.status
    );
  }

  return data as T;
}

/** Browser: same-origin path. Server: absolute when API_URL is set. */
export function apiUrl(path: string) {
  if (typeof window !== 'undefined') return path;
  const base = getApiBase();
  return `${base}${path}`;
}

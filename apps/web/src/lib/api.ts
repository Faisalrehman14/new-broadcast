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

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
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

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Runtime proxy so the browser always calls same-origin `/api/*`.
 * Set API_URL on the web service to the Railway API public (or private) URL.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!pathname.startsWith('/api/') && pathname !== '/health' && pathname !== '/ready') {
    return NextResponse.next();
  }

  const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) {
    return NextResponse.next();
  }

  const target = new URL(`${pathname}${search}`, apiBase.endsWith('/') ? apiBase : `${apiBase}/`);
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: ['/api/:path*', '/health', '/ready'],
};

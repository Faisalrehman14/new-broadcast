import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { AppError } from './errors.js';

export const CSRF_COOKIE = 'pb_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function ensureCsrfCookie(reply: FastifyReply, existing?: string): string {
  const token = existing && existing.length >= 16 ? existing : randomBytes(24).toString('hex');
  reply.setCookie(CSRF_COOKIE, token, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 14,
  });
  return token;
}

export function requireCsrf(request: FastifyRequest): void {
  const cookie = request.cookies[CSRF_COOKIE];
  const header = String(request.headers[CSRF_HEADER] || '');
  if (!cookie || !header || cookie !== header) {
    throw new AppError('FORBIDDEN', 'Invalid CSRF token. Refresh the page and try again.', 403);
  }
}

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './prisma.js';
import { AppError } from './errors.js';
import { hashToken } from './crypto.js';

const SESSION_COOKIE = 'pb_session';
const SESSION_DAYS = 14;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(
  userId: string,
  reply: FastifyReply,
  meta?: { ip?: string; userAgent?: string }
): Promise<void> {
  const raw = randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    },
  });
  reply.setCookie(SESSION_COOKIE, raw, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    expires: expiresAt,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const raw = request.cookies[SESSION_COOKIE];
  if (raw) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function getSessionUser(request: FastifyRequest): Promise<User | null> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashToken(raw),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
  return session?.user ?? null;
}

export async function requireUser(request: FastifyRequest): Promise<User> {
  const user = await getSessionUser(request);
  if (!user) throw new AppError('UNAUTHORIZED', 'Please sign in to continue.', 401);
  return user;
}

export async function requireAdmin(request: FastifyRequest): Promise<User> {
  const user = await requireUser(request);
  if (user.role !== 'ADMIN') throw new AppError('FORBIDDEN', 'Admin access required.', 403);
  return user;
}

export { SESSION_COOKIE };

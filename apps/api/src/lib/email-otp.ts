import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from './prisma.js';
import { config } from './config.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

function otpSecret(): string {
  return config.SESSION_SECRET;
}

export function hashOtp(code: string): string {
  return createHmac('sha256', otpSecret()).update(String(code).trim()).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  const from =
    (process.env.EMAIL_FROM || process.env.RESEND_FROM || 'CastMe Pro <onboarding@resend.dev>').trim();

  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        html: opts.html || `<pre>${opts.text}</pre>`,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend failed: ${res.status} ${body}`);
    }
    return;
  }

  const host = (process.env.SMTP_HOST || '').trim();
  if (host) {
    const nodemailer = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html || `<pre>${opts.text}</pre>`,
    });
    return;
  }

  if (config.NODE_ENV === 'production') {
    throw new AppError('EMAIL_NOT_CONFIGURED', 'Email delivery is not configured.', 503);
  }

  logger.info({ to: opts.to, subject: opts.subject, text: opts.text }, 'DEV email (OTP logged)');
}

export async function issueEmailOtp(email: string, purpose: 'signup' | 'password_reset') {
  const normalized = email.toLowerCase().trim();
  const latest = await prisma.emailOtpCode.findFirst({
    where: { email: normalized, purpose, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime())) / 1000);
    throw new AppError('OTP_COOLDOWN', `Wait ${wait}s before requesting another code.`, 429);
  }

  const code = String(randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.emailOtpCode.create({
    data: {
      email: normalized,
      purpose,
      otpHash: hashOtp(code),
      expiresAt,
    },
  });

  const subject =
    purpose === 'signup' ? 'Your CastMe Pro verification code' : 'Your CastMe Pro password reset code';
  const text = `Your verification code is ${code}. It expires in 10 minutes.\n\nIf you did not request this, ignore this email.`;
  await sendEmail({ to: normalized, subject, text });
  return { ok: true as const, expiresAt };
}

export async function verifyAndConsumeEmailOtp(
  email: string,
  purpose: 'signup' | 'password_reset',
  code: string
) {
  const normalized = email.toLowerCase().trim();
  const row = await prisma.emailOtpCode.findFirst({
    where: { email: normalized, purpose, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw new AppError('OTP_INVALID', 'Invalid or expired verification code.', 400);
  if (row.expiresAt.getTime() < Date.now()) {
    throw new AppError('OTP_EXPIRED', 'Verification code expired. Request a new one.', 400);
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new AppError('OTP_LOCKED', 'Too many attempts. Request a new code.', 400);
  }

  const ok = safeEqualHex(row.otpHash, hashOtp(code));
  if (!ok) {
    await prisma.emailOtpCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError('OTP_INVALID', 'Invalid or expired verification code.', 400);
  }

  await prisma.emailOtpCode.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return true;
}

export function emailDeliveryConfigured(): { resend: boolean; smtp: boolean } {
  return {
    resend: Boolean((process.env.RESEND_API_KEY || '').trim()),
    smtp: Boolean((process.env.SMTP_HOST || '').trim()),
  };
}

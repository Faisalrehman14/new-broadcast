/**
 * Per-page Messenger send gate — Meta rate-limit aware.
 * @see https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 *
 * - Caps RPS well under Messenger Send's 300/s text budget (Pages BUC is tighter).
 * - Soft-slows when BUC/App usage headers approach the ceiling.
 * - Hard-cools a Page when Meta throttles (80001/32/…) or usage ≥ hard %.
 * - Redis-backed when a client is configured so multi-worker processes share state.
 */

import {
  META_USAGE_HARD_PCT,
  META_USAGE_SOFT_PCT,
  type MetaRateLimitSnapshot,
} from '@pagebroadcast/meta-provider';

const PAGE_RPS = Math.max(2, Number(process.env.BROADCAST_PAGE_RPS || 5));
const DEFAULT_MAX_WAIT_MS = Math.max(2000, Number(process.env.BROADCAST_SEND_GATE_MS || 15000));
const COOLDOWN_KEY_PREFIX = 'castme:page-rl:';
const USAGE_KEY_PREFIX = 'castme:page-usage:';
const STRIKE_KEY_PREFIX = 'castme:page-rl-strike:';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: 'PX', ttlMs: number): Promise<unknown>;
  set(key: string, value: string, ex: 'EX', ttlSec: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
};

let redisClient: RedisLike | null = null;

const memCooldownUntil = new Map<string, number>();
const memUsagePct = new Map<string, number>();
const memStrikes = new Map<string, number>();
const pageWindows = new Map<string, { count: number; windowStart: number }>();

/** Wire BullMQ/ioredis connection so cooldowns are shared across workers. */
export function configureSendGateRedis(client: unknown) {
  redisClient = (client as RedisLike | null) ?? null;
}

function pageKey(pageId: string) {
  return String(pageId);
}

async function getCooldownUntil(pageId: string): Promise<number> {
  const pid = pageKey(pageId);
  if (redisClient) {
    try {
      const raw = await redisClient.get(`${COOLDOWN_KEY_PREFIX}${pid}`);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      /* fall through */
    }
  }
  return memCooldownUntil.get(pid) || 0;
}

async function setCooldownUntil(pageId: string, untilMs: number): Promise<void> {
  const pid = pageKey(pageId);
  const ttl = Math.max(1000, untilMs - Date.now());
  memCooldownUntil.set(pid, untilMs);
  if (redisClient) {
    try {
      await redisClient.set(`${COOLDOWN_KEY_PREFIX}${pid}`, String(untilMs), 'PX', ttl);
    } catch {
      /* mem already set */
    }
  }
}

async function getUsagePct(pageId: string): Promise<number> {
  const pid = pageKey(pageId);
  if (redisClient) {
    try {
      const raw = await redisClient.get(`${USAGE_KEY_PREFIX}${pid}`);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      /* fall through */
    }
  }
  return memUsagePct.get(pid) || 0;
}

async function setUsagePct(pageId: string, pct: number): Promise<void> {
  const pid = pageKey(pageId);
  memUsagePct.set(pid, pct);
  if (redisClient) {
    try {
      await redisClient.set(`${USAGE_KEY_PREFIX}${pid}`, String(pct), 'EX', 3600);
    } catch {
      /* mem already set */
    }
  }
}

async function bumpStrike(pageId: string): Promise<number> {
  const pid = pageKey(pageId);
  if (redisClient) {
    try {
      const key = `${STRIKE_KEY_PREFIX}${pid}`;
      const n = await redisClient.incr(key);
      await redisClient.expire(key, 3600);
      return n;
    } catch {
      /* fall through */
    }
  }
  const n = (memStrikes.get(pid) || 0) + 1;
  memStrikes.set(pid, n);
  return n;
}

/** Cooldown length from Meta recover time, else exponential strike backoff. */
export function cooldownMsFromMeta(
  snap: MetaRateLimitSnapshot | undefined,
  strike: number
): number {
  const fromMeta =
    snap?.estimatedTimeToRegainAccessMin != null && snap.estimatedTimeToRegainAccessMin > 0
      ? Math.ceil(snap.estimatedTimeToRegainAccessMin * 60_000)
      : 0;
  const ladder = [30_000, 120_000, 300_000, 600_000];
  const idx = Math.min(Math.max(strike - 1, 0), ladder.length - 1);
  const fromStrike = ladder[idx]!;
  return Math.min(Math.max(fromMeta, fromStrike, 15_000), 15 * 60_000);
}

export async function pageCooldownRemainingMs(pageId: string): Promise<number> {
  const until = await getCooldownUntil(pageId);
  return Math.max(0, until - Date.now());
}

/**
 * Record Meta usage / throttle for a Page. Sets cooldown when hard-throttled.
 * Returns remaining cooldown ms (0 if none).
 */
export async function recordPageMetaUsage(
  pageId: string,
  snap?: MetaRateLimitSnapshot | null,
  opts?: { throttled?: boolean }
): Promise<{ cooldownMs: number; usagePct: number }> {
  if (!pageId) return { cooldownMs: 0, usagePct: 0 };
  const usagePct = snap?.maxUsagePercent ?? (await getUsagePct(pageId));
  if (snap && snap.source !== 'none') {
    await setUsagePct(pageId, usagePct);
  }

  const hard =
    Boolean(opts?.throttled) ||
    usagePct >= META_USAGE_HARD_PCT ||
    (snap?.estimatedTimeToRegainAccessMin != null && snap.estimatedTimeToRegainAccessMin > 0);

  if (hard) {
    const strike = await bumpStrike(pageId);
    const ms = cooldownMsFromMeta(snap || undefined, strike);
    const until = Date.now() + ms;
    const existing = await getCooldownUntil(pageId);
    if (until > existing) await setCooldownUntil(pageId, until);
    return { cooldownMs: Math.max(0, (await getCooldownUntil(pageId)) - Date.now()), usagePct };
  }

  return { cooldownMs: await pageCooldownRemainingMs(pageId), usagePct };
}

function effectiveRps(usagePct: number): number {
  if (usagePct >= META_USAGE_SOFT_PCT) {
    return Math.max(1, Math.floor(PAGE_RPS / 2));
  }
  return PAGE_RPS;
}

function checkAndMark(pageId: string, rps: number): { ok: boolean; waitMs: number } {
  const pid = pageKey(pageId);
  const now = Date.now();
  let win = pageWindows.get(pid);
  if (!win || now - win.windowStart >= 1000) {
    win = { count: 0, windowStart: now };
    pageWindows.set(pid, win);
  }
  if (win.count >= rps) {
    return { ok: false, waitMs: Math.max(50, 1000 - (now - win.windowStart)) };
  }
  win.count += 1;
  return { ok: true, waitMs: 0 };
}

/** Wait until a per-page send slot is available, or throw if the deadline expires. */
export async function acquirePageSendSlot(
  pageId: string,
  maxWaitMs = DEFAULT_MAX_WAIT_MS
): Promise<void> {
  if (!pageId) return;
  const deadline = Date.now() + Math.max(200, maxWaitMs);

  while (Date.now() < deadline) {
    const coolLeft = await pageCooldownRemainingMs(pageId);
    if (coolLeft > 0) {
      const wait = Math.min(coolLeft, Math.max(0, deadline - Date.now()), 2000);
      if (wait <= 0 || Date.now() + wait > deadline) {
        const err = new Error(
          `Page send cooled down for Meta rate limit (~${Math.ceil(coolLeft / 1000)}s left)`
        ) as Error & { status?: number; retryable?: boolean; cooldownMs?: number };
        err.status = 429;
        err.retryable = true;
        err.cooldownMs = coolLeft;
        throw err;
      }
      await sleep(wait);
      continue;
    }

    const usagePct = await getUsagePct(pageId);
    const rps = effectiveRps(usagePct);
    const slot = checkAndMark(pageId, rps);
    if (slot.ok) return;
    await sleep(Math.min(slot.waitMs, Math.max(0, deadline - Date.now())));
  }

  const coolLeft = await pageCooldownRemainingMs(pageId);
  const err = new Error(
    coolLeft > 0
      ? `Page send cooled down for Meta rate limit (~${Math.ceil(coolLeft / 1000)}s left)`
      : 'Page send rate gate timed out'
  ) as Error & { status?: number; retryable?: boolean; cooldownMs?: number };
  err.status = 429;
  err.retryable = true;
  err.cooldownMs = coolLeft;
  throw err;
}

/** Test helpers — clear in-memory state. */
export function __resetSendGateForTests() {
  memCooldownUntil.clear();
  memUsagePct.clear();
  memStrikes.clear();
  pageWindows.clear();
  redisClient = null;
}

export { PAGE_RPS, META_USAGE_HARD_PCT, META_USAGE_SOFT_PCT };

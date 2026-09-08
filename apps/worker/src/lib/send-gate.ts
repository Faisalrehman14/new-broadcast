/**
 * Lightweight per-page send gate (RPS) — ported from fb-page-manager broadcast-send-gate.
 * Keeps Graph traffic under Meta page budgets without a full Redis BUC stack.
 */

const PAGE_RPS = Math.max(2, Number(process.env.BROADCAST_PAGE_RPS || 8));
const DEFAULT_MAX_WAIT_MS = Math.max(2000, Number(process.env.BROADCAST_SEND_GATE_MS || 15000));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pageWindows = new Map<string, { count: number; windowStart: number }>();

function checkAndMark(pageId: string): { ok: boolean; waitMs: number } {
  const pid = String(pageId);
  const now = Date.now();
  let win = pageWindows.get(pid);
  if (!win || now - win.windowStart >= 1000) {
    win = { count: 0, windowStart: now };
    pageWindows.set(pid, win);
  }
  if (win.count >= PAGE_RPS) {
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
    const slot = checkAndMark(pageId);
    if (slot.ok) return;
    await sleep(Math.min(slot.waitMs, Math.max(0, deadline - Date.now())));
  }
  const err = new Error('Page send rate gate timed out') as Error & {
    status?: number;
    retryable?: boolean;
  };
  err.status = 429;
  err.retryable = true;
  throw err;
}

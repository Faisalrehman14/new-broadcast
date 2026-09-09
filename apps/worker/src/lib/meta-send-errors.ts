/** Classify Meta Graph Send API errors for campaign delivery. */

export type MetaSendErrorKind =
  | 'retryable'
  | 'recipient_unavailable'
  | 'recipient_invalid'
  | 'outside_window'
  | 'permission'
  | 'token'
  | 'permanent';

export type ClassifiedMetaSendError = {
  kind: MetaSendErrorKind;
  code?: number;
  subcode?: number;
  /** Short machine code for DB / UI */
  reason: string;
  /** Human-readable, no raw Graph JSON dump */
  message: string;
  retryable: boolean;
  /** Mark contact inactive / blocked for future campaigns */
  deactivateContact: boolean;
};

/** True 24h / policy window subcodes (not bare code 10). */
const WINDOW_SUBCODES = new Set([2018278, 2018065, 2534022]);

function parseGraphPayload(raw: string): { code?: number; subcode?: number; message?: string } {
  try {
    const jsonStart = raw.indexOf('{');
    if (jsonStart < 0) return {};
    const parsed = JSON.parse(raw.slice(jsonStart)) as {
      error?: { code?: number; error_subcode?: number; message?: string };
      code?: number;
      error_subcode?: number;
      message?: string;
    };
    const err = parsed.error || parsed;
    return {
      code: typeof err.code === 'number' ? err.code : undefined,
      subcode: typeof err.error_subcode === 'number' ? err.error_subcode : undefined,
      message: typeof err.message === 'string' ? err.message : undefined,
    };
  } catch {
    return {};
  }
}

export function classifyMetaSendError(err: unknown): ClassifiedMetaSendError {
  const e = err as Error & {
    status?: number;
    retryable?: boolean;
    code?: number;
    subcode?: number;
    errorCode?: number;
    errorSubcode?: number;
  };
  const text = e?.message || String(err);
  const fromJson = parseGraphPayload(text);
  const code = e.code ?? e.errorCode ?? fromJson.code;
  const subcode = e.subcode ?? e.errorSubcode ?? fromJson.subcode;
  const http = e.status;
  const blob = `${fromJson.message || ''} ${text}`.toLowerCase();

  // Rate / transient platform
  if (
    e.retryable ||
    http === 429 ||
    (http !== undefined && http >= 500) ||
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 ||
    code === 80001 ||
    code === 80006 ||
    /rate limit|temporarily|try again/i.test(text)
  ) {
    return {
      kind: 'retryable',
      code,
      subcode,
      reason: 'rate_limited',
      message: 'Meta rate limited this send — will retry.',
      retryable: true,
      deactivateContact: false,
    };
  }

  // Invalid PSID for this Page/app
  if (code === 100 && (subcode === 2018001 || /no matching user found/i.test(text))) {
    return {
      kind: 'recipient_invalid',
      code,
      subcode,
      reason: 'recipient_invalid',
      message: 'No matching user for this Page (invalid or foreign PSID).',
      retryable: false,
      deactivateContact: true,
    };
  }

  // Blocked / deactivated / not receiving (incl. 10/2018108 — NOT the messaging window)
  if (
    code === 551 ||
    subcode === 1545041 ||
    subcode === 1893047 ||
    subcode === 2018108 ||
    /isn'?t available right now|isn'?t receiving messages|recipient not available|cannot receive messages|can'?t receive your messages/i.test(
      blob
    )
  ) {
    return {
      kind: 'recipient_unavailable',
      code,
      subcode,
      reason: 'recipient_unavailable',
      message: 'Recipient unavailable (blocked, muted, filtered, or not accepting messages).',
      retryable: false,
      deactivateContact: true,
    };
  }

  // True 24h / policy window — subcode-first (bare code 10 is overloaded).
  // When our worker wraps a failed UTILITY attempt, prefer the utility-specific reason.
  if (
    (subcode !== undefined && WINDOW_SUBCODES.has(subcode)) ||
    /outside of allowed window|outside.*messaging window|24.?hour window/i.test(blob)
  ) {
    const utilityAttempt = /UTILITY send failed|utility_window_rejected/i.test(text);
    return {
      kind: 'outside_window',
      code,
      subcode,
      reason: utilityAttempt ? 'utility_window_rejected' : 'outside_window',
      message: utilityAttempt
        ? 'Meta rejected UTILITY outside the 24h window. Reconnect Facebook, tick this Page in the picker, grant Utility Messaging (pages_utility_messaging), and confirm the template language (en / en_US) is APPROVED.'
        : 'Outside the 24h messaging window (RESPONSE blocked). CastMe should fall back to UTILITY — if this still appears, Instant UTILITY is not delivering for this Page.',
      retryable: false,
      deactivateContact: false,
    };
  }

  if (code === 190 || /session has expired|invalid oauth|access token/i.test(text)) {
    return {
      kind: 'token',
      code,
      subcode,
      reason: 'token_expired',
      message: 'Page token expired — reconnect Facebook.',
      retryable: false,
      deactivateContact: false,
    };
  }

  // Missing pages_utility_messaging / app permission (often bare Graph #10)
  if (
    code === 10 ||
    code === 200 ||
    /pages_utility_messaging|application does not have permission|permission.*does not have|pages_messaging/i.test(
      blob
    )
  ) {
    return {
      kind: 'permission',
      code,
      subcode,
      reason: 'utility_permission_missing',
      message:
        'Missing Utility Messaging permission for this Page. Reconnect Facebook, select this Page in the picker, and approve pages_utility_messaging.',
      retryable: false,
      deactivateContact: false,
    };
  }

  return {
    kind: 'permanent',
    code,
    subcode,
    reason: 'send_failed',
    message: fromJson.message || text.slice(0, 240),
    retryable: false,
    deactivateContact: false,
  };
}

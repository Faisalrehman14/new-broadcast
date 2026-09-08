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

  // Blocked / deactivated / not receiving messages
  if (
    code === 551 ||
    code === 200 ||
    subcode === 1545041 ||
    subcode === 1893047 ||
    /isn'?t available right now|isn'?t receiving messages|recipient not available/i.test(text)
  ) {
    return {
      kind: 'recipient_unavailable',
      code,
      subcode,
      reason: 'recipient_unavailable',
      message: 'Recipient unavailable (blocked, deactivated, or not accepting messages).',
      retryable: false,
      deactivateContact: true,
    };
  }

  // 24h / policy window
  if (
    code === 10 ||
    subcode === 2018108 ||
    subcode === 2018028 ||
    /outside.*allowed window|cannot message this person|messaging window/i.test(text)
  ) {
    return {
      kind: 'outside_window',
      code,
      subcode,
      reason: 'outside_window',
      message: 'Outside messaging window and UTILITY could not deliver.',
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

  if (code === 200 || /permission|pages_messaging|utility/i.test(text)) {
    return {
      kind: 'permission',
      code,
      subcode,
      reason: 'permission_denied',
      message: 'Meta permission denied for this send.',
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

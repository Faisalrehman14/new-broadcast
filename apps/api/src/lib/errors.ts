export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const FRIENDLY: Record<string, string> = {
  UNAUTHORIZED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  VALIDATION: 'Please check your input and try again.',
  FACEBOOK_EXPIRED: 'Facebook connection expired. Please reconnect your account.',
  FACEBOOK_ERROR: 'We could not complete the Facebook request. Please try again.',
  TEMPLATE_NOT_APPROVED: 'This template must be approved before starting the broadcast.',
  TEMPLATE_BODY_MISSING: 'This template body is not available yet. Ask an admin to import it.',
  INVALID_TRANSITION: 'This action is not allowed for the current broadcast status.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  CONFLICT: 'This action conflicts with the current state.',
  QUOTA_EXCEEDED: 'Monthly message quota exceeded.',
};

export function toFriendlyMessage(code: string, fallback?: string): string {
  return FRIENDLY[code] ?? fallback ?? 'Something went wrong. Please try again.';
}

export function mapMetaError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  // Meta labels almost every Graph failure as type "OAuthException" — do NOT treat that as expiry.
  // Real access-token expiry is Graph code 190 (or explicit session/token validation text).
  const expired =
    /"code"\s*:\s*190\b/.test(message) ||
    /\(#190\)/.test(message) ||
    /error_subcode"\s*:\s*463\b/.test(message) || // session invalidated
    /error_subcode"\s*:\s*467\b/.test(message) || // invalid/expired token
    /session has expired/i.test(message) ||
    /error validating access token/i.test(message) ||
    /access token .* expired/i.test(message);
  if (expired) {
    return new AppError('FACEBOOK_EXPIRED', toFriendlyMessage('FACEBOOK_EXPIRED'), 401, {
      internal: message,
    });
  }
  return new AppError('FACEBOOK_ERROR', toFriendlyMessage('FACEBOOK_ERROR'), 502, {
    internal: message,
  });
}

/** Map OAuth callback failures to connect?error= slugs (more specific than mapMetaError). */
export function oauthConnectErrorSlug(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/redirect_uri/i.test(message)) return 'redirect';
  if (/token exchange failed/i.test(message)) return 'token';
  if (/long-lived/i.test(message)) return 'long_lived';
  if (/getAuthorizedUser/i.test(message)) return 'profile';
  if (/encrypt|ENCRYPTION/i.test(message)) return 'config';
  if (mapMetaError(err).code === 'FACEBOOK_EXPIRED') return 'expired';
  if (/code has (been )?used|authorization code.*expired|invalid.*code/i.test(message)) {
    return 'token';
  }
  if (/app secret|client_secret|invalid client/i.test(message)) return 'secret';
  return 'facebook';
}

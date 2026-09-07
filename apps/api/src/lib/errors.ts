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
};

export function toFriendlyMessage(code: string, fallback?: string): string {
  return FRIENDLY[code] ?? fallback ?? 'Something went wrong. Please try again.';
}

export function mapMetaError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  if (/190|OAuthException|session has expired/i.test(message)) {
    return new AppError('FACEBOOK_EXPIRED', toFriendlyMessage('FACEBOOK_EXPIRED'), 401);
  }
  return new AppError('FACEBOOK_ERROR', toFriendlyMessage('FACEBOOK_ERROR'), 502, {
    internal: message,
  });
}

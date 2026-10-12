/**
 * Every error code the API can return, with its HTTP status (CLAUDE.md).
 * The ErrorCode type is derived from these keys, so the two cannot drift apart.
 */
export const ERROR_HTTP_STATUS = {
  BOOKING_CLOSED: 409,
  CHART_LOCKED: 409,
  WINDOW_STILL_OPEN: 409,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

/**
 * An expected, client-facing failure (e.g. booking after the window closed).
 * The HTTP status always comes from the code, never from the caller.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.details = details;
  }
}

/**
 * A broken rule that correct code can never trigger: an illegal state transition
 * or a violated precondition. It signals a bug, so the API answers 500.
 */
export class InvariantViolationError extends Error {
  override readonly name = 'InvariantViolationError';
}

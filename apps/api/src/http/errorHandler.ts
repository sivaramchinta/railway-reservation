import type { ErrorBody } from '@railway/shared';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../domain/errors';

/** body-parser's error for a body that is not valid JSON. */
function isMalformedJson(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  );
}

function send(res: Response, status: number, error: ErrorBody['error']): void {
  res.status(status).json({ error } satisfies ErrorBody);
}

/** Unknown /api route → the same JSON error shape as everything else. */
export function notFoundHandler(_req: Request, res: Response): void {
  send(res, 404, { code: 'NOT_FOUND', message: 'No such endpoint' });
}

/**
 * The ONE place errors become HTTP responses. Express 5 forwards errors thrown
 * (or rejected) in async handlers here automatically.
 * - AppError → its own status and stable code;
 * - malformed JSON → 422 VALIDATION_FAILED;
 * - anything else is a bug → 500 INTERNAL_ERROR, logged with the request id,
 *   with no internals leaked to the client.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof AppError) {
    send(res, error.httpStatus, {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
    return;
  }
  if (isMalformedJson(error)) {
    send(res, 422, { code: 'VALIDATION_FAILED', message: 'Request body is not valid JSON' });
    return;
  }
  req.log.error({ err: error }, 'Unhandled error');
  send(res, 500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' });
}

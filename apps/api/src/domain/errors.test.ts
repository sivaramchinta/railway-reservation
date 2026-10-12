import { describe, expect, it } from '@jest/globals';
import { AppError, ERROR_HTTP_STATUS, type ErrorCode, InvariantViolationError } from './errors';

describe('AppError', () => {
  const cases = Object.entries(ERROR_HTTP_STATUS) as [ErrorCode, number][];

  it.each(cases)('%s maps to HTTP %i', (code, status) => {
    const error = new AppError(code, 'message');
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(status);
  });

  it('matches the status table in CLAUDE.md exactly', () => {
    expect(ERROR_HTTP_STATUS).toEqual({
      BOOKING_CLOSED: 409,
      CHART_LOCKED: 409,
      WINDOW_STILL_OPEN: 409,
      VALIDATION_FAILED: 422,
      NOT_FOUND: 404,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
    });
  });

  it('is a real Error carrying message, name and optional details', () => {
    const details = { field: 'passengers' };
    const error = new AppError('VALIDATION_FAILED', 'bad input', details);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.message).toBe('bad input');
    expect(error.details).toBe(details);
    expect(new AppError('NOT_FOUND', 'missing').details).toBeUndefined();
  });
});

describe('InvariantViolationError', () => {
  it('is an Error with its own name', () => {
    const error = new InvariantViolationError('broken');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvariantViolationError');
    expect(error.message).toBe('broken');
  });
});

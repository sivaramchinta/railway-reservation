import { z } from 'zod';

/** Every error code the API returns (stable, machine-readable; DESIGN_SPEC §9). */
export const ERROR_CODES = [
  'BOOKING_CLOSED',
  'CHART_LOCKED',
  'WINDOW_STILL_OPEN',
  'INVALID_WINDOW_TRANSITION',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  /** Unexpected server failure (HTTP 500). */
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof ERROR_CODES)[number];

/** Every error response: { error: { code, message, details? } }. */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

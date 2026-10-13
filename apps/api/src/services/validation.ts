import { z } from 'zod';
import { AppError } from '../domain/errors';

/**
 * Parses `input` with a Zod schema. Returns the typed result, or throws
 * VALIDATION_FAILED (422) with the flattened issues as details.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', message, z.flattenError(result.error));
  }
  return result.data;
}

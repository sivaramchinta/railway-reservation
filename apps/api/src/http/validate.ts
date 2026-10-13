import type { Request } from 'express';
import type { z } from 'zod';
import { parseOrThrow } from '../services/validation';

/**
 * Parses body, params and query TOGETHER with one Zod schema of the shape
 * { body, params, query }, so a bad request reports every problem at once
 * (paths like "body.passengers.0.name"). Returns the typed, transformed values.
 */
export function validateRequest<T>(req: Request, schema: z.ZodType<T>): T {
  return parseOrThrow(
    schema,
    { body: req.body as unknown, params: req.params, query: req.query },
    'Invalid request',
  );
}

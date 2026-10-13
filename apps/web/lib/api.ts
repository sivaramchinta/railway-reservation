import { type ApiErrorCode, ErrorBodySchema } from '@railway/shared';
import type { z } from 'zod';

/** API error codes plus two that only the client can produce. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'BAD_RESPONSE';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ClientErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin', // send the session cookie
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the server', 0);
  }
}

async function failure(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => undefined);
  const parsed = ErrorBodySchema.safeParse(body);
  return parsed.success
    ? new ApiError(
        parsed.data.error.code,
        parsed.data.error.message,
        res.status,
        parsed.data.error.details,
      )
    : new ApiError('INTERNAL_ERROR', `HTTP ${res.status}`, res.status);
}

/**
 * The one way the UI calls the API. The response is parsed with the SAME Zod
 * schema the API is tested against, so a contract mismatch is a clear error,
 * not a silent `undefined` on screen.
 */
export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const res = await send(path, options);
  if (!res.ok) throw await failure(res);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError('BAD_RESPONSE', 'Unexpected response from the server', res.status);
  }
  return parsed.data;
}

/** For endpoints that answer 204 No Content. */
export async function apiRequestNoContent(path: string, options: RequestOptions): Promise<void> {
  const res = await send(path, options);
  if (!res.ok) throw await failure(res);
}

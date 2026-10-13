import { z } from 'zod';

/** POST /api/session body. The email is trimmed and lower-cased before it is checked. */
export const SignInRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('A valid email address is required')),
});
export type SignInRequest = z.infer<typeof SignInRequestSchema>;

/** GET/POST /api/session response. */
export const SessionDtoSchema = z.object({
  email: z.string(),
  isAdmin: z.boolean(),
});
export type SessionDto = z.infer<typeof SessionDtoSchema>;

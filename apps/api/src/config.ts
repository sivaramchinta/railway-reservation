import { z } from 'zod';

export interface AppConfig {
  sessionSecret: string;
  /** Lower-cased admin emails (ADMIN_EMAILS, comma-separated). */
  adminEmails: ReadonlySet<string>;
  /** Send the session cookie only over HTTPS (production). */
  secureCookies: boolean;
  port: number;
  logLevel: string;
}

const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';

const EnvSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    ADMIN_EMAILS: z.string().default(''),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.string().default('info'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SESSION_SECRET !== PLACEHOLDER_SECRET, {
    message: 'Set a real SESSION_SECRET in production (e.g. `openssl rand -hex 32`)',
    path: ['SESSION_SECRET'],
  });

/** Reads and validates the environment once, at start-up. Fails fast with a clear message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const parsed = result.data;
  return {
    sessionSecret: parsed.SESSION_SECRET,
    adminEmails: new Set(
      parsed.ADMIN_EMAILS.split(',')
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email !== ''),
    ),
    secureCookies: parsed.NODE_ENV === 'production',
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
  };
}

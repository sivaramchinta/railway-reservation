import type { SessionDto } from '@railway/shared';
import { type CookieOptions, Router } from 'express';
import type { AppConfig } from '../config';
import { currentUser, isAdminEmail, requireUser, SESSION_COOKIE } from '../http/auth';
import { signIn } from '../services/sessionService';

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionRoutes(config: AppConfig): Router {
  const router = Router();
  const cookieOptions: CookieOptions = {
    httpOnly: true, // page JavaScript cannot read it
    signed: true, // HMAC with SESSION_SECRET: tampering is detected
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
  };

  // POST /api/session { email } → upsert the user, set the session cookie.
  router.post('/', async (req, res) => {
    const user = await signIn(req.body);
    res.cookie(SESSION_COOKIE, String(user.id), { ...cookieOptions, maxAge: SESSION_MAX_AGE_MS });
    res.json({ email: user.email, isAdmin: isAdminEmail(config, user.email) } satisfies SessionDto);
  });

  // GET /api/session → who am I (401 if signed out).
  router.get('/', requireUser(config), (req, res) => {
    const user = currentUser(req);
    res.json({ email: user.email, isAdmin: user.isAdmin } satisfies SessionDto);
  });

  // DELETE /api/session → sign out.
  router.delete('/', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });

  return router;
}

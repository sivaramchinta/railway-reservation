import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config';
import { AppError } from '../domain/errors';
import { findUser } from '../services/sessionService';

export const SESSION_COOKIE = 'session';

export interface SessionUser {
  id: number;
  email: string;
  isAdmin: boolean;
}

// Declaration merging: adds a typed `user` to Express's Request type.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the only way to augment Express's global types
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function isAdminEmail(config: AppConfig, email: string): boolean {
  return config.adminEmails.has(email.toLowerCase());
}

/**
 * 401 unless the signed session cookie names an existing user. A tampered cookie
 * fails the signature check (cookie-parser returns false) and counts as signed out.
 */
export function requireUser(config: AppConfig) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const cookies = req.signedCookies as Record<string, string | false | undefined>;
    const raw = cookies[SESSION_COOKIE];
    const userId = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
    const user = userId === null ? null : await findUser(userId);
    if (user === null) throw new AppError('UNAUTHENTICATED', 'Sign in first');
    req.user = { id: user.id, email: user.email, isAdmin: isAdminEmail(config, user.email) };
    next();
  };
}

/** 403 unless the signed-in user is an admin. Use after requireUser. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.isAdmin !== true) throw new AppError('FORBIDDEN', 'Admins only');
  next();
}

/** The user that requireUser attached. Throws if a route forgot requireUser. */
export function currentUser(req: Request): SessionUser {
  if (req.user === undefined) throw new AppError('UNAUTHENTICATED', 'Sign in first');
  return req.user;
}

// v7: gate every request when SSO is on and run it inside the authenticated user's context.
import type { NextFunction, Request, Response } from 'express';
import { runWithUser } from '../storage/user-scope.js';
import type { AuthStore, AuthUser } from './auth-store.js';

export const SESSION_COOKIE = 'od_session';
const OPEN_API = new Set(['/api/health', '/health', '/api/ready', '/ready', '/api/version', '/version']);

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Resolves a daemon-issued run-scoped tool token to the user who owns the run's project. */
export type ToolTokenOwner = (token: string) => string | null;

export function userForRequest(store: AuthStore, req: Request, toolTokenOwner?: ToolTokenOwner): AuthUser | null {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer odt_')) return store.userForApiToken(auth.slice(7));
  if (auth.startsWith('Bearer ') && toolTokenOwner) {
    const owner = toolTokenOwner(auth.slice(7).trim());
    return owner ? store.getUser(owner) : null;
  }
  const sid = readCookie(req, SESSION_COOKIE);
  return sid ? store.userForSession(sid) : null;
}

export function createAuthMiddleware({ store, enabled, toolTokenOwner }: { store: AuthStore; enabled: boolean; toolTokenOwner?: ToolTokenOwner }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) return next();
    const p = req.path;
    if (OPEN_API.has(p) || p.startsWith('/api/auth/')) return next();
    const user = userForRequest(store, req, toolTokenOwner);
    if (user) {
      (req as Request & { authUser?: AuthUser }).authUser = user;
      return runWithUser(user.id, next);
    }
    if (p.startsWith('/api/') || req.method !== 'GET') {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } });
      return;
    }
    res.redirect(302, '/api/auth/login');
  };
}

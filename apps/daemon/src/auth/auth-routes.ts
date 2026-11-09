// v7: OIDC login (PKCE + state), logout, me, per-user API tokens, one-time admin reset link.
import type { Express, Request, Response } from 'express';
import * as oidc from 'openid-client';
import { readCookie, SESSION_COOKIE, userForRequest } from './auth-middleware.js';
import type { AuthStore } from './auth-store.js';

const SESSION_TTL_MS = 7 * 24 * 3600_000;
const PENDING_TTL_MS = 10 * 60_000;

export interface OidcAdapter {
  authorizationUrl(redirectUri: string, state: string, verifier: string): Promise<string>;
  exchange(currentUrl: URL, state: string, verifier: string): Promise<{ sub: string; issuer: string; email?: string | undefined; name?: string | undefined }>;
}

export interface OidcConfig { issuer: URL; clientId: string; clientSecret?: string | undefined; publicUrl: string }

/** SSO is on only when issuer + client id + public URL are all set; malformed values fail boot loudly. */
export function loadOidcConfig(env: NodeJS.ProcessEnv): OidcConfig | null {
  const issuer = env.OD_OIDC_ISSUER?.trim();
  const clientId = env.OD_OIDC_CLIENT_ID?.trim();
  const publicUrl = env.OD_PUBLIC_URL?.trim();
  if (!issuer && !clientId) return null;
  if (!issuer || !clientId || !publicUrl) throw new Error('SSO needs OD_OIDC_ISSUER, OD_OIDC_CLIENT_ID and OD_PUBLIC_URL');
  try {
    new URL(publicUrl);
    return { issuer: new URL(issuer), clientId, clientSecret: env.OD_OIDC_CLIENT_SECRET?.trim() || undefined, publicUrl };
  } catch {
    throw new Error('OD_OIDC_ISSUER and OD_PUBLIC_URL must be absolute URLs');
  }
}

export function openIdClientAdapter(cfg: OidcConfig): OidcAdapter {
  let config: Promise<oidc.Configuration> | null = null;
  // Drop a failed discovery so the next login retries instead of failing forever.
  const get = () => (config ??= oidc.discovery(cfg.issuer, cfg.clientId, cfg.clientSecret).catch((e) => { config = null; throw e; }));
  return {
    async authorizationUrl(redirectUri, state, verifier) {
      return oidc.buildAuthorizationUrl(await get(), {
        redirect_uri: redirectUri, scope: 'openid email profile', state,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
      }).href;
    },
    async exchange(currentUrl, state, verifier) {
      const c = await get();
      const tokens = await oidc.authorizationCodeGrant(c, currentUrl, { pkceCodeVerifier: verifier, expectedState: state });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('ID token has no sub');
      return { sub: claims.sub, issuer: c.serverMetadata().issuer, email: claims.email as string | undefined, name: claims.name as string | undefined };
    },
  };
}

export function registerAuthRoutes(app: Express, opts: {
  store: AuthStore; enabled: boolean; publicUrl: string; adapter: OidcAdapter | null;
  onFirstAdmin?: (adminId: string) => void;
}) {
  const { store, enabled, publicUrl, adapter } = opts;
  const secure = publicUrl.startsWith('https:');
  const redirectUri = new URL('/api/auth/callback', publicUrl).href;
  const pending = new Map<string, { verifier: string; at: number }>();
  const setSession = (res: Response, userId: string) => {
    res.cookie(SESSION_COOKIE, store.createSession(userId, SESSION_TTL_MS), {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_TTL_MS,
    });
  };
  const requireUser = (req: Request, res: Response) => {
    const u = enabled ? userForRequest(store, req) : null;
    if (!u) res.status(enabled ? 401 : 404).json({ error: { code: enabled ? 'UNAUTHENTICATED' : 'SSO_DISABLED', message: enabled ? 'Sign in required' : 'SSO is not configured' } });
    return u;
  };

  app.get('/api/auth/me', (req, res) => {
    if (!enabled) return void res.json({ ssoEnabled: false, user: null });
    const u = requireUser(req, res);
    if (u) res.json({ ssoEnabled: true, user: u });
  });

  app.get('/api/auth/login', async (_req, res) => {
    if (!enabled || !adapter) return void res.redirect(302, '/');
    const now = Date.now();
    for (const [k, v] of pending) if (now - v.at > PENDING_TTL_MS) pending.delete(k);
    const state = oidc.randomState();
    const verifier = oidc.randomPKCECodeVerifier();
    pending.set(state, { verifier, at: now });
    try { res.redirect(302, await adapter.authorizationUrl(redirectUri, state, verifier)); }
    catch { res.status(502).json({ error: { code: 'OIDC_UNAVAILABLE', message: 'Identity provider unreachable' } }); }
  });

  app.get('/api/auth/callback', async (req, res) => {
    if (!enabled || !adapter) return void res.redirect(302, '/');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const entry = pending.get(state);
    pending.delete(state);
    if (!entry || Date.now() - entry.at > PENDING_TTL_MS) {
      return void res.status(400).json({ error: { code: 'OIDC_STATE_INVALID', message: 'Login expired, try again' } });
    }
    try {
      const claims = await adapter.exchange(new URL(req.originalUrl, publicUrl), state, entry.verifier);
      const hadAdmin = store.firstAdmin() !== null;
      const user = store.upsertUser(claims);
      if (!hadAdmin && user.isAdmin) {
        // A failed data adoption must not block the admin from signing in.
        try { opts.onFirstAdmin?.(user.id); } catch (e) { console.warn('[auth] adopting local data failed', e); }
      }
      setSession(res, user.id);
      res.redirect(302, '/');
    } catch {
      res.status(401).json({ error: { code: 'OIDC_LOGIN_FAILED', message: 'Login failed' } });
    }
  });

  app.get('/api/auth/admin-reset', (req, res) => {
    const t = typeof req.query.token === 'string' ? req.query.token : '';
    const admin = enabled && t ? store.consumeAdminResetToken(t) : null;
    if (!admin) return void res.status(401).json({ error: { code: 'RESET_INVALID', message: 'Invalid or used link' } });
    setSession(res, admin.id);
    res.redirect(302, '/');
  });

  app.post('/api/auth/logout', (req, res) => {
    const sid = readCookie(req, SESSION_COOKIE);
    if (sid) store.deleteSession(sid);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/tokens', (req, res) => {
    const u = requireUser(req, res);
    if (u) res.json({ tokens: store.listApiTokens(u.id) });
  });
  app.post('/api/auth/tokens', (req, res) => {
    const u = requireUser(req, res);
    if (!u) return;
    const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim().slice(0, 80) : 'token';
    res.status(201).json(store.createApiToken(u.id, label));
  });
  app.delete('/api/auth/tokens/:id', (req, res) => {
    const u = requireUser(req, res);
    if (!u) return;
    if (!store.revokeApiToken(u.id, req.params.id)) return void res.status(404).json({ error: { code: 'TOKEN_NOT_FOUND', message: 'No such token' } });
    res.json({ ok: true });
  });
}

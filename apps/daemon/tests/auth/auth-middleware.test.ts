import Database from 'better-sqlite3';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthStore } from '../../src/auth/auth-store.js';
import { createAuthMiddleware, SESSION_COOKIE } from '../../src/auth/auth-middleware.js';
import { resolveUserId } from '../../src/storage/user-scope.js';

let close: (() => void) | null = null;
afterEach(() => { close?.(); close = null; });

async function serve(enabled: boolean) {
  const store = createAuthStore(new Database(':memory:'));
  const app = express();
  app.use(createAuthMiddleware({ store, enabled }));
  app.get('/api/health', (_q, r) => { r.json({ ok: true }); });
  app.get('/api/auth/login', (_q, r) => { r.json({ login: true }); });
  app.get('/api/whoami', async (_q, r) => { await new Promise((x) => setTimeout(x, 5)); r.json({ user: resolveUserId({}) }); });
  app.get('/', (_q, r) => { r.send('app'); });
  const s = app.listen(0); close = () => s.close();
  return { store, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
}

describe('auth middleware (v7)', () => {
  it('AC3: disabled → synthetic local user, no gate', async () => {
    const { url } = await serve(false);
    expect(await (await fetch(`${url}/api/whoami`)).json()).toEqual({ user: 'local' });
  });

  it('AC1: unauthenticated /api → 401, browser page → redirect to login, allow-list open', async () => {
    const { url } = await serve(true);
    expect((await fetch(`${url}/api/whoami`)).status).toBe(401);
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    expect((await fetch(`${url}/api/auth/login`)).status).toBe(200);
    const page = await fetch(`${url}/`, { redirect: 'manual' });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/api/auth/login');
  });

  it('AC2: session cookie and bearer token scope the request to their user', async () => {
    const { url, store } = await serve(true);
    const a = store.upsertUser({ issuer: 'i', sub: 'a' });
    const b = store.upsertUser({ issuer: 'i', sub: 'b' });
    const sid = store.createSession(a.id, 60_000);
    const { token } = store.createApiToken(b.id, 'cli');
    const viaCookie = await fetch(`${url}/api/whoami`, { headers: { cookie: `${SESSION_COOKIE}=${sid}` } });
    expect(await viaCookie.json()).toEqual({ user: a.id });
    const viaBearer = await fetch(`${url}/api/whoami`, { headers: { authorization: `Bearer ${token}` } });
    expect(await viaBearer.json()).toEqual({ user: b.id });
    expect((await fetch(`${url}/api/whoami`, { headers: { authorization: 'Bearer odt_nope' } })).status).toBe(401);
  });
});

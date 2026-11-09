import Database from 'better-sqlite3';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthMiddleware } from '../../src/auth/auth-middleware.js';
import { registerAuthRoutes, type OidcAdapter } from '../../src/auth/auth-routes.js';
import { createAuthStore } from '../../src/auth/auth-store.js';

let close: (() => void) | null = null;
afterEach(() => { close?.(); close = null; });

const fakeIdp = (sub: string): OidcAdapter => ({
  async authorizationUrl(_r, state) { return `https://idp.test/authorize?state=${state}`; },
  async exchange(url, state) {
    if (url.searchParams.get('state') !== state || url.searchParams.get('code') !== 'good') throw new Error('bad');
    return { issuer: 'https://idp.test', sub, email: `${sub}@x` };
  },
});

async function serve(sub = 'alice', onFirstAdmin?: (id: string) => void) {
  const store = createAuthStore(new Database(':memory:'));
  const app = express();
  app.use(express.json());
  app.use(createAuthMiddleware({ store, enabled: true }));
  const s = app.listen(0);
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  registerAuthRoutes(app, { store, enabled: true, publicUrl: url, adapter: fakeIdp(sub), onFirstAdmin });
  close = () => s.close();
  return { store, url };
}

async function login(url: string): Promise<string> {
  const r = await fetch(`${url}/api/auth/login`, { redirect: 'manual' });
  const state = new URL(r.headers.get('location')!).searchParams.get('state')!;
  const cb = await fetch(`${url}/api/auth/callback?code=good&state=${state}`, { redirect: 'manual' });
  expect(cb.status).toBe(302);
  return cb.headers.get('set-cookie')!.split(';')[0]!;
}

describe('auth routes (v7)', () => {
  it('AC1: login → callback sets an HttpOnly session; me returns the user; logout ends it', async () => {
    let admin = '';
    const { url } = await serve('alice', (id) => { admin = id; });
    const r = await fetch(`${url}/api/auth/login`, { redirect: 'manual' });
    const state = new URL(r.headers.get('location')!).searchParams.get('state')!;
    const cb = await fetch(`${url}/api/auth/callback?code=good&state=${state}`, { redirect: 'manual' });
    expect(cb.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    const cookie = cb.headers.get('set-cookie')!.split(';')[0]!;
    const me = await (await fetch(`${url}/api/auth/me`, { headers: { cookie } })).json();
    expect(me.user).toMatchObject({ email: 'alice@x', isAdmin: true });
    expect(admin).toBe(me.user.id);
    await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    expect((await fetch(`${url}/api/auth/me`, { headers: { cookie } })).status).toBe(401);
  });

  it('rejects a replayed or forged state', async () => {
    const { url } = await serve();
    expect((await fetch(`${url}/api/auth/callback?code=good&state=forged`)).status).toBe(400);
  });

  it('AC4: token create/list/revoke; token authenticates API calls', async () => {
    const { url } = await serve();
    const cookie = await login(url);
    const created = await (await fetch(`${url}/api/auth/tokens`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'cli' }),
    })).json();
    const bearer = { authorization: `Bearer ${created.token}` };
    expect((await (await fetch(`${url}/api/auth/tokens`, { headers: bearer })).json()).tokens).toHaveLength(1);
    expect((await fetch(`${url}/api/auth/tokens/${created.id}`, { method: 'DELETE', headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${url}/api/auth/tokens`, { headers: bearer })).status).toBe(401);
  });

  it('AC5: one-time admin reset link logs in the admin once', async () => {
    const { url, store } = await serve();
    await login(url);
    const t = store.createAdminResetToken(60_000);
    expect((await fetch(`${url}/api/auth/admin-reset?token=${t}`, { redirect: 'manual' })).status).toBe(302);
    expect((await fetch(`${url}/api/auth/admin-reset?token=${t}`, { redirect: 'manual' })).status).toBe(401);
  });
});

describe('loadOidcConfig', async () => {
  const { loadOidcConfig } = await import('../../src/auth/auth-routes.js');
  it('AC3: off when unset; requires all three when partly set', () => {
    expect(loadOidcConfig({})).toBeNull();
    expect(() => loadOidcConfig({ OD_OIDC_ISSUER: 'https://idp' })).toThrow(/OD_PUBLIC_URL/);
    expect(() => loadOidcConfig({ OD_OIDC_ISSUER: 'nope', OD_OIDC_CLIENT_ID: 'c', OD_PUBLIC_URL: 'http://x' })).toThrow(/absolute/);
    expect(loadOidcConfig({ OD_OIDC_ISSUER: 'https://idp', OD_OIDC_CLIENT_ID: 'c', OD_PUBLIC_URL: 'https://od' })?.clientId).toBe('c');
  });
});

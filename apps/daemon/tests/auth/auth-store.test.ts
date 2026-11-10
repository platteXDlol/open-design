import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createAuthStore,
  userIdFromClaims,
} from '../../src/auth/auth-store.js';

const store = () => createAuthStore(new Database(':memory:'));

describe('auth store (v7)', () => {
  it('derives a stable, path-safe user id from issuer + sub', () => {
    const a = userIdFromClaims('https://idp/app', 'abc|def/../x');
    expect(a).toMatch(/^u_[a-f0-9]{24}$/);
    expect(userIdFromClaims('https://idp/app', 'abc|def/../x')).toBe(a);
    expect(userIdFromClaims('https://other', 'abc|def/../x')).not.toBe(a);
  });

  it('makes the first user admin, later users not (AC5 bootstrap)', () => {
    const s = store();
    expect(s.upsertUser({ issuer: 'i', sub: '1', email: 'a@x' }).isAdmin).toBe(true);
    expect(s.upsertUser({ issuer: 'i', sub: '2', email: 'b@x' }).isAdmin).toBe(false);
    expect(s.upsertUser({ issuer: 'i', sub: '1', email: 'a2@x' }).isAdmin).toBe(true);
  });

  it('creates, resolves and deletes sessions; expired sessions do not resolve', () => {
    const s = store();
    const u = s.upsertUser({ issuer: 'i', sub: '1' });
    const sid = s.createSession(u.id, 60_000);
    expect(s.userForSession(sid)?.id).toBe(u.id);
    s.deleteSession(sid);
    expect(s.userForSession(sid)).toBeNull();
    const old = s.createSession(u.id, -1);
    expect(s.userForSession(old)).toBeNull();
  });

  it('stores only hashed API tokens and resolves them to their user (AC4)', () => {
    const s = store();
    const u = s.upsertUser({ issuer: 'i', sub: '1' });
    const { token, id } = s.createApiToken(u.id, 'laptop');
    expect(token).toMatch(/^odt_/);
    expect(s.userForApiToken(token)?.id).toBe(u.id);
    expect(JSON.stringify(s.listApiTokens(u.id))).not.toContain(token);
    s.revokeApiToken(u.id, id);
    expect(s.userForApiToken(token)).toBeNull();
  });

  it('one-time admin login tokens work once', () => {
    const s = store();
    const u = s.upsertUser({ issuer: 'i', sub: '1' });
    const t = s.createAdminResetToken(60_000);
    expect(s.consumeAdminResetToken(t)?.id).toBe(u.id);
    expect(s.consumeAdminResetToken(t)).toBeNull();
  });
});

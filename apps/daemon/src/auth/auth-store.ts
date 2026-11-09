// v7 OIDC auth store: users, sessions, per-user API tokens, one-time admin reset tokens.
// Secrets (session ids, API tokens, reset tokens) are stored only as sha256 hashes.
import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

type Db = Database.Database;

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  isAdmin: boolean;
}

export interface ApiTokenInfo {
  id: string;
  label: string;
  createdAt: number;
}

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;

/** Stable, path-safe user id: the IdP `sub` is opaque and may contain separators. */
export function userIdFromClaims(issuer: string, sub: string): string {
  return `u_${sha(`${issuer}\n${sub}`).slice(0, 24)}`;
}

function toUser(row: any): AuthUser | null {
  return row ? { id: row.id, email: row.email ?? null, name: row.name ?? null, isAdmin: row.is_admin === 1 } : null;
}

export function createAuthStore(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY, issuer TEXT NOT NULL, sub TEXT NOT NULL, email TEXT, name TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE (issuer, sub));
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_api_tokens (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
      label TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER);
    CREATE TABLE IF NOT EXISTS auth_admin_reset (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  `);
  const userById = (id: string) => toUser(db.prepare(`SELECT * FROM auth_users WHERE id = ?`).get(id));

  return {
    upsertUser(c: { issuer: string; sub: string; email?: string | null | undefined; name?: string | null | undefined }): AuthUser {
      const id = userIdFromClaims(c.issuer, c.sub);
      const count = (db.prepare(`SELECT COUNT(*) AS n FROM auth_users`).get() as { n: number }).n;
      db.prepare(`
        INSERT INTO auth_users (id, issuer, sub, email, name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name
      `).run(id, c.issuer, c.sub, c.email ?? null, c.name ?? null, count === 0 ? 1 : 0, Date.now());
      return userById(id)!;
    },
    getUser: userById,
    firstAdmin(): AuthUser | null {
      return toUser(db.prepare(`SELECT * FROM auth_users WHERE is_admin = 1 ORDER BY created_at LIMIT 1`).get());
    },

    createSession(userId: string, ttlMs: number): string {
      const sid = secret('ods_');
      db.prepare(`INSERT INTO auth_sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)`).run(sha(sid), userId, Date.now() + ttlMs);
      return sid;
    },
    userForSession(sid: string): AuthUser | null {
      const row = db.prepare(`SELECT user_id FROM auth_sessions WHERE id_hash = ? AND expires_at > ?`).get(sha(sid), Date.now()) as { user_id: string } | undefined;
      return row ? userById(row.user_id) : null;
    },
    deleteSession(sid: string): void {
      db.prepare(`DELETE FROM auth_sessions WHERE id_hash = ?`).run(sha(sid));
    },

    createApiToken(userId: string, label: string, ttlMs?: number): { id: string; token: string } {
      const token = secret('odt_');
      const id = randomBytes(8).toString('hex');
      db.prepare(`INSERT INTO auth_api_tokens (id, token_hash, user_id, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, sha(token), userId, label, Date.now(), ttlMs === undefined ? null : Date.now() + ttlMs);
      return { id, token };
    },
    userForApiToken(token: string): AuthUser | null {
      const row = db.prepare(`SELECT user_id FROM auth_api_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > ?)`)
        .get(sha(token), Date.now()) as { user_id: string } | undefined;
      return row ? userById(row.user_id) : null;
    },
    listApiTokens(userId: string): ApiTokenInfo[] {
      return db.prepare(`SELECT id, label, created_at FROM auth_api_tokens WHERE user_id = ? AND expires_at IS NULL ORDER BY created_at`)
        .all(userId).map((r: any) => ({ id: r.id, label: r.label, createdAt: r.created_at }));
    },
    revokeApiToken(userId: string, id: string): boolean {
      const r = db.prepare(`DELETE FROM auth_api_tokens WHERE id = ? AND user_id = ?`).run(id, userId) ;
      return r.changes > 0;
    },

    createAdminResetToken(ttlMs: number): string {
      const t = secret('odr_');
      db.prepare(`INSERT INTO auth_admin_reset (token_hash, expires_at) VALUES (?, ?)`).run(sha(t), Date.now() + ttlMs);
      return t;
    },
    consumeAdminResetToken(t: string): AuthUser | null {
      const r = db.prepare(`DELETE FROM auth_admin_reset WHERE token_hash = ? AND expires_at > ?`).run(sha(t), Date.now()) ;
      return r.changes > 0 ? this.firstAdmin() : null;
    },
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;

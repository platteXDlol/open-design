// M3 view-only share links. Tokens are stored only as sha256 hashes (same rule as auth-store).
import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  SHARE_LINK_DEFAULT_EXPIRY,
  SHARE_TOKEN_PREFIX,
  isShareToken,
  shareLinkExpiresAt,
  shareLinkStatus,
  type ShareLink,
  type ShareLinkExpiry,
} from '@open-design/contracts';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

type Row = {
  id: string;
  project_id: string;
  artifact_id: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
};

const toShare = (r: Row, now: number): ShareLink => {
  const link = {
    id: r.id,
    projectId: r.project_id,
    artifactId: r.artifact_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
  };
  return { ...link, status: shareLinkStatus(link, now) };
};

export function createShareStore(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
      project_id TEXT NOT NULL, artifact_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER, revoked_at INTEGER);
    CREATE INDEX IF NOT EXISTS share_links_owner ON share_links (user_id, project_id, artifact_id);
  `);
  return {
    create(input: {
      userId: string;
      projectId: string;
      artifactId: string;
      expires?: ShareLinkExpiry;
      now?: number;
    }): { share: ShareLink; token: string } {
      const now = input.now ?? Date.now();
      const token = `${SHARE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
      const row: Row = {
        id: randomBytes(8).toString('hex'),
        project_id: input.projectId,
        artifact_id: input.artifactId,
        created_at: now,
        expires_at: shareLinkExpiresAt(input.expires ?? SHARE_LINK_DEFAULT_EXPIRY, now),
        revoked_at: null,
      };
      db.prepare(
        `INSERT INTO share_links (id, token_hash, user_id, project_id, artifact_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, sha(token), input.userId, row.project_id, row.artifact_id, now, row.expires_at);
      return { share: toShare(row, now), token };
    },
    list(filter: { userId: string; projectId?: string; artifactId?: string; now?: number }): ShareLink[] {
      const now = filter.now ?? Date.now();
      const rows = db
        .prepare(
          `SELECT id, project_id, artifact_id, created_at, expires_at, revoked_at FROM share_links
           WHERE user_id = ? AND (? IS NULL OR project_id = ?) AND (? IS NULL OR artifact_id = ?)
           ORDER BY created_at DESC`,
        )
        .all(
          filter.userId,
          filter.projectId ?? null,
          filter.projectId ?? null,
          filter.artifactId ?? null,
          filter.artifactId ?? null,
        ) as Row[];
      return rows.map((r) => toShare(r, now));
    },
    revoke(userId: string, id: string, now: number = Date.now()): boolean {
      return (
        db
          .prepare(`UPDATE share_links SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
          .run(now, id, userId).changes > 0
      );
    },
    /** Active link for a token, or null (unknown, malformed, expired and revoked all look the same). */
    resolve(
      token: string,
      now: number = Date.now(),
    ): { id: string; userId: string; projectId: string; artifactId: string } | null {
      if (!isShareToken(token)) return null;
      const r = db
        .prepare(
          `SELECT id, user_id, project_id, artifact_id FROM share_links
           WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .get(sha(token), now) as { id: string; user_id: string; project_id: string; artifact_id: string } | undefined;
      return r ? { id: r.id, userId: r.user_id, projectId: r.project_id, artifactId: r.artifact_id } : null;
    },
  };
}

export type ShareStore = ReturnType<typeof createShareStore>;

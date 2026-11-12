import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { isShareToken } from '@open-design/contracts';
import { createShareStore } from '../../src/share-links/share-store.js';

const DAY = 86_400_000;

describe('share store', () => {
  it('creates a link, stores only its hash, and resolves the token', () => {
    const db = new Database(':memory:');
    const store = createShareStore(db);
    const { share, token } = store.create({ userId: 'u1', projectId: 'p1', artifactId: 'deck-v1', expires: '30d', now: 1000 });
    expect(isShareToken(token)).toBe(true);
    expect(share).toMatchObject({ projectId: 'p1', artifactId: 'deck-v1', createdAt: 1000, expiresAt: 1000 + 30 * DAY, status: 'active' });
    const dump = JSON.stringify(db.prepare('SELECT * FROM share_links').all());
    expect(dump).not.toContain(token);
    expect(store.resolve(token, 2000)).toEqual({ id: share.id, userId: 'u1', projectId: 'p1', artifactId: 'deck-v1' });
  });

  it('defaults to 30 days and supports never', () => {
    const store = createShareStore(new Database(':memory:'));
    expect(store.create({ userId: 'u', projectId: 'p', artifactId: 'd', now: 0 }).share.expiresAt).toBe(30 * DAY);
    expect(store.create({ userId: 'u', projectId: 'p', artifactId: 'd', expires: 'never', now: 0 }).share.expiresAt).toBeNull();
  });

  it('does not resolve expired, revoked, or unknown tokens', () => {
    const store = createShareStore(new Database(':memory:'));
    const a = store.create({ userId: 'u', projectId: 'p', artifactId: 'd', expires: '1d', now: 0 });
    expect(store.resolve(a.token, DAY)).toBeNull();
    const b = store.create({ userId: 'u', projectId: 'p', artifactId: 'd', now: 0 });
    expect(store.revoke('someone-else', b.share.id, 5)).toBe(false);
    expect(store.revoke('u', b.share.id, 5)).toBe(true);
    expect(store.resolve(b.token, 6)).toBeNull();
    expect(store.resolve(`odsh_${'x'.repeat(43)}`, 6)).toBeNull();
    expect(store.resolve('garbage', 6)).toBeNull();
  });

  it('lists only the owner links, keeping revoked ones with status', () => {
    const store = createShareStore(new Database(':memory:'));
    const a = store.create({ userId: 'u', projectId: 'p', artifactId: 'd', now: 0 });
    store.create({ userId: 'u', projectId: 'p', artifactId: 'other', now: 1 });
    store.create({ userId: 'v', projectId: 'p', artifactId: 'd', now: 2 });
    store.revoke('u', a.share.id, 3);
    const mine = store.list({ userId: 'u', projectId: 'p', artifactId: 'd', now: 4 });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: a.share.id, status: 'revoked', revokedAt: 3 });
    expect(store.list({ userId: 'u', now: 4 })).toHaveLength(2);
  });
});

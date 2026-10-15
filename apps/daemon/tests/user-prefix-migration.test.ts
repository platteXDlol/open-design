// v0.6 per-user prefix migration — unit tests.
//
// Idempotency and the no-overwrite guard are the two invariants that
// matter here; everything else is plumbing. A flaky migration would
// either duplicate or destroy the user's projects tree.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  migrateUserPrefixSync,
  USER_PREFIX_MIGRATION_ENV,
  UserPrefixMigrationError,
} from '../src/storage/user-prefix-migration.js';
import {
  SYNTHETIC_USER_ID,
  USER_PREFIX_MIGRATION_MARKER,
} from '../src/storage/user-scope.js';

let dataDir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-user-prefix-'));
  env = { ...process.env };
  delete env[USER_PREFIX_MIGRATION_ENV];
  delete env.OD_USER_ID;
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function writeLegacyProject(id: string, files: Record<string, string>): void {
  const dir = path.join(dataDir, 'projects', id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body, 'utf8');
  }
}

describe('migrateUserPrefixSync', () => {
  it('is a noop when the legacy projects root is missing or empty', () => {
    const r1 = migrateUserPrefixSync({ dataDir, env });
    expect(r1.status).toBe('noop');

    fs.mkdirSync(path.join(dataDir, 'projects'), { recursive: true });
    const r2 = migrateUserPrefixSync({ dataDir, env });
    expect(r2.status).toBe('noop');
  });

  it('moves a non-empty legacy tree into users/local/projects', () => {
    writeLegacyProject('proj-a', { 'index.html': '<html>A</html>' });
    writeLegacyProject('proj-b', { 'index.html': '<html>B</html>' });

    const result = migrateUserPrefixSync({ dataDir, env });
    expect(result.status).toBe('migrated');
    if (result.status === 'migrated') {
      expect(result.moved.sort()).toEqual(['proj-a', 'proj-b']);
      expect(result.userId).toBe(SYNTHETIC_USER_ID);
    }

    const target = path.join(dataDir, 'users', SYNTHETIC_USER_ID, 'projects');
    expect(fs.existsSync(path.join(target, 'proj-a', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'proj-b', 'index.html'))).toBe(true);
    // The legacy root should be removed once empty.
    expect(fs.existsSync(path.join(dataDir, 'projects'))).toBe(false);
    // The marker is written so the next boot noops.
    expect(fs.existsSync(path.join(dataDir, USER_PREFIX_MIGRATION_MARKER))).toBe(true);
  });

  it('uses OD_USER_ID when set (the v7 OIDC hook)', () => {
    writeLegacyProject('proj-a', { 'index.html': '<html>A</html>' });
    env.OD_USER_ID = 'alice';
    const result = migrateUserPrefixSync({ dataDir, env });
    expect(result.status).toBe('migrated');
    if (result.status === 'migrated') {
      expect(result.userId).toBe('alice');
    }
    expect(
      fs.existsSync(path.join(dataDir, 'users', 'alice', 'projects', 'proj-a', 'index.html')),
    ).toBe(true);
  });

  it('is idempotent across boots (marker short-circuits)', () => {
    writeLegacyProject('proj-a', { 'index.html': '<html>A</html>' });
    const r1 = migrateUserPrefixSync({ dataDir, env });
    expect(r1.status).toBe('migrated');

    // The legacy tree is gone, but simulate a pathological state where
    // a stray entry appears next to the new tree. The marker must still
    // short-circuit; re-running must NOT touch the data again.
    fs.mkdirSync(path.join(dataDir, 'projects', 'stray-proj'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'projects', 'stray-proj', 'index.html'), 'stray');

    const r2 = migrateUserPrefixSync({ dataDir, env });
    expect(r2.status).toBe('skipped');

    const target = path.join(dataDir, 'users', SYNTHETIC_USER_ID, 'projects');
    expect(fs.existsSync(path.join(target, 'proj-a', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'stray-proj'))).toBe(false);
  });

  it('respects OD_USER_PREFIX_MIGRATION=0 and leaves the legacy tree alone', () => {
    writeLegacyProject('proj-a', { 'index.html': '<html>A</html>' });
    env[USER_PREFIX_MIGRATION_ENV] = '0';
    const result = migrateUserPrefixSync({ dataDir, env });
    expect(result.status).toBe('opted-out');

    // Legacy tree still present; no marker; no target tree created.
    expect(fs.existsSync(path.join(dataDir, 'projects', 'proj-a', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, USER_PREFIX_MIGRATION_MARKER))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'users', SYNTHETIC_USER_ID, 'projects'))).toBe(false);
  });

  it('refuses to merge on top of a non-empty target prefix', () => {
    // Pre-populated target prefix (operator hand-moved data, then re-ran
    // the migration expecting no-op). The migrator must refuse to
    // overlay the legacy tree on top.
    writeLegacyProject('proj-a', { 'index.html': '<html>A</html>' });
    const target = path.join(dataDir, 'users', SYNTHETIC_USER_ID, 'projects');
    fs.mkdirSync(path.join(target, 'proj-existing'), { recursive: true });
    fs.writeFileSync(path.join(target, 'proj-existing', 'index.html'), 'pre-existing');

    expect(() => migrateUserPrefixSync({ dataDir, env })).toThrow(UserPrefixMigrationError);
    try {
      migrateUserPrefixSync({ dataDir, env });
    } catch (err) {
      expect(err).toBeInstanceOf(UserPrefixMigrationError);
      expect((err as UserPrefixMigrationError).code).toBe('data_dir_not_empty');
    }

    // Legacy tree is untouched.
    expect(fs.existsSync(path.join(dataDir, 'projects', 'proj-a', 'index.html'))).toBe(true);
    // Target tree is untouched.
    expect(fs.existsSync(path.join(target, 'proj-existing', 'index.html'))).toBe(true);
    // No marker written on failure.
    expect(fs.existsSync(path.join(dataDir, USER_PREFIX_MIGRATION_MARKER))).toBe(false);
  });

  it('skips non-directory entries in the legacy root', () => {
    writeLegacyProject('proj-a', { 'index.html': '<html>A</html>' });
    fs.writeFileSync(path.join(dataDir, 'projects', 'README.md'), 'notes', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'projects', '.DS_Store'), 'mac', 'utf8');

    const result = migrateUserPrefixSync({ dataDir, env });
    expect(result.status).toBe('migrated');
    if (result.status === 'migrated') {
      expect(result.moved).toEqual(['proj-a']);
    }
    // The non-directory entries remain in the legacy root (we only
    // remove the empty directory itself; we do not delete user files).
    expect(fs.existsSync(path.join(dataDir, 'projects', 'README.md'))).toBe(true);
  });

  it('writes the marker atomically (no partial file on success)', () => {
    writeLegacyProject('proj-a', { 'index.html': '<html>A</html>' });
    migrateUserPrefixSync({ dataDir, env });
    const markerPath = path.join(dataDir, USER_PREFIX_MIGRATION_MARKER);
    const content = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    expect(content.userId).toBe(SYNTHETIC_USER_ID);
    expect(content.moved).toEqual(['proj-a']);
    expect(typeof content.migratedAt).toBe('string');
    expect(content.legacyRoot).toBe(path.join(dataDir, 'projects'));
    // No tmp file left behind from the atomic write.
    const siblings = fs.readdirSync(dataDir);
    expect(siblings.filter((s) => s.startsWith(USER_PREFIX_MIGRATION_MARKER + '.tmp-'))).toEqual([]);
  });
});

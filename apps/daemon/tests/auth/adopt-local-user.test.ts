import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adoptLocalUserData } from '../../src/auth/adopt-local-user.js';
import { getProject, insertProject, openDatabase } from '../../src/db.js';
import { resolveUserProjectsRoot } from '../../src/storage/user-scope.js';

function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'od-adopt-'));
  const db = openDatabase(process.cwd(), { dataDir });
  mkdirSync(path.join(resolveUserProjectsRoot(dataDir, 'local'), 'p1'), { recursive: true });
  writeFileSync(path.join(resolveUserProjectsRoot(dataDir, 'local'), 'p1', 'index.html'), 'x');
  insertProject(db, { id: 'p1', name: 'p1', userId: 'local', createdAt: 1, updatedAt: 1 });
  return { dataDir, db };
}

describe('first admin adopts users/local (D7)', () => {
  it('moves the folder and re-owns the rows once', () => {
    const { dataDir, db } = setup();
    expect(adoptLocalUserData({ runtimeDataDir: dataDir, db, adminId: 'u_admin' })).toBe('adopted');
    expect(existsSync(path.join(resolveUserProjectsRoot(dataDir, 'u_admin'), 'p1', 'index.html'))).toBe(true);
    expect(existsSync(resolveUserProjectsRoot(dataDir, 'local'))).toBe(false);
    expect(getProject(db, 'p1')?.userId).toBe('u_admin');
    expect(adoptLocalUserData({ runtimeDataDir: dataDir, db, adminId: 'u_admin' })).toBe('already-done');
  });

  it('refuses when the admin folder already exists', () => {
    const { dataDir, db } = setup();
    mkdirSync(resolveUserProjectsRoot(dataDir, 'u_admin'), { recursive: true });
    expect(adoptLocalUserData({ runtimeDataDir: dataDir, db, adminId: 'u_admin' })).toBe('target-exists');
    expect(getProject(db, 'p1')?.userId).toBe('local');
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getProject, insertProject, listProjects, listUnboundProjects, openDatabase } from '../../src/db.js';
import { runWithUser } from '../../src/storage/user-scope.js';

describe('project isolation by request user (AC2)', () => {
  it('a request user sees and creates only their own projects; no context sees all', () => {
    const db = openDatabase(process.cwd(), { dataDir: mkdtempSync(path.join(tmpdir(), 'od-iso-')) });
    const mk = (id: string) => insertProject(db, { id, name: id, createdAt: 1, updatedAt: 1 });
    runWithUser('u_a', () => mk('pa'));
    runWithUser('u_b', () => mk('pb'));
    runWithUser('u_a', () => {
      expect(listProjects(db).map((p) => p.id)).toEqual(['pa']);
      expect(listUnboundProjects(db).map((p) => p.id)).toEqual(['pa']);
      expect(getProject(db, 'pb')).toBeNull();
      expect(getProject(db, 'pa')?.userId).toBe('u_a');
    });
    expect(listProjects(db).map((p) => p.id).sort()).toEqual(['pa', 'pb']);
  });
});

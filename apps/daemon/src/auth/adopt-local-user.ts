// v7 (D7): the first SSO admin takes over the pre-SSO single-user data under users/local/, once.
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { resolveUserProjectsRoot, SYNTHETIC_USER_ID } from '../storage/user-scope.js';

const MARKER = '.adopted-by-sso-admin';

export type AdoptResult = 'adopted' | 'already-done' | 'nothing-to-adopt' | 'target-exists';

export function adoptLocalUserData(opts: { runtimeDataDir: string; db: Database.Database; adminId: string }): AdoptResult {
  const usersDir = path.dirname(path.dirname(resolveUserProjectsRoot(opts.runtimeDataDir, SYNTHETIC_USER_ID)));
  const marker = path.join(usersDir, MARKER);
  if (fs.existsSync(marker)) return 'already-done';
  const from = path.join(usersDir, SYNTHETIC_USER_ID);
  const to = path.join(usersDir, opts.adminId);
  if (!fs.existsSync(from)) return 'nothing-to-adopt';
  // Never merge into or overwrite an existing user tree.
  if (fs.existsSync(to)) {
    console.warn(`[auth] not adopting ${from}: ${to} already exists`);
    return 'target-exists';
  }
  fs.renameSync(from, to);
  opts.db.prepare(`UPDATE projects SET user_id = ? WHERE user_id IS NULL OR user_id = ?`).run(opts.adminId, SYNTHETIC_USER_ID);
  fs.writeFileSync(marker, `${opts.adminId}\n`);
  return 'adopted';
}

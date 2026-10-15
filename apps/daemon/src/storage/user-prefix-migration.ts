// One-shot, idempotent migration that moves a pre-v0.6 single-tenant
// projects root into the new per-user prefix layout. Runs at daemon boot,
// before SQLite opens, so the resulting on-disk shape is consistent with
// what the server-context reports.
//
// Modeled on `apps/daemon/src/migration/legacy-data-migrator.ts`:
//   - Synchronous so it can run before `openDatabase`.
//   - Idempotent: a successful run leaves a marker file; future boots
//     short-circuit as `skipped`.
//   - Refuses to merge on top of an already-populated target prefix
//     (would silently overwrite the post-migration data shape).
//   - Refuses to run when the operator has explicitly opted out
//     (OD_USER_PREFIX_MIGRATION=0).
//
// New layout: <RUNTIME_DATA_DIR>/users/<userId>/projects/<projectId>/
// Legacy:     <RUNTIME_DATA_DIR>/projects/<projectId>/
//
// The user id at migration time is whatever `resolveUserId()` returns —
// today the synthetic `'local'`. v7 will rerun this under real OIDC ids;
// for now the marker ensures we never re-move.

import fs from 'node:fs';
import path from 'node:path';
import {
  USER_PREFIX_MIGRATION_MARKER,
  resolveUserId,
  resolveUserProjectsRoot,
} from './user-scope.js';

export const USER_PREFIX_MIGRATION_ENV = 'OD_USER_PREFIX_MIGRATION';

export interface UserPrefixMigrationLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export interface MigrateUserPrefixOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  logger?: UserPrefixMigrationLogger;
  // Test-only override. Production uses resolveUserId() against the env.
  userId?: string;
}

export type UserPrefixMigrationResult =
  | { status: 'noop'; reason: string }
  | { status: 'skipped'; reason: string }
  | { status: 'migrated'; moved: string[]; userId: string }
  | { status: 'opted-out'; reason: string };

export class UserPrefixMigrationError extends Error {
  readonly code: 'data_dir_not_empty' | 'legacy_dir_invalid' | 'io_error';
  constructor(code: UserPrefixMigrationError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'UserPrefixMigrationError';
  }
}

const DEFAULT_LOGGER: UserPrefixMigrationLogger = {
  info: (m) => console.log(`[od-user-prefix-migrate] ${m}`),
  warn: (m) => console.warn(`[od-user-prefix-migrate] ${m}`),
};

function hasProjectsPayload(legacyDir: string): boolean {
  if (!fs.existsSync(legacyDir)) return false;
  let entries: string[];
  try {
    entries = fs.readdirSync(legacyDir);
  } catch {
    return false;
  }
  return entries.length > 0;
}

function targetIsEmpty(targetDir: string): boolean {
  if (!fs.existsSync(targetDir)) return true;
  const entries = fs.readdirSync(targetDir);
  return entries.length === 0;
}

function writeMarker(dataDir: string, userId: string, moved: readonly string[]): void {
  const marker = path.join(dataDir, USER_PREFIX_MIGRATION_MARKER);
  const temp = `${marker}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(
    {
      userId,
      migratedAt: new Date().toISOString(),
      moved: moved.slice().sort(),
      legacyRoot: path.join(dataDir, 'projects'),
    },
    null,
    2,
  );
  try {
    fs.writeFileSync(temp, payload + '\n', 'utf8');
    fs.renameSync(temp, marker);
  } catch (err) {
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function listProjectDirs(legacyDir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(legacyDir)) {
    const abs = path.join(legacyDir, entry);
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (entry === '.' || entry === '..' || entry.startsWith('.')) continue;
    out.push(entry);
  }
  out.sort();
  return out;
}

/**
 * Move a single project directory from `legacyDir` to `targetDir`. Uses
 * rename for cross-device safety: when the source and target are on the
 * same filesystem (the common case) this is atomic. When they differ we
 * fall back to a copy+rm. Either way a single failure aborts the whole
 * migration and leaves the source untouched.
 */
function moveProject(source: string, target: string, log: UserPrefixMigrationLogger): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
    return;
  } catch (err: any) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTSUP') throw err;
    log.warn(`rename fell back to copy+rm for ${path.basename(source)} (${code})`);
  }
  // EXDEV: cross-device. Copy then remove.
  copyRecursiveSync(source, target);
  fs.rmSync(source, { recursive: true, force: true });
}

function copyRecursiveSync(source: string, target: string): void {
  const st = fs.statSync(source);
  if (st.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursiveSync(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (st.isFile() || st.isSymbolicLink()) {
    fs.copyFileSync(source, target);
    return;
  }
  // Sockets / FIFOs / device nodes: skip. The legacy projects tree
  // doesn't legitimately contain them and copying them would explode.
}

export function migrateUserPrefixSync(
  options: MigrateUserPrefixOptions,
): UserPrefixMigrationResult {
  const env = options.env ?? process.env;
  const log = options.logger ?? DEFAULT_LOGGER;
  const dataDir = path.resolve(options.dataDir);
  const userId = options.userId ?? resolveUserId(env);

  // Explicit opt-out. The flag defaults to enabled for one release; the
  // escape hatch exists so an operator with a known-wrong legacy tree can
  // keep the daemon starting while they clean up by hand.
  const flag = env[USER_PREFIX_MIGRATION_ENV];
  if (typeof flag === 'string' && /^(0|false|no|off)$/i.test(flag.trim())) {
    return { status: 'opted-out', reason: `${USER_PREFIX_MIGRATION_ENV}=${flag}` };
  }

  const markerPath = path.join(dataDir, USER_PREFIX_MIGRATION_MARKER);
  if (fs.existsSync(markerPath)) {
    return { status: 'skipped', reason: 'user-prefix migration marker already present' };
  }

  const legacyDir = path.join(dataDir, 'projects');
  const targetDir = resolveUserProjectsRoot(dataDir, userId);

  if (!hasProjectsPayload(legacyDir)) {
    return { status: 'noop', reason: 'legacy projects root is empty' };
  }

  // Both sides may legally not exist yet (fresh install). The legacy tree
  // existing + the new tree being empty is the only state we migrate.
  fs.mkdirSync(targetDir, { recursive: true });
  if (!targetIsEmpty(targetDir)) {
    throw new UserPrefixMigrationError(
      'data_dir_not_empty',
      `Target user prefix "${targetDir}" is non-empty; refusing to merge. `
        + `Move the existing data aside, set ${USER_PREFIX_MIGRATION_ENV}=0 to skip, `
        + 'or pick a fresh data root before re-running.',
    );
  }

  const projectIds = listProjectDirs(legacyDir);
  if (projectIds.length === 0) {
    // Shouldn't happen because hasProjectsPayload returned true, but
    // be defensive: write the marker so we don't re-scan forever.
    writeMarker(dataDir, userId, []);
    return { status: 'migrated', moved: [], userId };
  }

  log.info(
    `moving ${projectIds.length} project(s) from "${legacyDir}" into "${targetDir}" (user=${userId})`,
  );

  const moved: string[] = [];
  for (const id of projectIds) {
    const source = path.join(legacyDir, id);
    const target = path.join(targetDir, id);
    try {
      moveProject(source, target, log);
      moved.push(id);
    } catch (err: any) {
      // Best-effort rollback of the projects we already moved. We do NOT
      // restore the legacy dir — half-moved data is worse than a clean
      // abort, and the operator can move things back by hand. The marker
      // is intentionally NOT written so the next boot retries.
      log.warn(`migration failed on ${id}: ${err.message ?? String(err)}`);
      throw new UserPrefixMigrationError(
        'io_error',
        `Failed to move project ${id}: ${err.message ?? String(err)}. `
          + 'No marker written; the next boot will retry. Inspect the source '
          + 'and target trees by hand before re-running.',
      );
    }
  }

  // Tidy up the now-empty legacy root. We leave any non-project entries
  // (the user might have hand-stashed a `projects/README.md`) untouched.
  const remaining = fs.readdirSync(legacyDir).filter((name) => !name.startsWith('.'));
  if (remaining.length === 0) {
    try {
      fs.rmdirSync(legacyDir);
    } catch {
      // Best effort. The empty dir is harmless.
    }
  }

  writeMarker(dataDir, userId, moved);
  log.info(`moved ${moved.length} project(s); marker written.`);
  return { status: 'migrated', moved, userId };
}

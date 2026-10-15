// Per-user project prefix resolver.
//
// The fork's v0.5 divergence removed the OpenDesign Cloud identity surface
// but left PROJECTS_DIR as a single shared-by-Linux-user directory. The
// roadmap (claude-design-local-roadmap.md § 2 + § 4.2) schedules full
// multi-user via OIDC SSO at v7 — Postgres migration, audit log, share-link
// edit, per-user quotas. The first half of that work is the storage shape:
// `users/<user-id>/projects/<project-id>/` so v7 only has to ship auth, not
// reinvent the data path.
//
// v0.6 (this slice) lands that storage shape WITHOUT auth. A single
// synthetic user id is returned everywhere a call site doesn't yet know its
// user; v7 swaps `resolveUserId` for an OIDC-derived id without changing
// call sites.
//
// Single chokepoint by design. The root AGENTS.md "Daemon data directory
// contract" forbids new filesystem code that bypasses the resolved data
// root; this module extends the same rule to the per-user prefix. Path
// strings that compose `users/...` outside this module are a regression.

import path from 'node:path';

export const SYNTHETIC_USER_ID = 'local';

export const DEFAULT_USER_ID_ENV = 'OD_USER_ID';

/**
 * Resolve the active user id. v0.6 honours OD_USER_ID for tests and
 * packaged-build overrides, then falls back to the synthetic single-tenant
 * id. v7 will replace this with an OIDC-derived id (the Authentik/Keycloak
 * `sub` claim); the call site shape stays identical.
 *
 * Reject anything that could traverse the on-disk tree (`/`, `\\`, `\0`,
 * `..`) — user ids become path segments, and a hostile env value is the
 * simplest way to escape the prefix.
 */
export function resolveUserId(
  env: NodeJS.ProcessEnv | { OD_USER_ID?: string | undefined } = process.env,
): string {
  const raw = (env.OD_USER_ID ?? '').toString().trim();
  if (raw.length === 0) return SYNTHETIC_USER_ID;
  if (raw === '.' || raw === '..' || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
    throw new Error(`OD_USER_ID must not contain path separators or . / ..`);
  }
  return raw;
}

/**
 * Per-user projects root: `<RUNTIME_DATA_DIR>/users/<userId>/projects`.
 * Every project path the daemon materialises derives from this. Tests pin
 * `OD_DATA_DIR` to a tmp dir; production reads the same root as
 * `RUNTIME_DATA_DIR` from server-context.
 */
export function resolveUserProjectsRoot(
  runtimeDataDir: string,
  userId: string = resolveUserId(),
): string {
  if (!runtimeDataDir) throw new Error('runtimeDataDir is required');
  if (!userId) throw new Error('userId is required');
  return path.join(runtimeDataDir, 'users', userId, 'projects');
}

/**
 * Per-user per-project directory. Mirrors `projects.resolveProjectDir` for
 * git-linked projects (external `metadata.baseDir`) so the import/export
 * routes that already special-case external roots keep working.
 */
export function resolveUserProjectDir(
  runtimeDataDir: string,
  userId: string,
  projectId: string,
  metadata?: { baseDir?: string | string | null } | null,
): string {
  if (!projectId) throw new Error('projectId is required');
  if (typeof projectId !== 'string') throw new Error('projectId must be a string');
  // External (folder-imported) projects keep their own baseDir. This matches
  // the rule in `apps/daemon/src/projects.ts:resolveProjectDir` for the
  // v0.5 single-tenant path so behaviour is identical for imported folders.
  if (metadata && typeof (metadata as any).baseDir === 'string' && path.isAbsolute(path.normalize((metadata as any).baseDir))) {
    return path.normalize((metadata as any).baseDir);
  }
  return path.join(resolveUserProjectsRoot(runtimeDataDir, userId), projectId);
}

/**
 * Convenience for the single-tenant case. The daemon runs as the synthetic
 * user until v7 ships auth; this is the only call sites need to make.
 */
export function defaultUserProjectsRoot(runtimeDataDir: string): string {
  return resolveUserProjectsRoot(runtimeDataDir, resolveUserId());
}

/**
 * Marker-file name used by `apps/daemon/src/storage/user-prefix-migration.ts`
 * to record a successful boot-time move of legacy single-tenant projects
 * into the per-user prefix. Mirrors the
 * `apps/daemon/src/migration/legacy-data-migrator.ts` pattern so a
 * half-finished migration can never brick a daemon.
 */
export const USER_PREFIX_MIGRATION_MARKER = '.migrated-to-user-prefix';

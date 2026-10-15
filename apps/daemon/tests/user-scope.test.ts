// v0.6 per-user project prefix resolver — unit tests.
//
// The single chokepoint that turns a path-derivation question into a
// user-id-aware answer. The plan says v7 (OIDC SSO + Postgres + share
// links) replaces `resolveUserId` with an OIDC-derived id; the contract
// here is what v7 must keep.

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  defaultUserProjectsRoot,
  resolveUserId,
  resolveUserProjectDir,
  resolveUserProjectsRoot,
  SYNTHETIC_USER_ID,
  USER_PREFIX_MIGRATION_MARKER,
} from '../src/storage/user-scope.js';

describe('user-scope resolver', () => {
  describe('resolveUserId', () => {
    it('returns the synthetic id when OD_USER_ID is unset or empty', () => {
      expect(resolveUserId({})).toBe(SYNTHETIC_USER_ID);
      expect(resolveUserId({ OD_USER_ID: '' })).toBe(SYNTHETIC_USER_ID);
      expect(resolveUserId({ OD_USER_ID: '   ' })).toBe(SYNTHETIC_USER_ID);
    });

    it('honors a set OD_USER_ID', () => {
      expect(resolveUserId({ OD_USER_ID: 'alice' })).toBe('alice');
      expect(resolveUserId({ OD_USER_ID: 'svc-build' })).toBe('svc-build');
    });

    it('rejects path-traversal-shaped values', () => {
      for (const hostile of ['..', '.', 'a/b', 'a\\b', 'a\0b', 'foo/../bar']) {
        expect(() => resolveUserId({ OD_USER_ID: hostile })).toThrow(/OD_USER_ID/);
      }
    });

    it('keeps process.env the production default', () => {
      // The function reads process.env only when no env argument is passed;
      // this is a behavior contract, not a snapshot of the live env (other
      // tests may have set OD_USER_ID).
      const previous = process.env.OD_USER_ID;
      try {
        delete process.env.OD_USER_ID;
        expect(resolveUserId()).toBe(SYNTHETIC_USER_ID);
        process.env.OD_USER_ID = 'from-process-env';
        expect(resolveUserId()).toBe('from-process-env');
      } finally {
        if (previous === undefined) delete process.env.OD_USER_ID;
        else process.env.OD_USER_ID = previous;
      }
    });
  });

  describe('resolveUserProjectsRoot', () => {
    it('joins <dataDir>/users/<userId>/projects', () => {
      const root = resolveUserProjectsRoot('/var/lib/od', 'alice');
      expect(root).toBe(path.join('/var/lib/od', 'users', 'alice', 'projects'));
    });

    it('defaults to the synthetic user when no id is given', () => {
      const root = resolveUserProjectsRoot('/var/lib/od');
      expect(root).toBe(path.join('/var/lib/od', 'users', SYNTHETIC_USER_ID, 'projects'));
    });

    it('rejects empty dataDir or userId', () => {
      expect(() => resolveUserProjectsRoot('', 'alice')).toThrow();
      expect(() => resolveUserProjectsRoot('/var/lib/od', '')).toThrow();
    });
  });

  describe('resolveUserProjectDir', () => {
    it('joins the user projects root with the project id', () => {
      const dir = resolveUserProjectDir('/var/lib/od', 'alice', 'p-123');
      expect(dir).toBe(path.join('/var/lib/od', 'users', 'alice', 'projects', 'p-123'));
    });

    it('honors an absolute metadata.baseDir for folder-imported projects', () => {
      const external = path.resolve('/home/alice/repos/landing-page');
      const dir = resolveUserProjectDir('/var/lib/od', 'alice', 'p-123', { baseDir: external });
      expect(dir).toBe(external);
    });

    it('ignores non-absolute baseDir values (relative paths are user error)', () => {
      const dir = resolveUserProjectDir('/var/lib/od', 'alice', 'p-123', { baseDir: './relative' });
      expect(dir).toBe(path.join('/var/lib/od', 'users', 'alice', 'projects', 'p-123'));
    });

    it('rejects empty project ids', () => {
      expect(() => resolveUserProjectDir('/var/lib/od', 'alice', '')).toThrow();
    });
  });

  describe('defaultUserProjectsRoot', () => {
    it('is a one-call convenience that wires OD_USER_ID through resolveUserId', () => {
      const previous = process.env.OD_USER_ID;
      try {
        delete process.env.OD_USER_ID;
        expect(defaultUserProjectsRoot('/var/lib/od')).toBe(
          path.join('/var/lib/od', 'users', SYNTHETIC_USER_ID, 'projects'),
        );
        process.env.OD_USER_ID = 'bob';
        expect(defaultUserProjectsRoot('/var/lib/od')).toBe(
          path.join('/var/lib/od', 'users', 'bob', 'projects'),
        );
      } finally {
        if (previous === undefined) delete process.env.OD_USER_ID;
        else process.env.OD_USER_ID = previous;
      }
    });
  });

  describe('USER_PREFIX_MIGRATION_MARKER', () => {
    it('is a hidden dotfile in the data root', () => {
      expect(USER_PREFIX_MIGRATION_MARKER.startsWith('.')).toBe(true);
    });
  });
});

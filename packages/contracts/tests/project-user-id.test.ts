// v0.6 per-user project prefix — contract pin for the new Project.userId
// field. v7 (OIDC SSO + Postgres) will start writing real user ids here;
// this test catches accidental renames or removals of the field so the
// web client and CLI never silently lose the user id on a read.

import { describe, expect, it } from 'vitest';
import type { Project } from '../src/api/projects.js';

describe('Project DTO — v0.6 userId field', () => {
  it('accepts a project with the synthetic user id', () => {
    const p: Project = {
      id: 'p-1',
      name: 'synthetic',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      userId: 'local',
    };
    expect(p.userId).toBe('local');
  });

  it('treats userId as optional (pre-v0.6 row carries no id)', () => {
    const p: Project = {
      id: 'p-2',
      name: 'legacy',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(p.userId).toBeUndefined();
  });

  it('accepts an OIDC-shaped user id (v7 will fill these in)', () => {
    const p: Project = {
      id: 'p-3',
      name: 'oidc',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      userId: 'oidc|auth0|alice@example.com',
    };
    expect(p.userId).toMatch(/^oidc\|/);
  });
});

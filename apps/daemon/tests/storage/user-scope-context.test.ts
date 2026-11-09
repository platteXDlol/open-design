import { describe, expect, it } from 'vitest';
import {
  SYNTHETIC_USER_ID,
  currentProjectsRoot,
  resolveUserId,
  runWithUser,
} from '../../src/storage/user-scope.js';

describe('request-scoped user context (v7)', () => {
  it('falls back to the env/synthetic user outside a request (AC3)', () => {
    expect(resolveUserId({})).toBe(SYNTHETIC_USER_ID);
    expect(currentProjectsRoot('/data')).toBe('/data/users/local/projects');
  });

  it('uses the request user inside runWithUser, including across awaits (AC2)', async () => {
    await runWithUser('alice', async () => {
      await Promise.resolve();
      expect(resolveUserId({})).toBe('alice');
      expect(currentProjectsRoot('/data')).toBe('/data/users/alice/projects');
    });
    expect(resolveUserId({})).toBe(SYNTHETIC_USER_ID);
  });

  it('isolates concurrent requests', async () => {
    const seen: string[] = [];
    await Promise.all(['a', 'b'].map((u) => runWithUser(u, async () => {
      await new Promise((r) => setTimeout(r, u === 'a' ? 5 : 0));
      seen.push(`${u}:${resolveUserId({})}`);
    })));
    expect(seen.sort()).toEqual(['a:a', 'b:b']);
  });

  it('rejects path-unsafe user ids', () => {
    expect(() => runWithUser('../x', () => undefined)).toThrow();
  });
});

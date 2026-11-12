import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runShareCli } from '../src/share-cli.js';

const share = { id: 'abc', projectId: 'project-1', artifactId: 'pitch-v1', createdAt: 0, expiresAt: null, revokedAt: null, status: 'active' };
const token = `odsh_${'a'.repeat(43)}`;

describe('od share CLI', () => {
  let out: string[];
  let err: string[];
  let fetchMock: ReturnType<typeof vi.fn>;
  const base = ['--daemon-url', 'http://127.0.0.1:17456', '--project', 'project-1', '--deck', 'pitch-v1'];
  const api = 'http://127.0.0.1:17456/api/projects/project-1/artifacts/pitch-v1/shares';

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => (out.push(String(c)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => (err.push(String(c)), true));
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/projects')) return new Response(JSON.stringify({ projects: [{ id: 'project-1', name: 'Demo' }] }));
      if (init?.method === 'POST') return new Response(JSON.stringify({ share, token, path: `/s/${token}` }), { status: 201 });
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
      return new Response(JSON.stringify({ shares: [share] }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('create posts the expiry and prints the full link as JSON', async () => {
    expect((await runShareCli(['create', ...base, '--expires', '7d', '--json'])).exitCode).toBe(0);
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(api);
    expect(JSON.parse(init.body)).toEqual({ expires: '7d' });
    expect(JSON.parse(out.join(''))).toMatchObject({ ok: true, token, url: `http://127.0.0.1:17456/s/${token}` });
  });

  it('list and revoke hit the owner endpoints', async () => {
    expect((await runShareCli(['list', ...base, '--json'])).exitCode).toBe(0);
    expect(JSON.parse(out.join('')).shares[0].id).toBe('abc');
    expect((await runShareCli(['revoke', ...base, '--id', 'abc'])).exitCode).toBe(0);
    expect(fetchMock.mock.calls.at(-1)).toEqual([`${api}/abc`, { method: 'DELETE' }]);
  });

  it('rejects bad input before calling the daemon', async () => {
    expect((await runShareCli(['create', ...base, '--expires', '9y'])).exitCode).toBe(1);
    expect((await runShareCli(['revoke', ...base])).exitCode).toBe(1);
    expect((await runShareCli(['list', '--project', 'project-1'])).exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

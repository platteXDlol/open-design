import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAuthCli } from '../src/auth-cli.js';

afterEach(() => vi.unstubAllGlobals());

function stub(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    calls.push(key);
    return new Response(JSON.stringify(routes[key] ?? { error: { message: 'nope' } }), { status: key in routes ? 200 : 404 });
  }));
  return calls;
}

describe('od auth (v7 AC4)', () => {
  it('token create/list/revoke hit /api/auth/tokens and print JSON', async () => {
    const calls = stub({
      'POST /api/auth/tokens': { id: 't1', token: 'odt_x' },
      'GET /api/auth/tokens': { tokens: [{ id: 't1', label: 'cli', createdAt: 1 }] },
      'DELETE /api/auth/tokens/t1': { ok: true },
    });
    const log: string[] = [];
    const out = { log: (s: string) => log.push(s), err: (s: string) => log.push(`ERR ${s}`) };
    const base = ['--daemon-url', 'http://127.0.0.1:7456', '--json'];
    expect(await runAuthCli(['token', 'create', '--label', 'cli', ...base], out)).toBe(0);
    expect(await runAuthCli(['token', 'list', ...base], out)).toBe(0);
    expect(await runAuthCli(['token', 'revoke', 't1', ...base], out)).toBe(0);
    expect(calls).toEqual(['POST /api/auth/tokens', 'GET /api/auth/tokens', 'DELETE /api/auth/tokens/t1']);
    expect(JSON.parse(log[0]!)).toEqual({ id: 't1', token: 'odt_x' });
  });

  it('reports daemon errors with exit 1', async () => {
    stub({});
    const log: string[] = [];
    expect(await runAuthCli(['me', '--daemon-url', 'http://127.0.0.1:7456'], { log: (s) => log.push(s), err: (s) => log.push(s) })).toBe(1);
    expect(log[0]).toContain('nope');
  });
});

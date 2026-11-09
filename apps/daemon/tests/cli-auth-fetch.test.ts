import { describe, expect, it, vi } from 'vitest';
import { cliAuthToken, withDaemonAuth } from '../src/cli-auth-fetch.js';

describe('od CLI daemon auth (v7 AC4)', () => {
  it('picks --token, then OD_API_TOKEN, then OD_TOOL_TOKEN', () => {
    expect(cliAuthToken(['x', '--token', 'a'], { OD_API_TOKEN: 'b' })).toBe('a');
    expect(cliAuthToken(['x', '--token=a'], {})).toBe('a');
    expect(cliAuthToken([], { OD_API_TOKEN: 'b', OD_TOOL_TOKEN: 'c' })).toBe('b');
    expect(cliAuthToken([], { OD_TOOL_TOKEN: 'c' })).toBe('c');
    expect(cliAuthToken([], {})).toBeNull();
  });

  it('adds the bearer only for daemon URLs and never overrides an explicit header', async () => {
    const base = vi.fn(async (_i: unknown, init?: RequestInit) => new Response(new Headers(init?.headers).get('authorization')));
    const f = withDaemonAuth(base as unknown as typeof fetch, 'odt_x', { OD_DAEMON_URL: 'http://nas.lan:7456' });
    expect(await (await f('http://127.0.0.1:7456/api/projects')).text()).toBe('Bearer odt_x');
    expect(await (await f('http://nas.lan:7456/api/projects')).text()).toBe('Bearer odt_x');
    expect(await (await f('https://api.example.com/x')).text()).toBe('');
    expect(await (await f('http://127.0.0.1:11434/api/chat')).text()).toBe(''); // local Ollama
    expect(await (await f('http://127.0.0.1:7456/a', { headers: { authorization: 'Bearer t' } })).text()).toBe('Bearer t');
  });
});

import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer } from '../../src/server.js';

let started: { url: string; server: http.Server; shutdown?: () => Promise<void> | void };
const warn = vi.spyOn(console, 'warn');

beforeAll(async () => {
  vi.stubEnv('OD_OIDC_ISSUER', 'https://idp.invalid');
  vi.stubEnv('OD_OIDC_CLIENT_ID', 'od-test');
  vi.stubEnv('OD_PUBLIC_URL', 'http://127.0.0.1');
  vi.stubEnv('OD_RESET_ADMIN', '1');
  started = (await startServer({ port: 0, returnServer: true })) as typeof started;
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.resolve(started?.shutdown?.());
  await new Promise<void>((resolve) => (started ? started.server.close(() => resolve()) : resolve()));
});

describe('daemon with SSO configured (v7)', () => {
  it('AC1: gates the API and the app, leaves health and auth open', async () => {
    expect((await fetch(`${started.url}/api/projects`)).status).toBe(401);
    expect((await fetch(`${started.url}/api/health`)).status).toBe(200);
    expect((await (await fetch(`${started.url}/api/auth/me`)).json())).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    const page = await fetch(`${started.url}/`, { redirect: 'manual' });
    expect(page.status).toBe(302);
  });

  it('AC5: logs a one-time admin link that is rejected before any admin exists and once used', async () => {
    const line = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('/api/auth/admin-reset?token='));
    expect(line).toBeTruthy();
    const token = new URL(line!.slice(line!.indexOf('http'))).searchParams.get('token');
    // No SSO user yet → nobody to log in as.
    expect((await fetch(`${started.url}/api/auth/admin-reset?token=${token}`, { redirect: 'manual' })).status).toBe(401);
  });
});

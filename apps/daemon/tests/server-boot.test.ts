// Regression: the v0.5 collab removal (78c3a76e2) left a call to the deleted
// createActiveWorkspaceSelectionStore in server.ts, so the daemon threw
// ReferenceError on boot. This test fails if startServer cannot boot.
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

let started: { url: string; server: http.Server; shutdown?: () => Promise<void> | void };

beforeAll(async () => {
  started = (await startServer({ port: 0, returnServer: true })) as typeof started;
});

afterAll(async () => {
  await Promise.resolve(started?.shutdown?.());
  await new Promise<void>((resolve) => (started ? started.server.close(() => resolve()) : resolve()));
});

describe('daemon boot', () => {
  it('starts and answers /api/health', async () => {
    const resp = await fetch(`${started.url}/api/health`);
    expect(resp.ok).toBe(true);
  });
});

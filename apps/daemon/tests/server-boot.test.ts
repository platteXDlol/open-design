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

describe('v0.5 leftovers on the request path', () => {
  it('GET /api/projects/:id/workspace-scope does not 500 (workspaceTypes.typeOf stub)', async () => {
    const created = await fetch(`${started.url}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: `boot-scope-${Date.now()}`, name: 'scope probe' }),
    });
    expect(created.ok).toBe(true);
    const { project } = (await created.json()) as { project: { id: string } };
    const resp = await fetch(`${started.url}/api/projects/${encodeURIComponent(project.id)}/workspace-scope`);
    expect(resp.status).toBe(200);
  });

  it('GET /api/dialog/capabilities reports folderPicker as a boolean', async () => {
    const resp = await fetch(`${started.url}/api/dialog/capabilities`);
    expect(resp.ok).toBe(true);
    const body = (await resp.json()) as { folderPicker: unknown };
    expect(typeof body.folderPicker).toBe('boolean');
  });
});

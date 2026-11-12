// M3 share links through the real daemon: owner API create/list/revoke, public /s/<token>
// reachable outside the /api gate, live deck content, and revoke → plain 404.
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeckManifestV2, ARTBOARD_SKELETON_HTML } from '@open-design/contracts';
import { startServer } from '../../src/server.js';
import { resolveUserId, resolveUserProjectsRoot } from '../../src/storage/user-scope.js';

let started: { url: string; server: http.Server; shutdown?: () => Promise<void> | void };
const projectId = `share-e2e-${Date.now()}`;
const slide = (text: string) => ARTBOARD_SKELETON_HTML.replace('<!-- SLOT: slide content -->', `<h1>${text}</h1>`);

beforeAll(async () => {
  started = (await startServer({ port: 0, returnServer: true })) as typeof started;
  const created = await fetch(`${started.url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: projectId, name: 'Share e2e', skipDiscoveryBrief: true }),
  });
  expect(created.ok).toBe(true);
  const deckDir = path.join(
    resolveUserProjectsRoot(process.env.OD_DATA_DIR!, resolveUserId()),
    projectId,
    'artifacts',
    'deck-v1',
  );
  const files = ['artboards/01-a.html', 'artboards/02-b.html', 'artboards/03-c.html'];
  fs.mkdirSync(path.join(deckDir, 'artboards'), { recursive: true });
  fs.mkdirSync(path.join(deckDir, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(deckDir, 'shared/theme.css'), ':root{--c:#000}');
  files.forEach((f, i) => fs.writeFileSync(path.join(deckDir, f), slide(`Slide ${i + 1}`)));
  fs.writeFileSync(path.join(deckDir, 'manifest.json'), JSON.stringify(buildDeckManifestV2({ title: 'Pitch', files, status: 'complete' })));
});

afterAll(async () => {
  await Promise.resolve(started?.shutdown?.());
  await new Promise<void>((resolve) => (started ? started.server.close(() => resolve()) : resolve()));
});

describe('share links via daemon', () => {
  const api = () => `${started.url}/api/projects/${projectId}/artifacts/deck-v1/shares`;

  it('creates, lists, serves, and revokes a link', async () => {
    const res = await fetch(api(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(201);
    const created = (await res.json()) as any;
    expect(created.path).toBe(`/s/${created.token}`);
    expect(created.share.status).toBe('active');
    expect(created.share.expiresAt - created.share.createdAt).toBe(30 * 24 * 60 * 60 * 1000);

    const page = await fetch(`${started.url}${created.path}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Pitch');
    expect(html).toContain(`/s/${created.token}/f/artboards/01-a.html`);

    const file = await fetch(`${started.url}${created.path}/f/artboards/02-b.html`);
    expect(file.status).toBe(200);
    expect(await file.text()).toContain('Slide 2');
    expect((await fetch(`${started.url}${created.path}/f/manifest.json`)).status).toBe(404);

    const list = (await (await fetch(api())).json()) as any;
    expect(list.shares.map((s: { id: string }) => s.id)).toContain(created.share.id);

    const del = await fetch(`${api()}/${created.share.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const gone = await fetch(`${started.url}${created.path}`);
    expect(gone.status).toBe(404);
    expect(await gone.text()).toBe('Not found');
    const after = (await (await fetch(api())).json()) as any;
    expect(after.shares.find((s: { id: string }) => s.id === created.share.id).status).toBe('revoked');
  });

  it('rejects bad expiry and non-deck artifacts', async () => {
    const bad = await fetch(api(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"expires":"9y"}' });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${started.url}/api/projects/${projectId}/artifacts/nope/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(missing.status).toBe(404);
  });
});

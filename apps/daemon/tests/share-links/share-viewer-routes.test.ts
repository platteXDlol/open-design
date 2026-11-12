import Database from 'better-sqlite3';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeckManifestV2 } from '@open-design/contracts';
import { createShareStore } from '../../src/share-links/share-store.js';
import { registerShareViewerRoutes } from '../../src/share-links/share-viewer.js';
import { createAuthMiddleware } from '../../src/auth/auth-middleware.js';
import { createAuthStore } from '../../src/auth/auth-store.js';

describe('GET /s/:token share viewer', () => {
  let server: http.Server;
  let base: string;
  let root: string;
  let token: string;
  let revokedToken: string;
  let expiredToken: string;
  const store = createShareStore(new Database(':memory:'));

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'od-share-'));
    const deck = path.join(root, 'p1', 'artifacts', 'deck-v1');
    fs.mkdirSync(path.join(deck, 'artboards'), { recursive: true });
    fs.mkdirSync(path.join(deck, 'shared'), { recursive: true });
    fs.mkdirSync(path.join(root, 'p1', 'artifacts', 'other'), { recursive: true });
    fs.writeFileSync(path.join(root, 'p1', 'artifacts', 'other', 'secret.html'), 'SECRET');
    fs.writeFileSync(path.join(root, 'p1', 'notes.md'), 'PRIVATE');
    fs.writeFileSync(path.join(deck, 'artboards', '01-title.html'), '<!doctype html><html><body>Slide one</body></html>');
    fs.writeFileSync(path.join(deck, 'artboards', '02-pricing.html'), '<!doctype html><html><body>Pricing</body></html>');
    fs.writeFileSync(path.join(deck, 'shared', 'theme.css'), ':root{--a:#f00}');
    fs.writeFileSync(path.join(deck, 'manifest.json'), JSON.stringify(buildDeckManifestV2({
      title: 'Pitch <Deck>',
      files: ['artboards/01-title.html', 'artboards/02-pricing.html'],
      status: 'complete',
    })));
    token = store.create({ userId: 'u1', projectId: 'p1', artifactId: 'deck-v1' }).token;
    const r = store.create({ userId: 'u1', projectId: 'p1', artifactId: 'deck-v1' });
    store.revoke('u1', r.share.id);
    revokedToken = r.token;
    expiredToken = store.create({ userId: 'u1', projectId: 'p1', artifactId: 'deck-v1', expires: '1d', now: 0 }).token;

    const app = express();
    registerShareViewerRoutes(app, {
      store,
      resolveDeckDir: (s) => path.join(root, s.projectId, 'artifacts', s.artifactId),
    });
    // Real SSO gate, mounted after the viewer exactly as server.ts does.
    app.use(createAuthMiddleware({ store: createAuthStore(new Database(':memory:')), enabled: true }));
    app.get('/api/projects', (_req, res) => res.json({ leaked: true }));
    app.get('/projects', (_req, res) => res.send('app'));
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serves a read-only viewer page listing the slides in order', async () => {
    const res = await fetch(`${base}/s/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'none'");
    const html = await res.text();
    expect(html).toContain('Pitch &lt;Deck&gt;');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html.indexOf('01-title.html')).toBeLessThan(html.indexOf('02-pricing.html'));
    expect(html).not.toContain('/api/');
  });

  it('serves the deck slides and shared assets with a locked-down CSP', async () => {
    const slide = await fetch(`${base}/s/${token}/f/artboards/02-pricing.html`);
    expect(slide.status).toBe(200);
    expect(await slide.text()).toContain('Pricing');
    const csp = slide.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    const css = await fetch(`${base}/s/${token}/f/shared/theme.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
  });

  it('reflects the live deck state', async () => {
    const file = path.join(root, 'p1', 'artifacts', 'deck-v1', 'artboards', '01-title.html');
    fs.writeFileSync(file, '<!doctype html><html><body>Updated title</body></html>');
    expect(await (await fetch(`${base}/s/${token}/f/artboards/01-title.html`)).text()).toContain('Updated title');
  });

  it.each([
    ['manifest', 'manifest.json'],
    ['traversal to another artifact', '..%2Fother%2Fsecret.html'],
    ['traversal to project file', '..%2F..%2Fnotes.md'],
    ['encoded dot segments', 'shared/..%2F..%2F..%2Fnotes.md'],
    ['unknown file', 'artboards/99.html'],
  ])('refuses %s with 404', async (_label, rel) => {
    const res = await fetch(`${base}/s/${token}/f/${rel}`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('PRIVATE');
  });

  it('returns the same plain 404 for revoked, expired, unknown, and malformed tokens', async () => {
    const bodies = new Set<string>();
    for (const t of [revokedToken, expiredToken, `odsh_${'z'.repeat(43)}`, 'nope']) {
      const res = await fetch(`${base}/s/${t}`);
      expect(res.status).toBe(404);
      bodies.add(await res.text());
      expect((await fetch(`${base}/s/${t}/f/artboards/01-title.html`)).status).toBe(404);
    }
    expect(bodies.size).toBe(1);
  });

  it('answers only GET/HEAD and does not open the API', async () => {
    expect((await fetch(`${base}/s/${token}`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
    expect((await fetch(`${base}/projects`, { redirect: 'manual' })).status).toBe(302);
  });
});

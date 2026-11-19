import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// Design system "Continue to generation" posts here; a leftover v0.5 stub made
// resolveCreatedProjectHome a plain object and the route answered
// "deps.resolveCreatedProjectHome is not a function".
describe('POST /api/brands on the real server', () => {
  let server: http.Server;
  let baseUrl: string;
  let shutdown: (() => Promise<void> | void) | undefined;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    baseUrl = started.url;
    server = started.server;
    shutdown = started.shutdown;
  });

  afterAll(async () => {
    await Promise.resolve(shutdown?.());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('starts a brand from pasted DESIGN.md without crashing', async () => {
    const res = await fetch(`${baseUrl}/api/brands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designMd: '# Acme\n\nPrimary colour: #E4572E\n', locale: 'en' }),
    });
    const text = await res.text();
    expect(text).not.toContain('is not a function');
    expect(res.status).toBeLessThan(500);
  });
});

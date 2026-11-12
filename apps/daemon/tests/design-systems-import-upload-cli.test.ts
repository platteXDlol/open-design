import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

describe('od design-systems import-local --upload', () => {
  it('sends the folder files to the upload endpoint instead of a daemon-side path', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'od-ds-cli-'));
    const src = path.join(folder, 'acme');
    await mkdir(path.join(src, 'assets'), { recursive: true });
    await writeFile(path.join(src, 'DESIGN.md'), '# Acme\n');
    await writeFile(path.join(src, 'assets', 'logo.svg'), '<svg/>');
    let seen: { url: string; body: any } | null = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen = { url: req.url ?? '', body: JSON.parse(body || '{}') };
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ designSystem: { id: 'user:acme', title: 'Acme', status: 'published' } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', cliEntry, 'design-systems', 'import-local', src, '--upload', '--name', 'Acme',
          '--daemon-url', `http://127.0.0.1:${port}`, '--json'],
        { cwd: daemonRoot, env: { ...process.env } },
      );
      expect(JSON.parse(stdout).designSystem.id).toBe('user:acme');
      expect(seen!.url).toBe('/api/design-systems/import/upload');
      expect(seen!.body.name).toBe('Acme');
      expect(seen!.body.baseDir).toBeUndefined();
      const files = seen!.body.files as Array<{ path: string; content: string }>;
      expect(files.map((f) => f.path).sort()).toEqual(['acme/DESIGN.md', 'acme/assets/logo.svg']);
      const md = files.find((f) => f.path === 'acme/DESIGN.md')!;
      expect(Buffer.from(md.content, 'base64').toString()).toBe('# Acme\n');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await rm(folder, { recursive: true, force: true });
    }
  }, 60_000);
});

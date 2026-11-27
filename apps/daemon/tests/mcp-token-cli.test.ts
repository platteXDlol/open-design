// `od mcp --token` must authenticate MCP tool calls against a token-protected (Docker) daemon.
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

function fakeDaemon(token: string): Promise<string> {
  server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":{"code":"API_TOKEN_REQUIRED"}}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"projects":[{"id":"p1","name":"Deck"}]}');
  });
  return new Promise((r) => server!.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`)));
}

function callListProjects(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI_SRC, 'mcp', ...args], {
      env: { ...process.env, OD_API_TOKEN: '' },
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout; stdout: ${out}`)); }, 30_000);
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString();
      const line = out.split('\n').find((l) => l.includes('"id":2'));
      if (line) { clearTimeout(timer); child.kill(); resolve(line); }
    });
    child.on('exit', (code) => { clearTimeout(timer); if (!out.includes('"id":2')) reject(new Error(`exit ${code}; stdout: ${out}`)); });
    child.stdin.write([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}',
      '',
    ].join('\n'));
  });
}

describe('od mcp --token', () => {
  it('sends the token as Bearer to the daemon URL', async () => {
    const url = await fakeDaemon('secret-mcp-token');
    const line = await callListProjects(['--daemon-url', url, '--token', 'secret-mcp-token']);
    expect(line).not.toContain('401');
    expect(line).toContain('Deck');
  }, 40_000);

  it('still gets 401 without a token', async () => {
    const url = await fakeDaemon('secret-mcp-token');
    const line = await callListProjects(['--daemon-url', url]);
    expect(line).toContain('401');
  }, 40_000);
});

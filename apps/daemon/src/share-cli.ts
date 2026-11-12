// `od share create|list|revoke` — M3 view-only deck links, same endpoints as the web Share button.
import {
  isShareLinkExpiry,
  type CreateShareLinkResponse,
  type ShareLink,
  type ShareLinksResponse,
} from '@open-design/contracts';
import { resolveDaemonUrl } from './daemon-url.js';
import { resolveProjectArg } from './mcp.js';

const USAGE = `Usage:
  od share create --deck <deck-id> [--expires 1d|7d|30d|never] [--project <id-or-name>] [--json] [--daemon-url <url>]
  od share list --deck <deck-id> [--project <id-or-name>] [--json] [--daemon-url <url>]
  od share revoke --deck <deck-id> --id <share-id> [--project <id-or-name>] [--json] [--daemon-url <url>]

Creates a read-only link to one multi-artboard deck (default expiry 30d).
Anyone with the link can view the deck's current slides without signing in.
The token is printed once; only its hash is stored.
`;

type Opts = Record<'deck' | 'expires' | 'project' | 'id' | 'daemonUrl', string | undefined> & { json: boolean };

const FLAGS: Record<string, keyof Opts> = {
  '--deck': 'deck',
  '--expires': 'expires',
  '--project': 'project',
  '--id': 'id',
  '--daemon-url': 'daemonUrl',
};

function fail(message: string, status?: number): { exitCode: number } {
  process.stderr.write(`${JSON.stringify({ ok: false, ...(status ? { status } : {}), error: { message } })}\n`);
  return { exitCode: 1 };
}

const describe = (s: ShareLink) =>
  `${s.id}  ${s.status}  expires ${s.expiresAt === null ? 'never' : new Date(s.expiresAt).toISOString()}`;

export async function runShareCli(args: string[]): Promise<{ exitCode: number }> {
  const [command, ...rest] = args;
  if (!command || command === '-h' || command === '--help' || rest.includes('--help')) {
    process.stdout.write(USAGE);
    return { exitCode: command ? 0 : 1 };
  }
  const opts: Opts = { deck: undefined, expires: undefined, project: undefined, id: undefined, daemonUrl: undefined, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    const key = FLAGS[arg];
    if (!key) return fail(`unknown option: ${arg}`);
    const value = rest[++i];
    if (!value) return fail(`${arg} requires a value`);
    (opts as Record<string, unknown>)[key] = value;
  }
  if (!['create', 'list', 'revoke'].includes(command)) return fail(`unknown share command: ${command}`);
  if (!opts.deck) return fail(`share ${command} requires --deck <deck-id>`);
  if (opts.expires !== undefined && !isShareLinkExpiry(opts.expires)) return fail('--expires must be 1d, 7d, 30d, or never');
  if (command === 'revoke' && !opts.id) return fail('share revoke requires --id <share-id>');

  try {
    const daemonUrl = await resolveDaemonUrl(opts.daemonUrl === undefined ? {} : { flagUrl: opts.daemonUrl });
    const { id: projectId } = await resolveProjectArg(daemonUrl, opts.project);
    const base = `${daemonUrl}/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(opts.deck)}/shares`;
    const resp =
      command === 'create'
        ? await fetch(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts.expires ? { expires: opts.expires } : {}),
          })
        : command === 'revoke'
          ? await fetch(`${base}/${encodeURIComponent(opts.id!)}`, { method: 'DELETE' })
          : await fetch(base);
    if (!resp.ok) return fail(`daemon ${resp.status}: ${await resp.text()}`, resp.status);
    const body = await resp.json();
    if (command === 'create') {
      const created = body as CreateShareLinkResponse;
      const url = `${daemonUrl}${created.path}`;
      if (opts.json) process.stdout.write(`${JSON.stringify({ ok: true, ...created, url })}\n`);
      else process.stdout.write(`${url}\n${describe(created.share)}\n`);
    } else if (command === 'list') {
      const { shares } = body as ShareLinksResponse;
      if (opts.json) process.stdout.write(`${JSON.stringify({ shares })}\n`);
      else process.stdout.write(shares.length ? `${shares.map(describe).join('\n')}\n` : 'no share links\n');
    } else {
      process.stdout.write(opts.json ? `${JSON.stringify({ ok: true, id: opts.id })}\n` : `revoked ${opts.id}\n`);
    }
    return { exitCode: 0 };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

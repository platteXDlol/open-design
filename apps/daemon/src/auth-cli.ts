// v7: `od auth me` and `od auth token create|list|revoke` over /api/auth/* (UI/CLI dual-track with Settings → Account).
import type { ApiTokenCreateResponse, ApiTokenListResponse, AuthMeResponse } from '@open-design/contracts';
import { resolveDaemonUrl } from './daemon-url.js';

const USAGE = `Usage:
  od auth me [--json]                          Show the signed-in user (SSO) or that SSO is off.
  od auth token create [--label <name>] [--json]   Create a personal API token (shown once).
  od auth token list [--json]                  List your API tokens.
  od auth token revoke <id> [--json]           Revoke one of your API tokens.
Global: --token <t> or OD_API_TOKEN authenticates od when SSO is on. --daemon-url <url> overrides the daemon.
`;

type Out = { log: (s: string) => void; err: (s: string) => void };

async function call<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, base), {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json as T;
}

export async function runAuthCli(args: string[], out: Out = { log: console.log, err: console.error }): Promise<number> {
  const json = args.includes('--json');
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !['--label', '--daemon-url', '--token'].includes(args[i - 1] ?? ''));
  const [cmd, sub, arg] = pos;
  const daemonUrl = flag('--daemon-url');
  try {
    const base = await resolveDaemonUrl(daemonUrl === undefined ? {} : { flagUrl: daemonUrl });
    if (cmd === 'me') {
      const r = await call<AuthMeResponse>(base, 'GET', '/api/auth/me');
      out.log(json ? JSON.stringify(r) : r.ssoEnabled && r.user ? `${r.user.email ?? r.user.id}${r.user.isAdmin ? ' (admin)' : ''}` : 'SSO is off (single local user)');
      return 0;
    }
    if (cmd === 'token' && sub === 'create') {
      const r = await call<ApiTokenCreateResponse>(base, 'POST', '/api/auth/tokens', { label: flag('--label') ?? 'cli' });
      out.log(json ? JSON.stringify(r) : `${r.token}\n(id ${r.id}; shown once — store it as OD_API_TOKEN)`);
      return 0;
    }
    if (cmd === 'token' && sub === 'list') {
      const r = await call<ApiTokenListResponse>(base, 'GET', '/api/auth/tokens');
      out.log(json ? JSON.stringify(r) : r.tokens.map((t) => `${t.id}\t${t.label}`).join('\n') || 'no tokens');
      return 0;
    }
    if (cmd === 'token' && sub === 'revoke' && arg) {
      const r = await call<{ ok: boolean }>(base, 'DELETE', `/api/auth/tokens/${encodeURIComponent(arg)}`);
      out.log(json ? JSON.stringify(r) : `revoked ${arg}`);
      return 0;
    }
    out.err(USAGE);
    return cmd ? 2 : 1;
  } catch (e) {
    out.err(json ? JSON.stringify({ ok: false, error: (e as Error).message }) : `od auth: ${(e as Error).message}`);
    return 1;
  }
}

// v7: every `od` request to the daemon carries the caller's credential, so the CLI works when SSO is on.
// Precedence: --token flag, OD_API_TOKEN (per-user token), OD_TOOL_TOKEN (run-scoped, injected for agents).

export function cliAuthToken(argv: string[], env: NodeJS.ProcessEnv): string | null {
  const i = argv.indexOf('--token');
  const flag = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith('--token='))?.slice(8);
  return (flag || env.OD_API_TOKEN || env.OD_TOOL_TOKEN || '').trim() || null;
}

const origin = (v: string | undefined) => { try { return v ? new URL(v).origin : null; } catch { return null; } };

/**
 * Only the daemon may receive the token: the --daemon-url / OD_DAEMON_URL origin, or loopback on the
 * daemon port (OD_PORT, default 7456) — never another local service such as Ollama.
 */
export function isDaemonUrl(url: string, env: NodeJS.ProcessEnv, argv: string[] = []): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const i = argv.indexOf('--daemon-url');
  if ([origin(i >= 0 ? argv[i + 1] : undefined), origin(env.OD_DAEMON_URL)].includes(u.origin)) return true;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && port === String(env.OD_PORT || 7456);
}

export function withDaemonAuth(base: typeof fetch, token: string | null, env: NodeJS.ProcessEnv, argv: string[] = []): typeof fetch {
  if (!token) return base;
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (isDaemonUrl(url, env, argv) && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    return base(input, { ...init, headers });
  };
}

globalThis.fetch = withDaemonAuth(globalThis.fetch, cliAuthToken(process.argv, process.env), process.env, process.argv);

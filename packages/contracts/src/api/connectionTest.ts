// Result categories surfaced by the connection-test endpoint. The web UI
// translates each kind into user-facing copy; the daemon picks one per test
// and returns it inside a JSON envelope (always HTTP 200 — see notes in the
// daemon module for why).
import type { AgentCliEnvPrefs } from './app-config';
import type { ReasoningExecutionRequestFields } from './reasoningExecution';

export interface BaseUrlValidationResult {
  parsed?: ParsedBaseUrl;
  error?: string;
  forbidden?: boolean;
  // Addresses resolved by DNS lookup that passed validation. Present when
  // `validateBaseUrlResolved` performed a DNS lookup and every resolved address
  // was safe (public, or allowlisted). Callers that fetch the URL (e.g.
  // `assertAndFetchExternalAsset`) pin the connection to these addresses so
  // that a DNS-rebinding domain cannot return a different (loopback/internal)
  // address at fetch time (issue #5478).
  resolvedAddresses?: ReadonlyArray<{ address: string; family: number }>;
}

export interface ParsedBaseUrl {
  protocol: string;
  hostname: string;
  toString(): string;
}

declare const URL: {
  new(input: string): ParsedBaseUrl;
};

function normalizeBracketedIpv6(hostname: string): string {
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  // FQDN trailing-dot form (RFC 1034) resolves identically to the dotless form,
  // so `localhost.` must normalize to `localhost` before the equality check in
  // isLoopbackApiHost — and `0.0.0.0.`, `10.0.0.1.`, etc. must normalize before
  // isBlockedIpv4 parses them. Strips one or more trailing dots.
  return stripped.toLowerCase().replace(/\.+$/, '');
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const parsed = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });
  if (parsed.some((part) => part === null)) return null;
  return parsed as [number, number, number, number];
}

function isLoopbackIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  return Boolean(parts && parts[0] === 127);
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    a >= 224
  );
}

// RFC1918 private ranges only: 10/8, 172.16/12, 192.168/16. Cloud-metadata
// (169.254/16) and CGNAT (100.64/10) are NOT in this set — they stay blocked
// always regardless of `allowPrivateNetworks`. Used as the carve-out predicate
// when the Local-First daemon operator opts into LAN AI endpoints.
// Exported so the daemon's DNS-aware `validateBaseUrlResolved` (which lives
// in `apps/daemon/src/connectionTest.ts` because the contract layer is pure
// TS with no Node `dns` dependency) can apply the same RFC1918 carve-out at
// the resolved-IP layer.
export function isRfc1918Host(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (parts) {
    const [a, b] = parts;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  // IPv4-mapped IPv6 literal (e.g. `[::ffff:192.168.1.5]`) — recurse with
  // the dotted-quad form so the carve-out applies there too. Brackets are
  // already stripped inside `ipv4MappedToDotted` via `normalizeBracketedIpv6`.
  const mapped = ipv4MappedToDotted(hostname);
  if (mapped) return isRfc1918Host(mapped);
  return false;
}

function ipv4MappedToDotted(hostname: string): string | null {
  const host = normalizeBracketedIpv6(hostname);
  const mapped = /^::ffff:(.+)$/i.exec(host)?.[1];
  if (!mapped) return null;
  if (parseIpv4(mapped.toLowerCase())) return mapped.toLowerCase();
  const hexParts = mapped.split(':');
  if (
    hexParts.length !== 2 ||
    !hexParts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))
  ) {
    return null;
  }
  const hi = hexParts[0];
  const lo = hexParts[1];
  if (!hi || !lo) return null;
  const value =
    (Number.parseInt(hi, 16) << 16) |
    Number.parseInt(lo, 16);
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

export function isLoopbackApiHost(hostname: string): boolean {
  const host = normalizeBracketedIpv6(hostname);
  if (host === 'localhost' || host === '::1') return true;
  if (isLoopbackIpv4(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isLoopbackIpv4(mapped));
}

export function isBlockedExternalApiHostname(hostname: string): boolean {
  const host = normalizeBracketedIpv6(hostname);
  if (host === '::') return true;
  if (isBlockedIpv4(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isBlockedIpv4(mapped));
}

// Normalized forms a hostname can be matched under: the bracket-stripped,
// lowercased, trailing-dot-stripped string plus, for IPv4-mapped IPv6
// literals, the dotted-quad form. Both an allowlist entry and a candidate
// host are reduced through this so `10.0.0.5`, `10.0.0.5.`, `[::ffff:10.0.0.5]`
// and `10.0.0.5` all compare equal.
function internalHostMatchForms(hostname: string): string[] {
  const normalized = normalizeBracketedIpv6(hostname);
  const forms = new Set<string>([normalized]);
  const mapped = ipv4MappedToDotted(hostname);
  if (mapped) forms.add(mapped.toLowerCase());
  return [...forms];
}

// Issue #3225 — explicit, operator-declared escape hatch from the
// default-deny internal-IP guard. Returns true only when `hostname` matches
// a host the operator deliberately trusted (see `OD_ALLOWED_INTERNAL_HOSTS`
// on the daemon). An empty/absent allowlist always returns false, so the
// strict default is preserved unless an operator opts in. This is consulted
// ONLY for user-configured provider endpoints, never for the
// attacker-controllable asset-download SSRF guard.
export function isAllowlistedInternalHost(
  hostname: string,
  allowedInternalHosts?: readonly string[],
): boolean {
  if (!allowedInternalHosts || allowedInternalHosts.length === 0) return false;
  const candidateForms = internalHostMatchForms(hostname);
  for (const entry of allowedInternalHosts) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const entryForms = internalHostMatchForms(entry.trim());
    if (entryForms.some((form) => candidateForms.includes(form))) return true;
  }
  return false;
}

export interface ValidateBaseUrlOptions {
  // Hosts the operator has explicitly declared trusted (issue #3225). Each
  // entry is a bare hostname or IP literal; a host that matches is exempted
  // from the internal-IP block. Defaults to none, keeping the strict
  // default-deny behavior for every caller that does not opt in.
  allowedInternalHosts?: readonly string[];
  // When true, loopback hosts (127.0.0.0/8, ::1, localhost) are treated as
  // forbidden rather than allowed. Used by `assertExternalAssetUrl` for
  // attacker-controllable asset download URLs (issue #5478), where loopback
  // must never be reachable regardless of the operator allowlist. Defaults to
  // false so user-configured provider endpoints (connection test, BYOK chat)
  // keep working with local gateways.
  forbidLoopback?: boolean;
  // When true, RFC1918 hosts (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  // skip the internal-IP block. Used by the Local-First fork so an operator
  // running a self-hosted AI on the LAN (e.g. llama-swap at 192.168.1.42)
  // does not have to list every host in `allowedInternalHosts`. Defaults to
  // false at the contract layer (strict default-deny preserved for any caller
  // that does not opt in). Cloud-metadata (169.254/16) and CGNAT (100.64/10)
  // are NOT in the RFC1918 set and stay blocked regardless of this toggle.
  // The asset-download SSRF guard (`assertExternalAssetUrl`) never consults
  // this option — strict always.
  allowPrivateNetworks?: boolean;
}

export function validateBaseUrl(
  baseUrl: string,
  options: ValidateBaseUrlOptions = {},
): BaseUrlValidationResult {
  let parsed: ParsedBaseUrl;
  try {
    parsed = new URL(String(baseUrl).replace(/\/+$/, ''));
  } catch {
    return { error: 'Invalid baseUrl' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { error: 'Only http/https allowed' };
  }
  const hostname = parsed.hostname.toLowerCase();
  // When forbidLoopback is set (asset download URLs), reject loopback
  // hosts entirely — they should never be reachable from an
  // attacker-controllable response field (issue #5478).
  if (options.forbidLoopback && isLoopbackApiHost(hostname)) {
    return { error: 'Loopback addresses blocked for asset URLs', forbidden: true };
  }
  if (
    !isLoopbackApiHost(hostname) &&
    !isAllowlistedInternalHost(hostname, options.allowedInternalHosts) &&
    isBlockedExternalApiHostname(hostname) &&
    !(options.allowPrivateNetworks === true && isRfc1918Host(hostname))
  ) {
    return { error: 'Internal IPs blocked', forbidden: true };
  }
  return { parsed };
}

export type ConnectionTestKind =
  | 'success'
  | 'auth_failed'
  | 'forbidden'
  | 'not_found_model'
  | 'invalid_model_id'
  | 'invalid_base_url'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'agent_not_installed'
  | 'agent_auth_required'
  | 'agent_spawn_failed'
  | 'unknown';

// Phase markers describing how far the local agent connection test
// progressed before it produced its result. Used inside
// `ConnectionTestResponse.diagnostics.phase` and intended to be stable
// across daemon versions so Settings UI and CLI consumers can render
// phase-aware copy without re-deriving it from the free-form `detail`
// string. See issue #2248.
export type ConnectionTestPhase =
  | 'binary_resolution'
  | 'version_probe'
  | 'model_list'
  | 'spawn'
  | 'connection_smoke_test'
  | 'output_parse';

export interface ConnectionTestDiagnostics {
  // How far the test progressed before producing the result. Always
  // set on local agent test responses.
  phase: ConnectionTestPhase;
  // Absolute filesystem path of the executable the daemon actually
  // attempted to run, when resolution succeeded.
  binaryPath?: string;
  // Best-effort version string captured during `version_probe`. Null
  // when the CLI exposes no machine-parseable version output.
  binaryVersion?: string | null;
  // Child process exit metadata. Both fields keep the raw `code` /
  // `signal` shape from `child_process` so consumers can distinguish
  // a clean non-zero exit from a SIGTERM teardown. `signal` is typed as
  // `string | null` (not `NodeJS.Signals`) so the generated `.d.ts`
  // stays browser-safe — the daemon writes one of the
  // `NodeJS.Signals` literals here but consumers never need to import
  // ambient Node namespaces just to read an HTTP response shape.
  exitCode?: number | null;
  signal?: string | null;
  // Last ~400 bytes of the child's streams, already passed through
  // the daemon's secret redactor.
  stdoutTail?: string;
  stderrTail?: string;
}

// Local-First fork: only the three Local-First-relevant HTTP provider
// protocols remain. `openai` covers OpenAI API plus any OpenAI-compatible
// gateway (LM Studio, vLLM, llama-swap, OpenRouter, NVIDIA, DeepInfra);
// `anthropic` covers Anthropic API plus any Anthropic-compatible endpoint;
// `ollama` is the self-hosted LLM server. The five cloud-only upstream
// protocols (azure, google, bedrock, senseaudio, aihubmix) were dropped
// because they have no Local-First use case.
export type ConnectionTestProtocol =
  | 'anthropic'
  | 'openai'
  | 'ollama';

// Runtime enumeration mirroring the `ConnectionTestProtocol` union. The
// `satisfies` clause makes the constant a compile-time witness of the
// union — adding a member to the union without listing it here, or vice
// versa, is a TypeScript error. Tests assert on this runtime list to
// pin down the Local-First protocol scope.
export const CONNECTION_TEST_PROTOCOLS = [
  'anthropic',
  'openai',
  'ollama',
] as const satisfies ReadonlyArray<ConnectionTestProtocol>;

export interface ProviderTestRequest extends ReasoningExecutionRequestFields {
  protocol: ConnectionTestProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  // Azure only. When omitted, the daemon falls back to its default api-version.
  apiVersion?: string;
}

export interface AgentTestRequest {
  agentId: string;
  model?: string;
  reasoning?: string;
  serviceTier?: string;
  agentCliEnv?: AgentCliEnvPrefs;
}

export type ConnectionTestRequest =
  | ({ mode: 'provider' } & ProviderTestRequest)
  | ({ mode: 'agent' } & AgentTestRequest);

export interface ConnectionTestResponse {
  ok: boolean;
  kind: ConnectionTestKind;
  latencyMs: number;
  // Model id or CLI default slot that this test exercised.
  model?: string;
  // Concrete model reported by a local agent when an alias or default slot resolves.
  resolvedModel?: string;
  // Truncated assistant reply (≤ 120 chars) on success.
  sample?: string;
  // Upstream HTTP status when relevant (provider tests).
  status?: number;
  // Display name of the resolved agent (CLI tests).
  agentName?: string;
  // Free-form, redacted detail line — surfaced in the `unknown`,
  // `agent_spawn_failed`, and `upstream_unavailable` copy.
  detail?: string;
  // Optional executable-path diagnostics for Local CLI tests. Used by
  // Settings to explain whether a saved custom path worked, was ignored,
  // or required a PATH fallback.
  configuredExecutablePath?: string;
  detectedExecutablePath?: string;
  usedExecutablePath?: string;
  usedExecutableSource?: 'configured' | 'path' | 'fallback_invalid' | 'fallback_failed';
  // Structured diagnostics for the local agent connection test path
  // (#2248). Optional and additive: existing consumers that only read
  // `kind` and `detail` keep working unchanged. Populated on local
  // agent test responses — including early failures that never reach
  // the spawn step (unknown agent id, unresolved binary, preflight
  // auth probe). Provider tests omit it.
  diagnostics?: ConnectionTestDiagnostics;
}

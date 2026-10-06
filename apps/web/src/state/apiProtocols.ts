// Shared metadata for the API protocols the BYOK pickers offer.
//
// The lists are intentionally hand-curated rather than auto-discovered:
// every option exposes `provider/model` strings the daemon already
// understands, so a new entry here implies a deliberate decision about
// support on the request side too. (Local-First fork: only
// `anthropic`, `openai`, `ollama` are exposed — see PR #9.)

import type { ApiProtocol } from '../types';

// Suggested fast-pass / common models per protocol — what the BYOK
// model dropdown lists by default.
export const SUGGESTED_MODELS_BY_PROTOCOL: Record<ApiProtocol, readonly string[]> = {
  anthropic: [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'mimo-v2.5-pro',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3',
    'o4-mini',
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'mimo-v2.5-pro',
  ],
  ollama: [
    'cogito-2.1:671b',
    'deepseek-v3.1:671b',
    'deepseek-v3.2',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'devstral-2:123b',
    'devstral-small-2:24b',
    'gemini-3-flash-preview',
    'gemma3:4b',
    'gemma3:12b',
    'gemma3:27b',
    'gemma4:31b',
    'glm-4.6',
    'glm-4.7',
    'glm-5',
    'glm-5.1',
    'glm-5.2',
    'gpt-oss:20b',
    'gpt-oss:120b',
    'kimi-k2:1t',
    'kimi-k2-thinking',
    'kimi-k2.5',
    'kimi-k2.6',
    'kimi-k2.7-code',
    'qwen3-coder:480b',
    'qwen3-coder-next',
    'qwen3-next:80b',
    'qwen3-vl:235b',
    'qwen3-vl:235b-instruct',
    'qwen3.5:397b',
    'rnj-1:8b',
  ],
};

// "Fast / cheap" model recommendation for each protocol. Used by the
// memory extractor's auto-mode pill ("we'll quietly run gpt-4o-mini on
// your OpenAI key") and by anyone else who needs a one-pick default
// that prioritises latency + cost over reasoning depth.
export const FAST_MODEL_BY_PROTOCOL: Record<ApiProtocol, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  // Ollama Cloud doesn't have a clean "fast small model" default that
  // works for the LLM memory extractor — the catalog skews to large
  // open-weight checkpoints. Fall back to a small Gemma so the auto-
  // pick produces a deterministic answer; users who care can override
  // through the Memory model picker.
  ollama: 'gemma3:4b',
};

export const API_PROTOCOL_TABS: ReadonlyArray<{
  id: ApiProtocol;
  title: string;
}> = [
  { id: 'anthropic', title: 'Anthropic' },
  { id: 'openai', title: 'OpenAI' },
  { id: 'ollama', title: 'Ollama Cloud' },
];

export const API_PROTOCOL_LABELS: Record<ApiProtocol, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  ollama: 'Ollama Cloud API',
};

export const API_KEY_PLACEHOLDERS: Record<ApiProtocol, string> = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  ollama: 'Ollama API key',
};

// Default base URL the daemon assumes when the user leaves the field
// blank. Kept here so the BYOK form can render it as a placeholder
// hint and keep the two surfaces (form vs. daemon) in sync.
export const DEFAULT_BASE_URL_BY_PROTOCOL: Record<ApiProtocol, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  ollama: 'https://ollama.com',
};

// Fixed-origin gateways: managed single-endpoint providers where the user only
// supplies an API key — the Base URL is implied, so the Settings form hides the
// field. Centralised here (not in a component) so config loading, the Settings
// form, and the top-bar switcher all resolve the same origin. Add a protocol
// here when it's such a gateway.
export const FIXED_ORIGIN_GATEWAYS: ReadonlySet<ApiProtocol> = new Set<ApiProtocol>([
  // Local-First fork: no fixed-origin gateways remain after dropping
  // aihubmix / senseaudio in v0.2. The set is intentionally empty so the
  // existing `isFixedOriginGateway` helper stays valid. If a future
  // fixed-origin protocol is added (e.g. a managed OpenAI-compatible
  // endpoint), add it here.
]);

export function isFixedOriginGateway(protocol: ApiProtocol): boolean {
  return FIXED_ORIGIN_GATEWAYS.has(protocol);
}

// Resolve the effective base URL. Fixed-origin gateways always use their
// canonical origin: the field is hidden, so an empty stored value must not leak
// through and break URL-gated logic such as the live model-list fetch (which
// requires a valid base URL and otherwise silently shows only the static list).
// Idempotent for non-gateway protocols — returns their value unchanged.
export function resolveFixedOriginBaseUrl(
  protocol: ApiProtocol,
  baseUrl: string,
): string {
  return isFixedOriginGateway(protocol) ? DEFAULT_BASE_URL_BY_PROTOCOL[protocol] : baseUrl;
}
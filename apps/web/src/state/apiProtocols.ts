// Shared metadata for the API protocols the BYOK pickers offer.
//
// The lists are intentionally hand-curated rather than auto-discovered:
// every option exposes `provider/model` strings the daemon already
// understands, so a new entry here implies a deliberate decision about
// support on the request side too. (Local-First fork: only
// `anthropic`, `openai`, `ollama` are exposed — see PR #9.)

import type { Dict } from '../i18n/types';
import type { ApiProtocol } from '../types';

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

// The BYOK provider pickers offer only these two generic entries; the user
// types base URL, key and model. Legacy `ollama` configs display as
// OpenAI-compatible (see `byokCompatibleProtocol`).
export const API_PROTOCOL_TABS = [
  { id: 'anthropic', labelKey: 'settings.providerAnthropicCompatible' },
  { id: 'openai', labelKey: 'settings.providerOpenAICompatible' },
] as const satisfies ReadonlyArray<{ id: ApiProtocol; labelKey: keyof Dict }>;

export function byokCompatibleProtocol(protocol: ApiProtocol): 'anthropic' | 'openai' {
  return protocol === 'anthropic' ? 'anthropic' : 'openai';
}

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
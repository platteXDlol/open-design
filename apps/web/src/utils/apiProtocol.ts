import { isOpenAICompatible } from '../providers/openai-compatible';
import type { ApiProtocol, AppConfig } from '../types';
import { API_PROTOCOL_AGENT_IDS } from './byokProvider';

const API_PROTOCOL_LABELS: Record<ApiProtocol, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  ollama: 'Ollama Cloud API',
};

export function apiProtocolLabel(protocol: ApiProtocol | undefined): string {
  return API_PROTOCOL_LABELS[protocol ?? 'anthropic'];
}

export function apiProtocolModelLabel(
  protocol: ApiProtocol | undefined,
  model: string,
): string {
  const label = `${apiProtocolLabel(protocol)} via OpenCode`;
  const trimmed = model.trim();
  return trimmed ? `${label} · ${trimmed}` : label;
}

export function apiProtocolAgentId(protocol: ApiProtocol | undefined): string {
  return API_PROTOCOL_AGENT_IDS[protocol ?? 'anthropic'];
}

// Local-First fork: only `anthropic` routes through the Anthropic proxy.
// Everything else (`openai`, `ollama`, and the implicit OpenAI-compatible
// fallback when `apiProtocol` is unset and the model looks compatible)
// routes through the OpenAI-compatible path.
export function usesAnthropicProxy(cfg: AppConfig): boolean {
  if (cfg.apiProtocol === 'openai' || cfg.apiProtocol === 'ollama') {
    return false;
  }
  if (!cfg.apiProtocol && isOpenAICompatible(cfg.model, cfg.baseUrl)) {
    return false;
  }
  return Boolean(cfg.baseUrl && cfg.baseUrl !== 'https://api.anthropic.com');
}

export function isAnthropicSupportedImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return /\.(jpe?g|png|gif|webp)$/.test(lower);
}

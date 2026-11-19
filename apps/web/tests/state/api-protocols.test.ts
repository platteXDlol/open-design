import { describe, expect, it } from 'vitest';
import * as apiProtocols from '../../src/state/apiProtocols';
import { API_PROTOCOL_TABS, byokCompatibleProtocol } from '../../src/state/apiProtocols';

describe('BYOK provider picker entries', () => {
  it('offers exactly Anthropic-compatible and OpenAI-compatible', () => {
    expect(API_PROTOCOL_TABS).toEqual([
      { id: 'anthropic', labelKey: 'settings.providerAnthropicCompatible' },
      { id: 'openai', labelKey: 'settings.providerOpenAICompatible' },
    ]);
  });

  it('shows saved non-anthropic protocols (incl. legacy ollama) as OpenAI-compatible', () => {
    expect(byokCompatibleProtocol('anthropic')).toBe('anthropic');
    expect(byokCompatibleProtocol('openai')).toBe('openai');
    expect(byokCompatibleProtocol('ollama')).toBe('openai');
  });

  it('no longer ships hard-coded vendor model suggestions', () => {
    expect('SUGGESTED_MODELS_BY_PROTOCOL' in apiProtocols).toBe(false);
  });
});

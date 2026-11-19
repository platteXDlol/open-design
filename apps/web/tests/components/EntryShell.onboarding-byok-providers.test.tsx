// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingByokSetupPanel } from '../../src/components/EntryShell';
import type { ApiProtocol } from '../../src/types';

function renderPanel(apiProtocol: ApiProtocol, onProtocolChange = vi.fn()) {
  render(
    <OnboardingByokSetupPanel
      apiProtocol={apiProtocol}
      apiKey="saved-key"
      baseUrl="http://192.168.1.18:8080"
      model=""
      modelOptions={[]}
      apiKeyVisible={false}
      onToggleApiKey={vi.fn()}
      onProtocolChange={onProtocolChange}
      onApiKeyChange={vi.fn()}
      onModelChange={vi.fn()}
      onBaseUrlChange={vi.fn()}
      testState={{ status: 'idle' }}
      canTest={false}
      onTest={vi.fn()}
      modelsState={{ status: 'idle' }}
      canFetchModels={false}
      onFetchModels={vi.fn()}
    />,
  );
  return within(screen.getByRole('tablist', { name: 'API protocol' })).getAllByRole('tab');
}

describe('Onboarding BYOK provider picker', () => {
  afterEach(cleanup);

  it('offers exactly Anthropic-compatible and OpenAI-compatible, no vendor presets', () => {
    const onProtocolChange = vi.fn();
    const tabs = renderPanel('anthropic', onProtocolChange);

    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Anthropic-compatible',
      'OpenAI-compatible',
    ]);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Quick fill provider')).toBeNull();
    expect(screen.queryByText(/Ollama|DeepSeek|OpenRouter/)).toBeNull();

    fireEvent.click(tabs[1]!);
    expect(onProtocolChange).toHaveBeenCalledWith('openai');
  });

  it('shows a saved legacy ollama config as OpenAI-compatible', () => {
    const tabs = renderPanel('ollama');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('saved-key');
  });
});

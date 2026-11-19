// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../../src/components/SettingsDialog';
import { DEFAULT_CONFIG } from '../../src/state/config';
import type { AppConfig } from '../../src/types';

function renderByok(initial: Partial<AppConfig>) {
  return render(
    <SettingsDialog
      initial={{ ...DEFAULT_CONFIG, mode: 'api', ...initial }}
      agents={[]}
      daemonLive
      appVersionInfo={null}
      initialSection="execution"
      onPersist={vi.fn()}
      onPersistComposioKey={vi.fn()}
      onClose={vi.fn()}
      onRefreshAgents={vi.fn()}
    />,
  );
}

function providerTabs() {
  const tablist = screen.getByRole('tablist', { name: 'API protocol' });
  return within(tablist).getAllByRole('tab');
}

describe('SettingsDialog BYOK provider picker', () => {
  beforeEach(() => {
    // No live model list: discovery and connection tests never resolve.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers exactly Anthropic-compatible and OpenAI-compatible', () => {
    renderByok({ apiProtocol: 'anthropic', baseUrl: '', model: '', apiKey: '' });

    expect(providerTabs().map((tab) => tab.textContent?.trim())).toEqual([
      'Anthropic-compatible',
      'OpenAI-compatible',
    ]);
    expect(screen.queryByLabelText('Provider preset')).toBeNull();
    expect(screen.queryByText(/DeepSeek|OpenRouter|Ollama|SiliconFlow|Atlas Cloud/)).toBeNull();
  });

  it('shows a saved DeepSeek (openai) config as OpenAI-compatible with its fields preserved', () => {
    renderByok({
      apiProtocol: 'openai',
      apiKey: 'sk-deepseek-saved',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiProviderBaseUrl: 'https://api.deepseek.com',
    });

    const [anthropicTab, openaiTab] = providerTabs();
    expect(openaiTab!.getAttribute('aria-selected')).toBe('true');
    expect(anthropicTab!.getAttribute('aria-selected')).toBe('false');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'https://api.deepseek.com',
    );
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(
      'sk-deepseek-saved',
    );
    expect(screen.getByDisplayValue('deepseek-chat')).toBeTruthy();

    // Re-clicking the active entry must not rewrite the saved config.
    fireEvent.click(openaiTab!);
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(
      'sk-deepseek-saved',
    );
    expect(screen.getByDisplayValue('deepseek-chat')).toBeTruthy();
  });

  it('shows a saved ollama config as OpenAI-compatible without dropping its key', () => {
    renderByok({
      apiProtocol: 'ollama',
      apiKey: 'ollama-key',
      baseUrl: 'https://ollama.com',
      model: 'gpt-oss:120b',
      apiProviderBaseUrl: 'https://ollama.com',
    });

    expect(providerTabs()[1]!.getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('ollama-key');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'https://ollama.com',
    );
  });

  it('uses a free-text model field without hard-coded vendor suggestions', () => {
    renderByok({ apiProtocol: 'openai', baseUrl: '', model: '', apiKey: '' });

    expect(screen.queryByRole('combobox', { name: 'Model' })).toBeNull();
    expect(screen.getByLabelText(/^Model/)).toBeTruthy();
    expect(screen.queryByText(/gpt-4o|claude-sonnet|deepseek-v4/)).toBeNull();
  });
});

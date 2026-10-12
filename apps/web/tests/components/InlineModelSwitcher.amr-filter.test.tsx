// @vitest-environment jsdom

// Local-First fork regression: the OpenDesign AMR/Cloud agent is no longer
// reachable from the InlineModelSwitcher popover. The radio grid already
// filters `amr` out of `installedAgents`, and the dedicated AMR account
// row was removed in this PR.
//
// This test renders the popover with an `amr` agent present in the
// `installedAgents` list and asserts:
//   1. No `data-testid` of the form `inline-model-switcher-agent-amr` is
//      present in the radio grid.
//   2. No `data-testid="inline-model-switcher-account-amr"` is present —
//      the deleted AMR account row.
//   3. The other 26 non-AMR agents are still rendered, so the filter
//      doesn't accidentally swallow the Local-First agent list.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineModelSwitcher } from '../../src/components/InlineModelSwitcher';
import type { AgentInfo, AppConfig } from '../../src/types';

const analyticsMocks = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      track: analyticsMocks.track,
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
      setConfigureGlobals: vi.fn(),
      setUserId: vi.fn(),
      anonymousId: 'test-anonymous-id',
      sessionId: 'test-session-id',
      newRequestId: () => 'test-request-id',
    }),
  };
});

vi.mock('../../src/providers/provider-models', () => ({
  fetchProviderModels: vi.fn(),
}));

vi.mock('../../src/providers/registry', () => ({
  invalidateProjectFilesCache: vi.fn(),
}));

vi.mock('../../src/providers/daemon', () => ({
  fetchVelaLoginStatus: vi.fn(async () => null),
  startVelaLogin: vi.fn(async () => ({ ok: true, alreadyRunning: false })),
  cancelVelaLogin: vi.fn(async () => undefined),
  formatVelaBalanceUsd: (value: string | null | undefined) => value ?? '',
}));

const baseConfig: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  apiProtocol: 'anthropic',
  apiVersion: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  apiProtocolConfigs: {},
  agentId: 'claude',
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
  mediaProviders: {},
  agentModels: {},
  agentCliEnv: {},
};

const amrAgent: AgentInfo = {
  id: 'amr',
  name: 'AMR (vela)',
  bin: 'amr',
  available: true,
  version: '1.0.0',
  models: [
    { id: 'default', label: 'Default' },
  ],
};

const claudeAgent: AgentInfo = {
  id: 'claude',
  name: 'Claude',
  bin: 'claude',
  available: true,
  version: '1.0.0',
  models: [{ id: 'default', label: 'Default' }],
};

const openCodeAgent: AgentInfo = {
  id: 'opencode',
  name: 'OpenCode',
  bin: 'opencode',
  available: true,
  version: '0.4.0',
  models: [{ id: 'default', label: 'Default' }],
};

afterEach(cleanup);

describe('InlineModelSwitcher (Local-First fork amr filter)', () => {
  it('does not render the amr agent in the radio grid even when present in agents', async () => {
    render(
      <InlineModelSwitcher
        config={baseConfig}
        agents={[amrAgent, claudeAgent, openCodeAgent]}
        agentsLoading={false}
        onConfigChange={vi.fn()}
        onSkillChange={vi.fn()}
        onDesignSystemChange={vi.fn()}
        onRefreshAgents={vi.fn()}
      />,
    );

    // The popover chip is closed by default; click to open it.
    const chip = document.querySelector('.inline-switcher__chip');
    expect(chip).not.toBeNull();
    await act(async () => {
      fireEvent.click(chip as HTMLElement);
    });

    // No amr radio button in the grid.
    expect(screen.queryByTestId('inline-model-switcher-agent-amr')).toBeNull();
    expect(screen.queryByTestId('inline-model-switcher-account-amr')).toBeNull();
    // Non-amr agents still present.
    expect(screen.queryByTestId('inline-model-switcher-agent-claude')).not.toBeNull();
    expect(screen.queryByTestId('inline-model-switcher-agent-opencode')).not.toBeNull();
  });

  it('keeps the radio grid clean of the amr reminder marker when amr is present', async () => {
    render(
      <InlineModelSwitcher
        config={baseConfig}
        agents={[amrAgent, claudeAgent]}
        agentsLoading={false}
        onConfigChange={vi.fn()}
        onSkillChange={vi.fn()}
        onDesignSystemChange={vi.fn()}
        onRefreshAgents={vi.fn()}
      />,
    );

    const chip = document.querySelector('.inline-switcher__chip');
    await act(async () => {
      fireEvent.click(chip as HTMLElement);
    });

    // The reminder dot only ever attached to the amr host. With amr hidden,
    // the marker should not appear in the document.
    expect(screen.queryByTestId('inline-model-switcher-agent-amr-reminder')).toBeNull();
    expect(screen.queryByTestId('inline-model-switcher-account-amr-reminder')).toBeNull();
    expect(screen.queryByTestId('inline-model-switcher-account-upgrade')).toBeNull();
    expect(screen.queryByTestId('inline-model-switcher-account-action')).toBeNull();
  });
});

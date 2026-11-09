// @vitest-environment jsdom
/** G16 removed the error-card model-picker/settings actions; the Local-First
 * fork (v0.5) also dropped the Cloud handoff, leaving only support + logs.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { ChatMessage } from '../../src/types';

const translate = (key: string) => key;
vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: translate }),
  useT: () => translate,
}));

afterEach(() => cleanup());

/** 本地运行报模型下线，保留分类，但卡上仅允许固定 Cloud 入口。 */
function modelGoneTurn(): ChatMessage[] {
  return [
    { id: 'user-1', role: 'user', content: 'Build it', createdAt: 0 },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      createdAt: 1,
      endedAt: 2,
      runId: 'run-1',
      runStatus: 'failed',
      agentId: 'claude',
      events: [
        {
          kind: 'status',
          label: 'error',
          detail: 'The selected model is no longer available.',
          code: 'AMR_MODEL_UNAVAILABLE',
        },
      ],
    } as unknown as ChatMessage,
  ];
}

function renderPane(extra: Record<string, unknown>) {
  return render(
    <ChatPane
      projectKindForTracking="prototype"
      messages={modelGoneTurn()}
      streaming={false}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      conversations={[{ id: 'conv-1', title: 'c', createdAt: 0, updatedAt: 0 }] as never}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      projectMetadata={{} as never}
      error={null}
      {...extra}
    />,
  );
}

describe('G16 · model-unavailable card keeps only fixed actions', () => {
  it.each([true, false])('never shows the model picker or Settings (picker wired: %s)', (withPicker) => {
    const { container } = renderPane(withPicker ? { onSwitchModel: vi.fn(), onOpenSettings: vi.fn() } : {});
    const card = screen.getByTestId('chat-run-error-card');
    expect(within(card).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'chat.runError.contactSupportCta', 'chat.runError.exportLogsCta',
    ]);
    expect(container.querySelector('[data-testid="chat-error-switch-model"]')).toBeNull();
  });
});

describe('E3 · 卡上的话不许和按钮的落点打架', () => {
  // The approved model-unavailable text must not resurrect a removed Settings instruction.
  it('no longer sends the reader to Settings in words', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../src/i18n/locales');
    const zh = readFileSync(join(dir, 'zh-CN.ts'), 'utf8');
    const en = readFileSync(join(dir, 'en.ts'), 'utf8');
    const line = (src: string) =>
      src.split('\n').find((l) => l.includes('chat.runError.modelUnavailableMessage')) ?? '';
    expect(line(zh), '中文还在指路设置').not.toMatch(/设置/);
    expect(line(en), 'English still points at Settings').not.toMatch(/Settings/);
  });
});

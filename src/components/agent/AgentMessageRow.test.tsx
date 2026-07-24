import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import AgentMessageRow from './AgentMessageRow';
import type { ChatMessage } from '../../types/chat';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
}));

function renderRow(message: ChatMessage, thinkingBlockAutoExpand = true) {
  cleanup();
  return render(
    <I18nProvider defaultLocale="en-US">
      <AgentMessageRow
        item={{ kind: 'msg', message }}
        thinkingBlockAutoExpand={thinkingBlockAutoExpand}
      />
    </I18nProvider>
  );
}

describe('AgentMessageRow assistant thinking (ChatMessageBubble path)', () => {
  test('expands thinking while actively thinking', () => {
    const { container } = renderRow({
      id: 'a1',
      role: 'assistant',
      text: '',
      thinking: 'planning the fix',
      createdAt: 1,
      isStreaming: true,
      isThinking: true,
    });

    expect(screen.getByTestId('thinking-content').textContent).toContain('planning the fix');
    expect(container.querySelector('[aria-expanded="true"]')).toBeTruthy();
  });

  test('collapses thinking after thinkingEndedAt (same as Chat)', () => {
    const { container } = renderRow({
      id: 'a2',
      role: 'assistant',
      text: 'final answer',
      thinking: 'done planning',
      createdAt: 1,
      isStreaming: true,
      isThinking: false,
      thinkingEndedAt: 100,
      firstContentTime: 100,
    });

    expect(screen.getByText('final answer')).toBeInTheDocument();
    expect(container.querySelector('[aria-expanded="false"]')).toBeTruthy();
  });
});

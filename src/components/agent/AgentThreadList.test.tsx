import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { I18nProvider } from '../../i18n';
import AgentThreadList from './AgentThreadList';
import type { AgentThreadListItem } from './hooks/useAgentThreadManager';

const threads: AgentThreadListItem[] = [
  {
    id: 'thread-1',
    title: 'Auth refactor',
    updatedAt: Date.now() - 3600000,
    preview: 'Review login flow',
    branchName: 'main',
    sessionKey: 'agent-1::thread-1',
    projectPath: 'D:\\test\\project',
  },
  {
    id: 'thread-2',
    title: 'API cleanup',
    updatedAt: Date.now() - 86400000,
    preview: 'Remove legacy endpoints',
    sessionKey: 'agent-1::thread-2',
    projectPath: 'D:\\test\\project',
  },
];

function renderThreadList(overrides: Partial<ComponentProps<typeof AgentThreadList>> = {}) {
  const onSelectThread = vi.fn();
  const onRequestDelete = vi.fn();

  render(
    <I18nProvider defaultLocale="en-US">
      <AgentThreadList
        threads={threads}
        selectedThreadId="thread-1"
        streamingSessionKeys={new Set(['agent-1::thread-1'])}
        renamingThreadId={null}
        renamingTitle=""
        onRenamingTitleChange={vi.fn()}
        onSelectThread={onSelectThread}
        onStartRename={vi.fn()}
        onCommitRename={vi.fn()}
        onCancelRename={vi.fn()}
        onRequestDelete={onRequestDelete}
        {...overrides}
      />
    </I18nProvider>
  );

  return { onSelectThread, onRequestDelete };
}

afterEach(() => {
  cleanup();
});

describe('AgentThreadList', () => {
  test('renders threads with branch and streaming indicator', () => {
    renderThreadList();

    expect(screen.getByTestId('agent-thread-list')).toBeInTheDocument();
    expect(screen.getByText('Auth refactor')).toBeInTheDocument();
    expect(screen.getByText('Review login flow')).toBeInTheDocument();
    expect(screen.getByText(/Branch: main/)).toBeInTheDocument();
    expect(screen.getByTitle('Running')).toBeInTheDocument();
    expect(screen.getByTestId('session-streaming-loader')).toBeInTheDocument();
  });

  test('shows empty state when no threads', () => {
    renderThreadList({ threads: [] });
    expect(screen.getByText('No threads yet')).toBeInTheDocument();
  });

  test('selects thread on main button click', async () => {
    const user = userEvent.setup();
    const { onSelectThread } = renderThreadList();

    await user.click(screen.getByRole('button', { name: /API cleanup/i }));

    expect(onSelectThread).toHaveBeenCalledWith('thread-2');
  });

  test('requests delete for a thread', async () => {
    const user = userEvent.setup();
    const { onRequestDelete } = renderThreadList();

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[1]);

    expect(onRequestDelete).toHaveBeenCalledWith(threads[1]);
  });
});

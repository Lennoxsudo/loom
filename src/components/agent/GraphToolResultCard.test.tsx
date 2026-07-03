import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { formatGraphOutput } from '../../utils/aiTools/handlers/graphHandlers';
import { I18nProvider } from '../../i18n';
import ToolResultMessage from './ToolResultMessage';
import type { ChatMessage } from '../../types/chat';

function renderToolResult(message: ChatMessage) {
  render(
    <I18nProvider defaultLocale="en-US">
      <ToolResultMessage message={message} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('GraphToolResultCard (Agent)', () => {
  test('renders compact graph search summary', () => {
    const text = formatGraphOutput(
      'graph_query',
      'search',
      '{"results":[{"name":"foo","label":"Function","file":"src/lib.ts","line":10,"qualified_name":"mod::foo"}]}',
    );

    renderToolResult({
      id: 'tool-graph-1',
      role: 'tool',
      text,
      createdAt: Date.now(),
      tool_name: 'graph_query',
      tool_args: { action: 'search', query: 'foo' },
    });

    expect(screen.getByText(/search/)).toBeInTheDocument();
    expect(screen.getByText(/1 symbol/)).toBeInTheDocument();
    expect(screen.queryByText('Code graph')).not.toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
  });

  test('expands to show table rows', async () => {
    const user = userEvent.setup();
    const text = formatGraphOutput(
      'graph_query',
      'search',
      '{"results":[{"name":"foo","label":"Function","file":"src/lib.ts","line":10,"qualified_name":"mod::foo"}]}',
    );

    renderToolResult({
      id: 'tool-graph-2',
      role: 'tool',
      text,
      createdAt: Date.now(),
      tool_name: 'graph_query',
      tool_args: { action: 'search' },
    });

    await user.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Function')).toBeInTheDocument();
    expect(screen.getByText('src/lib.ts')).toBeInTheDocument();
  });

  test('renders error state', () => {
    renderToolResult({
      id: 'tool-graph-3',
      role: 'tool',
      text: '### graph_index · index\n\n❌ Index failed',
      createdAt: Date.now(),
      tool_name: 'graph_index',
      tool_args: { action: 'index' },
      isError: true,
    });

    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.queryByText('Code graph')).not.toBeInTheDocument();
  });
});

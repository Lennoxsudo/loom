import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { formatGraphOutput } from '../../features/agent-engine/handlers/graphHandlers';
import { I18nProvider } from '../../i18n';
import GraphToolResultCard from './GraphToolResultCard';
import type { Message } from './types';

function renderChatGraphResult(message: Message) {
  render(
    <I18nProvider defaultLocale="en-US">
      <GraphToolResultCard message={message} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('GraphToolResultCard (Chat)', () => {
  test('renders graph_index status from chat message', () => {
    const text = formatGraphOutput(
      'graph_index',
      'status',
      '{"indexed":true,"node_count":42,"edge_count":10}'
    );

    renderChatGraphResult({
      id: 'chat-graph-1',
      role: 'tool',
      content: text,
      timestamp: Date.now(),
      tool_name: 'graph_index',
      tool_args: { action: 'status' },
    });

    expect(screen.getByText(/status/)).toBeInTheDocument();
    expect(screen.getByText(/Indexed/)).toBeInTheDocument();
    expect(screen.queryByText('Code graph')).not.toBeInTheDocument();
  });

  test('expands snippet code block', async () => {
    const user = userEvent.setup();
    const text = formatGraphOutput(
      'graph_query',
      'snippet',
      '{"code":"fn foo() {}","file":"src/lib.rs","start_line":1,"end_line":1,"qualified_name":"crate::foo"}'
    );

    renderChatGraphResult({
      id: 'chat-graph-2',
      role: 'tool',
      content: text,
      timestamp: Date.now(),
      tool_name: 'graph_query',
      tool_args: { action: 'snippet' },
    });

    await user.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/fn foo\(\)/)).toBeInTheDocument();
    expect(screen.getByText('src/lib.rs')).toBeInTheDocument();
  });
});

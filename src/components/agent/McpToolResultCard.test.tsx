import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import ToolResultMessage from './ToolResultMessage';
import type { ChatMessage } from '../../types/chat';

vi.mock('../../stores/useComposerStore', () => ({
  useComposerStore: () => ({
    currentSession: null,
    sessions: [],
    setVisibility: vi.fn(),
    selectFile: vi.fn(),
    loadSession: vi.fn(),
  }),
}));

function renderToolResult(message: ChatMessage) {
  render(
    <I18nProvider defaultLocale="en-US">
      <ToolResultMessage message={message} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('McpToolResultCard', () => {
  test('renders structured MCP result details', () => {
    renderToolResult({
      id: 'tool-1',
      role: 'tool',
      text: JSON.stringify({
        status: 'ok',
        path: 'src/utils/mcpClient.ts',
        matches: 3,
        files: ['src/utils/mcpClient.ts', 'src/components/ChatPanel.tsx'],
      }),
      createdAt: Date.now(),
      tool_name: 'mcp_filesystem__search_code',
      tool_args: {
        query: 'mcp',
        path: 'src',
      },
    });

    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('Search_code')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText('Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Arguments')).not.toBeInTheDocument();
    expect(screen.queryByText('Raw Output')).not.toBeInTheDocument();
  });

  test('collapses MCP details when header is clicked', async () => {
    const user = userEvent.setup();

    renderToolResult({
      id: 'tool-2',
      role: 'tool',
      text: JSON.stringify({ status: 'ok', total: 2 }),
      createdAt: Date.now(),
      tool_name: 'mcp_browser__list_tabs',
      tool_args: {
        includeInactive: true,
      },
    });

    expect(screen.queryByText('Raw Output')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Arguments')).toBeInTheDocument();
    expect(screen.getByText('Raw Output')).toBeInTheDocument();
  });
});

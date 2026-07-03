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

describe('BrowserToolResultCard', () => {
  test('renders control_browser result with compact summary', () => {
    renderToolResult({
      id: 'tool-1',
      role: 'tool',
      text: '已打开浏览器: https://example.com',
      createdAt: Date.now(),
      tool_name: 'control_browser',
      tool_args: {
        action: 'open',
        url: 'https://example.com',
      },
    });

    expect(screen.getByText(/Open/)).toBeInTheDocument();
    expect(screen.getByText(/example\.com/)).toBeInTheDocument();
    expect(screen.queryByText('BROWSER')).not.toBeInTheDocument();
    expect(screen.queryByText(/Completed/)).not.toBeInTheDocument();
  });

  test('renders fetch result with domain and status code', () => {
    renderToolResult({
      id: 'tool-2',
      role: 'tool',
      text: '来源: https://example.com/api\n状态: 200 OK\n大小: 1234 bytes\n\n---\n{"result": "ok"}',
      createdAt: Date.now(),
      tool_name: 'fetch',
      tool_args: {
        url: 'https://example.com/api',
      },
    });

    expect(screen.getByText(/Fetch/)).toBeInTheDocument();
    expect(screen.getByText(/example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/200/)).toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  test('expands to show meta and body when header is clicked', async () => {
    const user = userEvent.setup();

    renderToolResult({
      id: 'tool-3',
      role: 'tool',
      text: '来源: https://example.com/docs\n状态: 200 OK\n大小: 5678 bytes\n\n---\nHello world content',
      createdAt: Date.now(),
      tool_name: 'fetch_web_content',
      tool_args: {
        url: 'https://example.com/docs',
      },
    });

    await user.click(screen.getByText(/Fetch/));

    expect(screen.getByText(/5678 bytes/)).toBeInTheDocument();
    expect(screen.getByText('Hello world content')).toBeInTheDocument();
  });

  test('shows error marker for failed browser action', () => {
    renderToolResult({
      id: 'tool-4',
      role: 'tool',
      text: '❌ 错误: 无法连接',
      createdAt: Date.now(),
      tool_name: 'control_browser',
      isError: true,
      tool_args: {
        action: 'navigate',
        url: 'http://localhost:9999',
      },
    });

    expect(screen.getByText(/Navigate/)).toBeInTheDocument();
    expect(screen.getByText(/localhost:9999/)).toBeInTheDocument();
    expect(screen.getByText('✘')).toBeInTheDocument();
  });
});

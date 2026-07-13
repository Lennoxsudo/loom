import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import ToolResultMessage from './ToolResultMessage';
import type { ChatMessage } from '../../types/chat';

const openUrl = vi.fn();

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => openUrl(...args),
}));

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
  vi.clearAllMocks();
});

const WEB_SEARCH_TEXT =
  '搜索: "React 19"\n结果: 2（来源: duckduckgo）\n\n' +
  '1. React\n   URL: https://react.dev/\n   摘要: The library for web UIs\n\n' +
  '2. React Blog\n   URL: https://react.dev/blog\n   摘要: Latest updates\n\n' +
  '提示: Use fetch for full page content.';

describe('WebSearchToolResultCard', () => {
  test('renders structured search results', () => {
    renderToolResult({
      id: 'tool-ws-1',
      role: 'tool',
      text: WEB_SEARCH_TEXT,
      createdAt: Date.now(),
      tool_name: 'web_search',
      tool_args: {
        query: 'React 19',
        num_results: 5,
      },
    });

    expect(screen.getByText('Web search')).toBeInTheDocument();
    expect(screen.getByText(/React 19/)).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
    expect(screen.getByText('via duckduckgo')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('The library for web UIs')).toBeInTheDocument();
    expect(screen.getByText(/react\.dev\//)).toBeInTheDocument();
    expect(screen.getByText('Use fetch for full page content.')).toBeInTheDocument();
  });

  test('renders empty state', () => {
    renderToolResult({
      id: 'tool-ws-2',
      role: 'tool',
      text: '搜索: "xyz"\n结果: 0\n\n未找到相关结果。可改用更具体的关键词。',
      createdAt: Date.now(),
      tool_name: 'web_search',
      tool_args: { query: 'xyz' },
    });

    expect(screen.getByText('0 results')).toBeInTheDocument();
    expect(screen.getByText(/未找到相关结果/)).toBeInTheDocument();
  });

  test('renders error state', () => {
    renderToolResult({
      id: 'tool-ws-3',
      role: 'tool',
      text: '搜索失败: network down',
      createdAt: Date.now(),
      tool_name: 'web_search',
      isError: true,
      tool_args: { query: 'test' },
    });

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });

  test('opens URL when result link is clicked', async () => {
    const user = userEvent.setup();
    openUrl.mockResolvedValue(undefined);

    renderToolResult({
      id: 'tool-ws-4',
      role: 'tool',
      text: WEB_SEARCH_TEXT,
      createdAt: Date.now(),
      tool_name: 'web_search',
      tool_args: { query: 'React 19' },
    });

    await user.click(screen.getByText('React'));

    expect(openUrl).toHaveBeenCalledWith('https://react.dev/');
  });

  test('decodes HTML entities in snippets', () => {
    renderToolResult({
      id: 'tool-ws-5',
      role: 'tool',
      text:
        '搜索: "test"\n结果: 1（来源: bing）\n\n' +
        '1. Example\n   URL: https://example.com/\n   摘要: Hello&ensp;world&#0183; snippet',
      createdAt: Date.now(),
      tool_name: 'web_search',
      tool_args: { query: 'test' },
    });

    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
    expect(screen.queryByText(/&ensp;/)).not.toBeInTheDocument();
  });
});

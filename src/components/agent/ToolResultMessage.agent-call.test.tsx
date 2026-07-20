import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import ToolResultMessage from './ToolResultMessage';
import type { ChatMessage } from '../../types/chat';

const { useEnableSubagentsMock } = vi.hoisted(() => ({
  useEnableSubagentsMock: vi.fn(() => true),
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

vi.mock('../../stores', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores')>();
  return {
    ...actual,
    useEnableSubagents: () => useEnableSubagentsMock(),
  };
});

function renderToolResult(message: ChatMessage) {
  return render(
    <I18nProvider defaultLocale="en-US">
      <ToolResultMessage message={message} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
  useEnableSubagentsMock.mockReset();
  useEnableSubagentsMock.mockReturnValue(true);
});

describe('ToolResultMessage agent call rendering', () => {
  test('renders SubagentCard fallback for Agent tool results', () => {
    renderToolResult({
      id: 'tool-agent-1',
      role: 'tool',
      text: 'Reviewed the change and found two issues.',
      createdAt: Date.now(),
      tool_name: 'Agent',
      tool_args: {
        prompt: 'Please review the patch',
        subagent_type: 'review',
      },
    });

    expect(screen.getByText('Subagent')).toBeInTheDocument();
    expect(screen.getByText('review')).toBeInTheDocument();
    expect(screen.getByText('Please review the patch')).toBeInTheDocument();
    expect(screen.queryByText('Reviewed the change and found two issues.')).not.toBeInTheDocument();
  });

  test('renders compact Task summary when subagents are disabled', () => {
    useEnableSubagentsMock.mockReturnValue(false);

    renderToolResult({
      id: 'tool-agent-2',
      role: 'tool',
      text: 'Planning completed.',
      createdAt: Date.now(),
      tool_name: 'Task',
      tool_args: {
        agent_type: 'plan',
      },
    });

    expect(screen.getByTestId('tool-activity-row')).toBeInTheDocument();
    expect(screen.getByText('task')).toBeInTheDocument();
    expect(screen.getByText('plan')).toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    expect(screen.queryByText('Planning completed.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('renders search_both summary with expandable details', () => {
    const text = [
      '文件名匹配 (3 个):',
      '- src/auth.ts',
      '',
      '---',
      '',
      '找到 2 个文件包含 "auth":',
      '',
      '📄 src/auth.ts',
    ].join('\n');

    renderToolResult({
      id: 'tool-search-both-1',
      role: 'tool',
      text,
      createdAt: Date.now(),
      tool_name: 'search_both',
      tool_args: { query: 'auth' },
    });

    expect(screen.getByText('grep')).toBeInTheDocument();
    expect(screen.getAllByText(/"auth"/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/3 files/)).toBeInTheDocument();
    expect(screen.getByText(/2 places/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText(/src\/auth\.ts/).length).toBeGreaterThanOrEqual(1);
  });

  test('renders search_both no matches without error marker', () => {
    const { container } = renderToolResult({
      id: 'tool-search-both-2',
      role: 'tool',
      text: '未找到匹配 "missing" 的文件或内容',
      createdAt: Date.now(),
      tool_name: 'search_both',
      tool_args: { query: 'missing' },
    });

    expect(screen.getByText('grep')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('✘')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="isError"]')).toBeNull();
  });

  test('renders list_bg_tasks summary and expands task commands', () => {
    const text = [
      'Background tasks:',
      '- bg-1: "npm run dev" [running pid=1234]',
      '- bg-2: "sleep 10" [completed exit=0 1200ms] pid=5678',
    ].join('\n');

    renderToolResult({
      id: 'tool-list-bg-1',
      role: 'tool',
      text,
      createdAt: Date.now(),
      tool_name: 'list_bg_tasks',
    });

    expect(screen.getByText('bg')).toBeInTheDocument();
    expect(screen.getByText('tasks')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1 run')).toBeInTheDocument();
    expect(screen.getByText('1 done')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/npm run dev/)).toBeInTheDocument();
  });

  test('renders empty list_bg_tasks as none', () => {
    renderToolResult({
      id: 'tool-list-bg-2',
      role: 'tool',
      text: 'No background tasks.',
      createdAt: Date.now(),
      tool_name: 'list_bg_tasks',
    });

    expect(screen.getByText(/none/)).toBeInTheDocument();
  });

  test('renders kill_bg_task success with kill verb', () => {
    renderToolResult({
      id: 'tool-kill-bg-1',
      role: 'tool',
      text: 'Background task abc123longtaskid has been terminated.',
      createdAt: Date.now(),
      tool_name: 'kill_bg_task',
      tool_args: { terminal_id: 'abc123longtaskid' },
    });

    expect(screen.getByText('kill')).toBeInTheDocument();
    expect(screen.getByText(/abc123longtaski/)).toBeInTheDocument();
    expect(screen.getByText(/terminated/)).toBeInTheDocument();
    expect(screen.queryByText('✘')).not.toBeInTheDocument();
  });

  test('renders kill_bg_task failure marker', () => {
    const { container } = renderToolResult({
      id: 'tool-kill-bg-2',
      role: 'tool',
      text: '错误: No terminal_id (tid) specified.',
      createdAt: Date.now(),
      tool_name: 'kill_bg_task',
      tool_args: {},
      isError: true,
    });

    expect(screen.getByText('kill')).toBeInTheDocument();
    expect(container.querySelector('[class*="isError"]')).not.toBeNull();
    expect(screen.queryByText('✘')).not.toBeInTheDocument();
  });

  test('renders sym success without false error when definition code contains "failed"', () => {
    const { container } = renderToolResult({
      id: 'tool-sym-1',
      role: 'tool',
      text: [
        '## 符号定义: useImageLoader',
        '',
        '**定义文件**: src/hooks/useImageLoader.ts:12',
        '**定义类型**: function',
        '**导入来源**: (current file)',
        '',
        '### 定义代码',
        '',
        '```typescript',
        'export function useImageLoader() {',
        '  const [state, setState] = useState<ImageLoadState>("failed");',
        '  if (error) console.error("error:", error);',
        '  return state;',
        '}',
        '```',
      ].join('\n'),
      createdAt: Date.now(),
      tool_name: 'sym',
      tool_args: { symbol_name: 'useImageLoader', file_path: 'src/App.tsx' },
      isError: false,
    });

    expect(screen.getByText(/useImageLoader/)).toBeInTheDocument();
    expect(screen.getByText('sym')).toBeInTheDocument();
    expect(screen.queryByText('❌')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="isError"]')).toBeNull();
  });

  test('renders sym failure marker when isError is true', () => {
    const { container } = renderToolResult({
      id: 'tool-sym-2',
      role: 'tool',
      text: '查找符号定义失败: Symbol not found',
      createdAt: Date.now(),
      tool_name: 'sym',
      tool_args: { symbol_name: 'MissingSymbol', file_path: 'src/App.tsx' },
      isError: true,
    });

    expect(screen.getByText(/MissingSymbol/)).toBeInTheDocument();
    expect(screen.getByText('sym')).toBeInTheDocument();
    expect(container.querySelector('[class*="isError"]')).not.toBeNull();
    expect(screen.queryByText('❌')).not.toBeInTheDocument();
  });

  test('renders TodoWrite as in-progress summary and expandable hidden sections', () => {
    renderToolResult({
      id: 'tool-todo-1',
      role: 'tool',
      text: 'Todo list updated.',
      createdAt: Date.now(),
      tool_name: 'todo',
      tool_args: {
        todos: [
          { content: 'pending task a', status: 'pending' },
          { content: 'pending task b', status: 'pending' },
          { content: 'active task c', status: 'in_progress' },
          { content: 'done task d', status: 'completed' },
        ],
      },
    });

    expect(screen.getByText('active task c')).toBeInTheDocument();
    expect(screen.getByTestId('todo-in-progress-indicator')).toBeInTheDocument();
    // hidden sections stay mounted for expand animation
    expect(screen.getByText('pending task a')).toBeInTheDocument();
    expect(screen.getByText('done task d')).toBeInTheDocument();
    expect(screen.getByTestId('todo-expand-toggle').closest('[aria-hidden]')
      || screen.getByTestId('todo-expand-toggle').parentElement?.querySelector('[aria-hidden]')).toBeTruthy();

    fireEvent.click(screen.getByTestId('todo-expand-toggle'));
    expect(screen.getByText('pending task a')).toBeInTheDocument();
    expect(screen.getByText('done task d')).toBeInTheDocument();
  });

  test('renders search_both in dense mode for chat path', () => {
    render(
      <I18nProvider defaultLocale="en-US">
        <ToolResultMessage
          dense
          message={{
            id: 'tool-search-both-dense',
            role: 'tool',
            text: '未找到匹配 "x" 的文件或内容',
            createdAt: Date.now(),
            tool_name: 'search_both',
            tool_args: { query: 'x' },
          }}
        />
      </I18nProvider>
    );

    expect(screen.getByText('grep')).toBeInTheDocument();
    expect(screen.getByText(/"x"/)).toBeInTheDocument();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { I18nProvider } from '../../i18n';
import SubagentCard from './SubagentCard';
import { useSubagentStore } from '../../stores/useSubagentStore';

function renderSubagentCard(taskId: string) {
  render(
    <I18nProvider defaultLocale="zh-CN">
      <SubagentCard taskId={taskId} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
  useSubagentStore.setState({ runs: {} });
});

describe('SubagentCard Component', () => {
  test('renders loading/initializing state if run is not found in store', () => {
    renderSubagentCard('nonexistent-task');
    expect(screen.getByText(/初始化子代理状态中|Initializing/)).toBeInTheDocument();
  });

  test('renders subagent task details, status, and summary when finished', async () => {
    const taskId = 'test-sub-1';
    useSubagentStore.setState({
      runs: {
        [taskId]: {
          task: {
            id: taskId,
            description: 'Refactor authentication flow',
          },
          status: 'succeeded',
          steps: 4,
          startedAt: Date.now() - 5000,
          finishedAt: Date.now(),
          result: {
            taskId,
            status: 'succeeded',
            summary: 'Auth flow successfully refactored and verified.',
          },
        },
      },
    });

    renderSubagentCard(taskId);

    // Verify title and steps count
    expect(screen.getByText('Refactor authentication flow')).toBeInTheDocument();
    expect(screen.getByText('4 步')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();

    // The summary should not be immediately visible because it is in the collapsible body (collapsed by default)
    expect(screen.queryByText('最终摘要')).not.toBeInTheDocument();
    expect(screen.queryByText('Auth flow successfully refactored and verified.')).not.toBeInTheDocument();

    // Click to expand
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));

    // Verify expanded details
    expect(screen.getByText('最终摘要')).toBeInTheDocument();
    expect(screen.getByText('Auth flow successfully refactored and verified.')).toBeInTheDocument();
  });

  test('renders subagent thinking, tool events and streaming output when running', async () => {
    const taskId = 'test-sub-2';
    useSubagentStore.setState({
      runs: {
        [taskId]: {
          task: {
            id: taskId,
            description: 'Compile and build project',
          },
          status: 'running',
          steps: 1,
          startedAt: Date.now(),
          streamingText: 'Building files in progress...',
          thinkingText: 'Let me think how to build this.',
          timeline: [
            {
              kind: 'thinking',
              id: 'think-1',
              text: 'Let me think how to build this.',
            },
            {
              kind: 'tool',
              id: 'tool-call-1',
              toolName: 'term',
              status: 'done',
              resultPreview: 'npm run build output: successful',
            },
          ],
          toolEvents: [
            {
              id: 'tool-call-1',
              toolName: 'term',
              status: 'done',
              resultPreview: 'npm run build output: successful',
              at: Date.now(),
            },
          ],
        },
      },
    });

    renderSubagentCard(taskId);

    expect(screen.getByText('Compile and build project')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();

    // Expand card – click the header toggle (first button)
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button')[0]);

    // Interleaved timeline: thinking then tool
    expect(screen.getByText('思考')).toBeInTheDocument();
    expect(screen.getByText('Let me think how to build this.')).toBeInTheDocument();
    expect(screen.getByText('Term')).toBeInTheDocument();
    expect(screen.getByText('npm run build output: successful')).toBeInTheDocument();
    expect(screen.getByText('实时输出')).toBeInTheDocument();
    expect(screen.getByText('Building files in progress...')).toBeInTheDocument();
  });
});

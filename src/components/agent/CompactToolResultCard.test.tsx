import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { I18nProvider } from '../../i18n';
import ToolResultMessage from './ToolResultMessage';
import type { ChatMessage } from '../../types/chat';
import { parsePlanToolOutput } from './compactToolResult';

function renderToolResult(message: ChatMessage) {
  render(
    <I18nProvider defaultLocale="zh-CN">
      <ToolResultMessage message={message} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('parsePlanToolOutput', () => {
  test('extracts plan metadata', () => {
    const meta = parsePlanToolOutput(
      'Plan document updated in the editable plan panel.\n' +
      'Title: React 19 changelog\n' +
      'Length: 1200 chars\n' +
      'Continue researching, call update_plan again to revise, or call exit_plan_mode when ready for user review.',
    );

    expect(meta?.title).toBe('React 19 changelog');
    expect(meta?.length).toBe('1200 chars');
  });
});

describe('CompactToolResultCard', () => {
  test('renders update_plan with localized label and no left accent bar', () => {
    renderToolResult({
      id: 'tool-plan-1',
      role: 'tool',
      text:
        'Plan document updated in the editable plan panel.\n' +
        'Title: React 19 changelog\n' +
        'Length: 1200 chars\n' +
        'Continue researching, call update_plan again to revise, or call exit_plan_mode when ready for user review.',
      createdAt: Date.now(),
      tool_name: 'update_plan',
    });

    expect(screen.getByText('更新计划')).toBeInTheDocument();
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.getByText('React 19 changelog')).toBeInTheDocument();
    expect(screen.queryByText(/✔/)).not.toBeInTheDocument();
  });

  test('expands structured plan output', async () => {
    const user = userEvent.setup();

    renderToolResult({
      id: 'tool-plan-2',
      role: 'tool',
      text:
        'Plan document updated in the editable plan panel.\n' +
        'Title: Demo plan\n' +
        'Length: 42 chars\n' +
        'Continue researching, call update_plan again to revise, or call exit_plan_mode when ready for user review.',
      createdAt: Date.now(),
      tool_name: 'update_plan',
    });

    await user.click(screen.getByText('更新计划'));

    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getAllByText('Demo plan').length).toBeGreaterThan(0);
    expect(screen.getByText('42 chars')).toBeInTheDocument();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import ChatMessageBubble from './ChatMessageBubble';
import type { Message } from './types';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
}));

function renderBubble(
  message: Message,
  overrides: Partial<React.ComponentProps<typeof ChatMessageBubble>> = {}
) {
  cleanup();
  return render(
    <I18nProvider defaultLocale="en-US">
      <ChatMessageBubble message={message} {...overrides} />
    </I18nProvider>
  );
}

describe('ChatMessageBubble', () => {
  test('does not render leaked thinking content or closing think tags in normal chat content', () => {
    renderBubble({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Visible final answer',
      thinking: 'existing reasoning\n\nhidden reasoning tail',
      timestamp: Date.now(),
      isStreaming: false,
    });

    expect(screen.getByText('Visible final answer')).toBeInTheDocument();
    expect(screen.queryByText((text) => text.includes('</think>'))).not.toBeInTheDocument();
    expect(
      screen.queryByText('hidden reasoning tail</think>Visible final answer')
    ).not.toBeInTheDocument();
  });

  test('renders attached file names for path-only file references', () => {
    renderBubble({
      id: 'user-1',
      role: 'user',
      content:
        '# File Context\n\n- test-example.ts (`D:/project/test-example.ts`)\n- main.ts (`D:/project/src/main.ts`)\n---\n\nPlease update these files.',
      timestamp: Date.now(),
      isStreaming: false,
    });

    expect(screen.getByText('test-example.ts')).toBeInTheDocument();
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('Please update these files.')).toBeInTheDocument();
  });

  test('separates final answer text from thinking field when normal chat thinking contains both', () => {
    renderBubble({
      id: 'assistant-2',
      role: 'assistant',
      content:
        '已在文件末尾新增了一个 `power`函数，用于计算幂运算。修改内容如下：\n```diff\n+export function power(base: number, exponent: number): number {\n+  return Math.pow(base, exponent);\n+}\n```',
      thinking:
        "I added a new function `power` to the file. Let me confirm the change was applied correctly.",
      timestamp: Date.now(),
      isStreaming: false,
      thinkingEndedAt: Date.now(),
    });

    expect(screen.getByText(/I added a new function/i)).toBeInTheDocument();
    expect(screen.getByText(/已在文件末尾新增了一个/)).toBeInTheDocument();
    expect(screen.queryByText(/I added a new function[\s\S]*已在文件末尾新增了一个/)).not.toBeInTheDocument();
  });

  test('moves leaked markdown result content out of thinking even when assistant text already exists', () => {
    renderBubble({
      id: 'assistant-4',
      role: 'assistant',
      content:
        '已在文件末尾新增了一个 `power`函数，用于计算幂运算。\n\n**测试结果：**\n\n|操作|结果|\n|---|---|\n|创建任务列表|成功|',
      thinking:
        'I added a new function `power` to the file. Let me confirm the change was applied correctly.',
      timestamp: Date.now(),
      isStreaming: false,
      thinkingEndedAt: Date.now(),
    });

    expect(
      screen.getByText(/I added a new function `power` to the file\. Let me confirm the change was applied correctly\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/已在文件末尾新增了一个/)).toBeInTheDocument();
    expect(screen.queryByText(/Let me confirm[\s\S]*测试结果/)).not.toBeInTheDocument();
  });

  test('trusts data-layer separation for non-streaming assistant messages', () => {
    const { container } = renderBubble({
      id: 'assistant-trusted-done',
      role: 'assistant',
      content: '这是项目总结正文，包含最后一段结论。',
      thinking: '让我先分析项目结构和依赖关系。',
      timestamp: Date.now(),
      isStreaming: false,
      thinkingEndedAt: Date.now(),
    });

    expect(screen.getByText(/让我先分析项目结构和依赖关系/)).toBeInTheDocument();
    expect(screen.getByText(/这是项目总结正文，包含最后一段结论/)).toBeInTheDocument();

    const thinkingBlock = container.querySelector('[data-testid="thinking-block"]');
    expect(thinkingBlock?.textContent).toContain('让我先分析项目结构和依赖关系');
    expect(thinkingBlock?.textContent).not.toContain('这是项目总结正文');
  });

  test('trusts data-layer separation while streaming without re-splitting content', () => {
    const { container } = renderBubble({
      id: 'assistant-trusted-stream',
      role: 'assistant',
      content: '总结：这是一个基于 Tauri 的桌面编辑器项目。',
      thinking: '正在检索 README 与 package.json…',
      timestamp: Date.now(),
      isStreaming: true,
      isThinking: false,
      thinkingEndedAt: Date.now() - 1,
    });

    expect(screen.getByText(/正在检索 README 与 package\.json/)).toBeInTheDocument();
    expect(screen.getByText(/总结：这是一个基于 Tauri 的桌面编辑器项目/)).toBeInTheDocument();

    const thinkingBlock = container.querySelector('[data-testid="thinking-block"]');
    expect(thinkingBlock?.textContent).toContain('正在检索 README');
    expect(thinkingBlock?.textContent).not.toContain('总结：这是一个基于 Tauri');
  });

  test('keeps code blocks inside thinking intact when data layer already separated fields', () => {
    renderBubble({
      id: 'assistant-thinking-code',
      role: 'assistant',
      content: '已在文件末尾新增函数，详见正文。',
      thinking: '示例实现：\n```ts\nexport function power(a: number, b: number) {\n  return a ** b;\n}\n```',
      timestamp: Date.now(),
      isStreaming: false,
      thinkingEndedAt: Date.now(),
    });

    expect(screen.getByText(/export function power/)).toBeInTheDocument();
    expect(screen.getByText(/已在文件末尾新增函数/)).toBeInTheDocument();
    expect(screen.queryByText(/export function power[\s\S]*已在文件末尾新增函数/)).not.toBeInTheDocument();
  });

  test('shows edit button and resends edited user text', async () => {
    const user = userEvent.setup();
    const onResend = vi.fn().mockResolvedValue(undefined);
    renderBubble(
      {
        id: 'user-edit-1',
        role: 'user',
        content: 'original task',
        timestamp: Date.now(),
      },
      { onResendFromUserMessage: onResend }
    );

    expect(screen.getByText('original task')).toBeInTheDocument();
    await user.hover(screen.getByText('original task'));
    await user.click(screen.getByTestId('user-message-edit'));
    const input = screen.getByTestId('user-message-edit-input');
    await user.clear(input);
    await user.type(input, 'revised task');
    await user.click(screen.getByTestId('user-message-resend'));

    expect(onResend).toHaveBeenCalledWith('user-edit-1', 'revised task');
  });

  test('hides edit button when editDisabled', () => {
    renderBubble(
      {
        id: 'user-edit-2',
        role: 'user',
        content: 'cannot edit now',
        timestamp: Date.now(),
      },
      { onResendFromUserMessage: vi.fn(), editDisabled: true }
    );

    expect(screen.queryByTestId('user-message-edit')).not.toBeInTheDocument();
  });

  test('normalizes malformed assistant markdown with inline code-like blocks and prose text fences', () => {
    const { container } = renderBubble({
      id: 'assistant-3',
      role: 'assistant',
      content:
        '已经完成！在文件末尾新增了一个 `factorial`（阶乘）函数：`typescript export function factorial(n: number): number { if (n < 0) { throw new Error("阶乘不支持负数"); } if (n === 0 || n === 1) { return 1; } return n * factorial(n - 1); }`\n```text\n这个函数通过递归实现了阶乘计算，并包含了对负数输入的校验。\n```',
      timestamp: Date.now(),
      isStreaming: false,
    });

    expect(screen.getByText(/已经完成！在文件末尾新增了一个/)).toBeInTheDocument();
    expect(container.textContent).toContain('export function factorial');
    expect(
      screen.getByText(/这个函数通过递归实现了阶乘计算，并包含了对负数输入的校验/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/^text$/)).not.toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import {
  trimMessagesToFit,
  TRIM_PLACEHOLDER,
  HARD_TRUNC_SUFFIX,
  repairTrimmedToolChain,
  truncateTextToTokenBudget,
  estimateTokens,
  estimateMessageTokens,
  applyContextBudget,
} from './contextBudget';

// Because we're isolating tests for the trimming logic, we'll cast to the internal expected struct.
type AnyMessage = { role: string; content: string; tool_calls?: any[]; tool_call_id?: string };

describe('Context Budget & Truncation (Regression Tests)', () => {
  it('Task 2 Regression: should generate pure placeholder without inheritance to avoid 400 API errors', () => {
    // 模拟一段含 tool_calls 的巨量历史，使其触发截断
    const fakeLongContent = 'A'.repeat(80000); // 制造超长假数据以超越默认预算
    const messages: AnyMessage[] = [
      { role: 'system', content: 'You are an AI.' },
      { role: 'user', content: 'Hello' },
      { 
        role: 'assistant', 
        content: fakeLongContent, 
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }]
      },
      { role: 'user', content: 'What about tomorrow?' }
    ];

    // budget 故意设小，迫使其截去中间片段（包括带有 tool_calls 的那条 assistant 消息）
    const trimmed = trimMessagesToFit(messages, 100, 0);

    // 首先断言是否截取成功，以及截取后的结构
    expect(trimmed.some((m) => typeof m.content === 'string' && m.content.includes(TRIM_PLACEHOLDER))).toBe(true);
    
    // 寻找截断生成的 placeholder 占位消息
    const placeholderMsg = trimmed.find(m => typeof m.content === 'string' && m.content.includes(TRIM_PLACEHOLDER));
    expect(placeholderMsg).toBeDefined();

    // 回归：占位符必须是绝对纯净的 user，不应含 tool_calls 或 tool_call_id
    expect(placeholderMsg?.role).toBe('user');
    expect(placeholderMsg).not.toHaveProperty('tool_calls');
    expect(placeholderMsg).not.toHaveProperty('tool_call_id');
  });

  it('Task 3 Regression: should survive extreme truncation constraints without crashing and fallback to hard trim', () => {
    // 模拟极致预算冲突：将受保护的区段 (first + last 两轮) 本身的长度拉到远超 budget 的程度
    const giantSystemPrompt = 'B'.repeat(10000); // system 永远受保护
    const giantLastMessage = 'C'.repeat(10000);  // 尾部消息在 trim 中受保护
    
    const messages: AnyMessage[] = [
      { role: 'system', content: giantSystemPrompt },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: giantLastMessage }
    ];

    // 令预算只有可怜的 100 tokens (约300字符)，远远装不下 20000 字符的保护区
    // 断言不会抛出由于切片越界或者死循环引发的崩溃
    const trimmed = trimMessagesToFit(messages, 100, 1);

    // 断言由于触发了终极兜底 (Hard Truncation)，消息总和理应符合预期截取
    expect(trimmed.length).toBeGreaterThanOrEqual(1);

    // 此时原本受保护导致必定越界的 huge 字符串，应当被执行了字符串截取
    const remainingText = JSON.stringify(trimmed);
    expect(remainingText.length).toBeLessThan(15000);
    expect(remainingText).toContain('[HARD TRUNCATED]');
  });

  it('Aggressive trim: drops orphan Anthropic tool_result tail without prior tool_use', () => {
    const giant = 'X'.repeat(50000);
    const messages = [
      { role: 'system', content: 'You are an AI.' },
      { role: 'user', content: giant },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'orphan_call', content: giant }],
      },
    ];

    const trimmed = trimMessagesToFit(messages, 50, 2);
    const hasOrphanToolResult = trimmed.some((m) => {
      if (m.role !== 'user' || !Array.isArray(m.content)) return false;
      return (m.content as Array<{ type?: string; tool_use_id?: string }>).some(
        (b) => b.type === 'tool_result' && b.tool_use_id === 'orphan_call',
      );
    });

    expect(hasOrphanToolResult).toBe(false);
    const last = trimmed[trimmed.length - 1];
    if (last.role === 'user' && Array.isArray(last.content)) {
      expect(
        (last.content as Array<{ type?: string }>).every((b) => b.type !== 'tool_result'),
      ).toBe(true);
    }
  });

  it('repairTrimmedToolChain: supplements missing tool_result for retained assistant tool_use', () => {
    const repaired = repairTrimmedToolChain([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'read', input: {} }],
      },
    ]);

    expect(repaired).toHaveLength(3);
    expect(repaired[2].role).toBe('user');
    expect(repaired[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: '操作已取消' },
    ]);
  });

  it('repairTrimmedToolChain: drops orphan OpenAI tool message', () => {
    const repaired = repairTrimmedToolChain([
      { role: 'user', content: 'hi' },
      { role: 'tool', content: 'orphan output', tool_call_id: 'missing_call' },
    ]);

    expect(repaired).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

describe('truncateTextToTokenBudget', () => {
  it('truncates pure CJK text within maxTokens', () => {
    const text = '中'.repeat(20000);
    const maxTokens = 100;
    const result = truncateTextToTokenBudget(text, maxTokens);

    expect(estimateTokens(result)).toBeLessThanOrEqual(maxTokens);
    expect(result.length).toBeLessThan(text.length);
  });

  it('truncates pure ASCII text within maxTokens', () => {
    const text = 'A'.repeat(20000);
    const maxTokens = 100;
    const result = truncateTextToTokenBudget(text, maxTokens);

    expect(estimateTokens(result)).toBeLessThanOrEqual(maxTokens);
    expect(result.length).toBeLessThan(text.length);
  });

  it('truncates mixed CJK and ASCII text within maxTokens', () => {
    const text = '中文'.repeat(5000) + 'English '.repeat(3000);
    const maxTokens = 150;
    const result = truncateTextToTokenBudget(text, maxTokens, '...suffix');

    expect(estimateTokens(result)).toBeLessThanOrEqual(maxTokens);
    expect(result.endsWith('...suffix')).toBe(true);
  });
});

describe('trimMessagesToFit hard truncation (CJK)', () => {
  it('keeps total message tokens within budget for Chinese-heavy system prompt', () => {
    const budgetTokens = 100;
    const messages: AnyMessage[] = [
      { role: 'system', content: '中'.repeat(20000) },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '好的' },
    ];

    const trimmed = trimMessagesToFit(messages, budgetTokens, 1);
    const totalTokens = trimmed.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

    expect(totalTokens).toBeLessThanOrEqual(budgetTokens);
    expect(JSON.stringify(trimmed)).toContain(HARD_TRUNC_SUFFIX);
  });
});

describe('applyContextBudget trim toolchain repair', () => {
  it('should repair trimmed tool chain when over budget', () => {
    const messages = [
      { role: 'system', content: 'You are an AI.' },
      { role: 'user', content: 'Long request ' + 'A'.repeat(5000) },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'read_file', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'File contents' }],
      },
      { role: 'assistant', content: 'Here is the file content.' },
      { role: 'user', content: 'Great, thanks!' },
      { role: 'assistant', content: 'You are welcome!' },
    ];

    const result = applyContextBudget(
      messages,
      'claude-3-5-sonnet',
      undefined,
      0, // reserveTokens
      1000, // maxContextTokens
    );

    // Check if the orphan tool_result has been removed
    const hasOrphanToolResult = result.messages.some((m) => {
      if (m.role !== 'user' || !Array.isArray(m.content)) return false;
      return (m.content as Array<{ type?: string; tool_use_id?: string }>).some(
        (b) => b.type === 'tool_result' && b.tool_use_id === 'call_1',
      );
    });

    expect(hasOrphanToolResult).toBe(false);
  });
});

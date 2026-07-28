import { describe, it, expect } from 'vitest';
import {
  TOOL_RESULT_AGED_SUFFIX,
  agePersistedChatToolMessages,
  agePersistedProviderToolMessages,
  agePersistedToolText,
  isAgedToolResultText,
} from '../toolResultAging';

// 超过 TOOL_RESULT_SUMMARY_MAX_CHARS (500) 的长文本
const LONG = 'y'.repeat(2000);

/** user/tool 交替的 8 条消息（4 条 tool 结果，text 字段） */
function buildChatMessages(long = LONG) {
  return [
    { role: 'user', text: 'q1' },
    { role: 'tool', text: long },
    { role: 'user', text: 'q2' },
    { role: 'tool', text: long },
    { role: 'user', text: 'q3' },
    { role: 'tool', text: long },
    { role: 'user', text: 'q4' },
    { role: 'tool', text: long },
  ];
}

describe('toolResultAging', () => {
  it('ages long tool text with a stable suffix', () => {
    const aged = agePersistedToolText(LONG);
    expect(aged.length).toBeLessThan(LONG.length);
    expect(isAgedToolResultText(aged)).toBe(true);
    expect(aged.endsWith(TOOL_RESULT_AGED_SUFFIX)).toBe(true);
  });

  it('does not re-age already aged tool text', () => {
    const once = agePersistedToolText(LONG);
    const twice = agePersistedToolText(once);
    expect(twice).toBe(once);
  });

  it('recognizes the legacy aged suffix from persisted sessions', () => {
    const legacyAged = 'x'.repeat(200) + '... [tool result aged to save context]';
    expect(isAgedToolResultText(legacyAged)).toBe(true);
    // 幂等：旧格式不会被二次老化
    expect(agePersistedToolText(legacyAged)).toBe(legacyAged);
  });

  it('does NOT age anything when context pressure is low', () => {
    const messages = buildChatMessages();
    // 默认 200K 窗口，约 2.3K token 的会话远低于 60% 阈值
    const { messages: result, changed } = agePersistedChatToolMessages(messages, 3);
    expect(changed).toBe(false);
    expect(result).toBe(messages);
    expect(result[1].text).toBe(LONG);
  });

  it('ages older tool messages under pressure and keeps recent tail raw', () => {
    const messages = buildChatMessages();
    // 窗口 1000 → 阈值 600，总量 ~2.3K 触发老化
    const first = agePersistedChatToolMessages(messages, 3, 1000);
    expect(first.changed).toBe(true);
    expect(first.messages[1].text).toContain(TOOL_RESULT_AGED_SUFFIX);
    // 最近 3 条工具结果保持原文
    expect(first.messages[3].text).toBe(LONG);
    expect(first.messages[5].text).toBe(LONG);
    expect(first.messages[7].text).toBe(LONG);

    // 幂等：再次老化不产生变化
    const second = agePersistedChatToolMessages(first.messages, 3, 1000);
    expect(second.changed).toBe(false);
    expect(second.messages).toBe(first.messages);
  });

  it('ages oldest-first and stops once usage drops below threshold', () => {
    const messages = buildChatMessages();
    // 窗口 2700 → 阈值 1620；老化前两条后估算降至阈值以下，第三条候选保持原文
    const { messages: aged, changed } = agePersistedChatToolMessages(messages, 1, 2700);
    expect(changed).toBe(true);
    expect(aged[1].text).toContain(TOOL_RESULT_AGED_SUFFIX);
    expect(aged[3].text).toContain(TOOL_RESULT_AGED_SUFFIX);
    expect(aged[5].text).toBe(LONG);
    expect(aged[7].text).toBe(LONG);
  });

  it('supports chat panel messages that store tool output in content', () => {
    const long = 'z'.repeat(2000);
    const messages = [
      { role: 'user', content: 'q1' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q2' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q3' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q4' },
      { role: 'tool', content: long },
    ];

    const { messages: aged, changed } = agePersistedChatToolMessages(messages, 3, 1000);
    expect(changed).toBe(true);
    expect(aged[1].content).toContain(TOOL_RESULT_AGED_SUFFIX);
    expect(aged[7].content).toBe(long);
  });

  it('ages provider-format tool messages for runAgentLoop compatibility', () => {
    const long = 'p'.repeat(2000);
    const messages = [
      { role: 'user', content: 'q1' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q2' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q3' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q4' },
      { role: 'tool', content: long },
    ];

    const aged = agePersistedProviderToolMessages(messages, 3, 1000);
    expect((aged[1] as { content: string }).content).toContain(TOOL_RESULT_AGED_SUFFIX);
    expect((aged[7] as { content: string }).content).toBe(long);
  });

  it('provider-format aging is a no-op under low pressure', () => {
    const long = 'p'.repeat(2000);
    const messages = [
      { role: 'user', content: 'q1' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q2' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q3' },
      { role: 'tool', content: long },
      { role: 'user', content: 'q4' },
      { role: 'tool', content: long },
    ];

    const result = agePersistedProviderToolMessages(messages, 3);
    expect(result).toBe(messages);
  });
});

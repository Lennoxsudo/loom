import { describe, it, expect } from 'vitest';
import {
  TOOL_RESULT_AGED_SUFFIX,
  agePersistedChatToolMessages,
  agePersistedProviderToolMessages,
  agePersistedToolText,
  isAgedToolResultText,
} from '../toolResultAging';

describe('toolResultAging', () => {
  it('ages long tool text with a stable suffix', () => {
    const long = 'x'.repeat(500);
    const aged = agePersistedToolText(long);
    expect(aged.length).toBeLessThan(long.length);
    expect(isAgedToolResultText(aged)).toBe(true);
    expect(aged.endsWith(TOOL_RESULT_AGED_SUFFIX)).toBe(true);
  });

  it('does not re-age already aged tool text', () => {
    const long = 'x'.repeat(500);
    const once = agePersistedToolText(long);
    const twice = agePersistedToolText(once);
    expect(twice).toBe(once);
  });

  it('ages older persisted chat tool messages and keeps recent tail raw', () => {
    const long = 'y'.repeat(500);
    const messages = [
      { role: 'user', text: 'q1' },
      { role: 'tool', text: long },
      { role: 'user', text: 'q2' },
      { role: 'tool', text: long },
      { role: 'user', text: 'q3' },
      { role: 'tool', text: long },
      { role: 'user', text: 'q4' },
      { role: 'tool', text: long },
    ];

    const first = agePersistedChatToolMessages(messages, 3);
    expect(first.changed).toBe(true);
    expect(first.messages[1].text).toContain(TOOL_RESULT_AGED_SUFFIX);
    expect(first.messages[7].text).toBe(long);

    const second = agePersistedChatToolMessages(first.messages, 3);
    expect(second.changed).toBe(false);
    expect(second.messages[1].text).toBe(first.messages[1].text);
  });

  it('supports chat panel messages that store tool output in content', () => {
    const long = 'z'.repeat(500);
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

    const { messages: aged, changed } = agePersistedChatToolMessages(messages, 3);
    expect(changed).toBe(true);
    expect(aged[1].content).toContain(TOOL_RESULT_AGED_SUFFIX);
    expect(aged[7].content).toBe(long);
  });

  it('ages provider-format tool messages for runAgentLoop compatibility', () => {
    const long = 'p'.repeat(500);
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

    const aged = agePersistedProviderToolMessages(messages, 3);
    expect((aged[1] as { content: string }).content).toContain(TOOL_RESULT_AGED_SUFFIX);
    expect((aged[7] as { content: string }).content).toBe(long);
  });
});

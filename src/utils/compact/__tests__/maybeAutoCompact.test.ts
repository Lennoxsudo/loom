import { describe, it, expect, vi } from 'vitest';
import type { CompactableMessage } from '../types';

vi.mock('../compactConversation', () => ({
  compactConversation: vi.fn(async () => ({ compacted: false, messages: [] })),
}));

import { maybeAutoCompactConversation } from '../index';
import { compactConversation } from '../compactConversation';

// maxContextTokens=100 / reserveTokens=0 时阈值仅 90 token，以下消息必然超阈值
const overThresholdMessages: CompactableMessage[] = Array.from({ length: 12 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? 'user' : 'assistant',
  text: 'x'.repeat(400),
}));

describe('maybeAutoCompactConversation skipCompact', () => {
  it('skipCompact 时不触发压缩（UI 只读路径不产生付费 LLM 摘要调用）', async () => {
    vi.mocked(compactConversation).mockClear();

    const result = await maybeAutoCompactConversation({
      messages: overThresholdMessages,
      provider: 'openai',
      model: 'gpt-4o',
      maxContextTokens: 100,
      reserveTokens: 0,
      skipCompact: true,
    });

    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(overThresholdMessages);
    expect(compactConversation).not.toHaveBeenCalled();
  });

  it('未设置 skipCompact 且超过阈值时正常尝试压缩', async () => {
    vi.mocked(compactConversation).mockClear();

    await maybeAutoCompactConversation({
      messages: overThresholdMessages,
      provider: 'openai',
      model: 'gpt-4o',
      maxContextTokens: 100,
      reserveTokens: 0,
    });

    expect(compactConversation).toHaveBeenCalled();
  });
});

describe('maybeAutoCompactConversation countTurn', () => {
  it('countTurn 在已 compact 后未再压缩时递增 turnsSincePreviousCompact', async () => {
    vi.mocked(compactConversation).mockClear();

    const afterCompact = {
      turnsSincePreviousCompact: 0,
      lastCompactedAt: Date.now(),
    };

    const first = await maybeAutoCompactConversation({
      messages: [{ id: 'u1', role: 'user', text: 'hi' }],
      provider: 'openai',
      model: 'gpt-4o',
      maxContextTokens: 200_000,
      compactState: afterCompact,
      countTurn: true,
    });
    expect(first.compacted).toBe(false);
    expect(first.compactState.turnsSincePreviousCompact).toBe(1);
    expect(compactConversation).not.toHaveBeenCalled();

    const second = await maybeAutoCompactConversation({
      messages: [{ id: 'u1', role: 'user', text: 'hi' }],
      provider: 'openai',
      model: 'gpt-4o',
      maxContextTokens: 200_000,
      compactState: first.compactState,
      countTurn: true,
    });
    expect(second.compactState.turnsSincePreviousCompact).toBe(2);
  });

  it('countTurn=false 时不递增', async () => {
    const afterCompact = {
      turnsSincePreviousCompact: 1,
      lastCompactedAt: Date.now(),
    };
    const result = await maybeAutoCompactConversation({
      messages: [{ id: 'u1', role: 'user', text: 'hi' }],
      provider: 'openai',
      model: 'gpt-4o',
      maxContextTokens: 200_000,
      compactState: afterCompact,
      countTurn: false,
    });
    expect(result.compactState.turnsSincePreviousCompact).toBe(1);
  });

  it('从未 compact 过时 countTurn 不写入 lastCompactedAt', async () => {
    const result = await maybeAutoCompactConversation({
      messages: [{ id: 'u1', role: 'user', text: 'hi' }],
      provider: 'openai',
      model: 'gpt-4o',
      maxContextTokens: 200_000,
      countTurn: true,
    });
    expect(result.compactState.lastCompactedAt).toBeUndefined();
    expect(result.compactState.turnsSincePreviousCompact).toBe(0);
  });
});

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

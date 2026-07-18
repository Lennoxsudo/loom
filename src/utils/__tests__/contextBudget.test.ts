import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateToolsTokens,
  trimMessagesToFit,
  applyContextBudget,
  DEFAULT_CONTEXT_WINDOW,
  AUTO_COMPRESS_THRESHOLD,
  agePersistedProviderToolMessages,
  calibrateTokenEstimation,
  getCalibrationState,
  estimateMessageTokensWithProvider,
  getImageTokenEstimate,
  ageOldImageAttachments,
  DEFAULT_IMAGE_TOKENS,
} from '../contextBudget';

// ==================== estimateTokens ====================

describe('estimateTokens', () => {
  it('returns 0 for empty or falsy input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('estimates tokens for pure English text', () => {
    // 28 chars / 3.5 ≈ 8
    const tokens = estimateTokens('Hello, this is a test input.');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(30);
  });

  it('estimates higher tokens for CJK text', () => {
    // 5 Chinese chars × 1.5 = 7.5 → 8
    const cjk = '你好世界测';
    const tokensForCjk = estimateTokens(cjk);
    // Compare with same-length ASCII
    const ascii = 'ABCDE';
    const tokensForAscii = estimateTokens(ascii);
    expect(tokensForCjk).toBeGreaterThan(tokensForAscii);
  });

  it('handles mixed CJK and ASCII', () => {
    const mixed = 'Hello 你好';
    const tokens = estimateTokens(mixed);
    expect(tokens).toBeGreaterThan(0);
  });
});

// ==================== estimateMessageTokens ====================

describe('estimateMessageTokens', () => {
  it('adds overhead for role/separators', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: '' });
    // overhead = 4, content = 0
    expect(tokens).toBe(4);
  });

  it('estimates string content', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: 'Hello world' });
    expect(tokens).toBeGreaterThan(4); // 4 overhead + content
  });

  it('handles array content with text blocks', () => {
    const tokens = estimateMessageTokens({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
    });
    expect(tokens).toBeGreaterThan(4);
  });

  it('handles tool_use blocks', () => {
    const tokens = estimateMessageTokens({
      role: 'assistant',
      content: [{ type: 'tool_use', input: { path: '/test' } }],
    });
    expect(tokens).toBeGreaterThan(20); // 20 overhead per tool_use
  });

  it('handles tool_result blocks', () => {
    const tokens = estimateMessageTokens({
      role: 'user',
      content: [{ type: 'tool_result', content: 'file contents here' }],
    });
    expect(tokens).toBeGreaterThan(4);
  });

  it('estimates image blocks at ~300 tokens', () => {
    const tokens = estimateMessageTokens({
      role: 'user',
      content: [{ type: 'image', source: { data: 'base64...' } }],
    });
    // 4 overhead + 300 for image
    expect(tokens).toBe(304);
  });

  it('estimates image_url blocks at ~300 tokens', () => {
    const tokens = estimateMessageTokens({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.png' } }],
    });
    expect(tokens).toBe(304);
  });

  it('handles null/undefined content', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: null });
    expect(tokens).toBe(4); // only overhead
  });
});

// ==================== estimateToolsTokens ====================

describe('estimateToolsTokens', () => {
  it('returns 0 for null/undefined', () => {
    expect(estimateToolsTokens(null)).toBe(0);
    expect(estimateToolsTokens(undefined)).toBe(0);
  });

  it('estimates tokens for tool definitions', () => {
    const tools = [{ type: 'function', function: { name: 'read_file', parameters: {} } }];
    const tokens = estimateToolsTokens(tools);
    expect(tokens).toBeGreaterThan(0);
  });

  it('caches results for same object reference', () => {
    const tools = [{ type: 'function', function: { name: 'test', parameters: {} } }];
    const first = estimateToolsTokens(tools);
    const second = estimateToolsTokens(tools);
    expect(first).toBe(second);
  });
});

// ==================== trimMessagesToFit ====================

describe('trimMessagesToFit', () => {
  const makeMsg = (role: string, content: string) => ({ role, content });

  it('returns original array when within budget', () => {
    const messages = [makeMsg('user', 'Hi'), makeMsg('assistant', 'Hello')];
    const result = trimMessagesToFit(messages, 100_000);
    expect(result).toBe(messages); // exact same reference
  });

  it('returns empty array for empty input', () => {
    const result = trimMessagesToFit([], 100);
    expect(result).toEqual([]);
  });

  it('trims middle messages when over budget', () => {
    const messages = [
      makeMsg('system', 'System instruction'),
      makeMsg('user', 'x'.repeat(1000)),
      makeMsg('assistant', 'y'.repeat(1000)),
      makeMsg('user', 'z'.repeat(1000)),
      makeMsg('assistant', 'w'.repeat(1000)),
      makeMsg('user', 'final question'),
      makeMsg('assistant', 'final answer'),
    ];
    // Low budget to force trimming
    const result = trimMessagesToFit(messages, 300);
    expect(result.length).toBeLessThan(messages.length);
    // First message preserved
    expect(result[0]).toBe(messages[0]);
    // Last messages preserved
    expect(result[result.length - 1]).toBe(messages[messages.length - 1]);
  });

  it('never trims system messages', () => {
    // Need enough messages so that the middle region (between index 0 and protected tail)
    // contains a system message alongside removable ones.
    const messages = [
      makeMsg('user', 'Hi'),
      makeMsg('assistant', 'x'.repeat(2000)),
      makeMsg('system', 'Important system instruction'),
      makeMsg('user', 'y'.repeat(2000)),
      makeMsg('assistant', 'z'.repeat(2000)),
      makeMsg('user', 'a'.repeat(2000)),
      makeMsg('assistant', 'b'.repeat(2000)),
      makeMsg('user', 'final question'),
      makeMsg('assistant', 'final answer'),
    ];
    // Budget forces trimming but not aggressive trim
    const result = trimMessagesToFit(messages, 2500);
    // System message must still be present
    const systemMessages = result.filter((m) => m.role === 'system');
    expect(systemMessages.length).toBe(1);
    expect(systemMessages[0].content).toBe('Important system instruction');
  });

  it('inserts placeholder for trimmed region', () => {
    const messages = [
      makeMsg('user', 'first'),
      makeMsg('assistant', 'x'.repeat(5000)),
      makeMsg('user', 'y'.repeat(5000)),
      makeMsg('user', 'last question'),
      makeMsg('assistant', 'last answer'),
    ];
    const result = trimMessagesToFit(messages, 100);
    const placeholder = result.find(
      (m) => m.content === '[Earlier messages were truncated to fit context window]'
    );
    expect(placeholder).toBeDefined();
  });

  it('aggressive trim when only protected messages exist', () => {
    // With keepLastRounds=2 → 4 protected tail messages, plus index 0 = 5 protected.
    // If we only have 3 messages and they exceed budget, should use aggressive trim.
    const messages = [
      makeMsg('user', 'x'.repeat(50000)),
      makeMsg('assistant', 'y'.repeat(50000)),
      makeMsg('user', 'z'.repeat(50000)),
    ];
    const result = trimMessagesToFit(messages, 10);
    // Aggressive trim: keeps first + placeholder + last = 3
    expect(result.length).toBe(3);
  });

  it('handles dynamic keepLastRounds for tool-heavy conversations', () => {
    // Create a conversation with many tool messages at the end
    const messages = [
      makeMsg('user', 'first'),
      makeMsg('assistant', 'x'.repeat(1000)),
      makeMsg('user', 'middle'),
      makeMsg('assistant', 'y'.repeat(1000)),
      makeMsg('tool', 'result1'),
      makeMsg('tool', 'result2'),
      makeMsg('tool', 'result3'),
      makeMsg('user', 'question'),
      makeMsg('assistant', 'answer'),
    ];
    // With tool-heavy tail, keepLastRounds should be bumped to 3
    const result = trimMessagesToFit(messages, 200);
    // Verify last messages are preserved (more than default keepLastRounds=2 would give)
    expect(result[result.length - 1]).toBe(messages[messages.length - 1]);
  });
});

// ==================== applyContextBudget ====================

describe('applyContextBudget', () => {
  it('applies default budget correctly', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = applyContextBudget(messages, 'gpt-4o');
    // Should return messages as-is (small payload, big budget)
    expect(result.messages).toBe(messages);
  });

  it('subtracts tool tokens from budget', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const toolDefs = Array.from({ length: 50 }, (_, i) => ({
      type: 'function',
      function: { name: `tool_${i}`, parameters: { type: 'object', properties: {} } },
    }));
    const result = applyContextBudget(messages, 'gpt-4o', toolDefs);
    // Should still return all messages (payload is small)
    expect(result.messages.length).toBe(2);
  });

  it('uses maxContextTokens when provided', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = applyContextBudget(messages, 'any-model', undefined, 8192, 50_000);
    // Small payload, 50K budget should be fine
    expect(result.messages).toBe(messages);
  });

  it('applies 90% auto-compression threshold', () => {
    // Create messages that are within 200K but over 90% of a smaller budget
    const messages = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'x'.repeat(1000) },
      { role: 'assistant', content: 'y'.repeat(1000) },
      { role: 'user', content: 'z'.repeat(1000) },
      { role: 'assistant', content: 'w'.repeat(1000) },
      { role: 'user', content: 'final' },
      { role: 'assistant', content: 'answer' },
    ];
    // With maxContextTokens=4000, 90% threshold = (4000 - toolTokens - 8192) * 0.9
    // Actually reserveTokens=8192 > 4000, so messageBudget is negative
    // Use a larger budget
    const result = applyContextBudget(messages, 'any', undefined, 0, 500);
    // 500 * 0.9 = 450 token budget → should trim/compress some messages
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it('falls back to default when maxContextTokens is not provided', () => {
    const result = applyContextBudget(
      [{ role: 'user', content: 'Hi' }],
      'any-model',
    );
    expect(result.messages.length).toBe(1);
  });
});

describe('DEFAULT_CONTEXT_WINDOW', () => {
  it('is 200K tokens', () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
  });
});

describe('AUTO_COMPRESS_THRESHOLD', () => {
  it('is 0.9 (90%)', () => {
    expect(AUTO_COMPRESS_THRESHOLD).toBe(0.9);
  });
});

// ==================== agePersistedProviderToolMessages ====================

describe('agePersistedProviderToolMessages', () => {
  it('returns original array when no tool results', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const result = agePersistedProviderToolMessages(messages);
    expect(result).toBe(messages);
  });

  it('returns original array when tool results <= keepCount', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: 'result1' },
    ];
    const result = agePersistedProviderToolMessages(messages, 3);
    expect(result).toBe(messages);
  });

  it('summarizes old OpenAI-format tool results beyond keepCount', () => {
    const longContent = 'x'.repeat(500);
    const messages = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'tool', content: longContent },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
      { role: 'tool', content: longContent },
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'a3' },
      { role: 'tool', content: longContent },
      { role: 'user', content: 'q4' },
      { role: 'assistant', content: 'a4' },
      { role: 'tool', content: longContent },
    ];
    const result = agePersistedProviderToolMessages(messages, 3);
    // First tool result should be aged (content shortened)
    const firstTool = result[2] as { role: string; content: string };
    expect(firstTool.role).toBe('tool');
    expect(firstTool.content.length).toBeLessThan(longContent.length);
    expect(firstTool.content).toContain('[tool result aged');

    // Last 3 tool results should be unchanged
    const lastTool = result[11] as { role: string; content: string };
    expect(lastTool.content).toBe(longContent);
  });

  it('summarizes old Anthropic-format tool_result blocks', () => {
    const longContent = 'y'.repeat(500);
    const makeToolResultMsg = (content: string) => ({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'id1', content }],
    });

    const messages = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'id1', name: 'read', input: {} }] },
      makeToolResultMsg(longContent),
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'id2', name: 'read', input: {} }] },
      makeToolResultMsg(longContent),
    ];
    const result = agePersistedProviderToolMessages(messages, 1);
    // First tool_result should be aged
    const firstToolResultMsg = result[2];
    const block = (firstToolResultMsg.content as Array<Record<string, unknown>>)[0];
    expect(block.type).toBe('tool_result');
    expect((block.content as string).length).toBeLessThan(longContent.length);
    expect(block.tool_use_id).toBe('id1'); // structure preserved

    // Last tool_result should be unchanged
    const lastToolResultMsg = result[5];
    const lastBlock = (lastToolResultMsg.content as Array<Record<string, unknown>>)[0];
    expect(lastBlock.content).toBe(longContent);
  });

  it('does not summarize short tool results', () => {
    const messages = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'tool', content: 'short' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
      { role: 'tool', content: 'short2' },
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'a3' },
      { role: 'tool', content: 'short3' },
    ];
    const result = agePersistedProviderToolMessages(messages, 1);
    // Short content should not be aged
    const firstTool = result[2] as { role: string; content: string };
    expect(firstTool.content).toBe('short');
  });

  it('handles empty messages array', () => {
    const result = agePersistedProviderToolMessages([]);
    expect(result).toEqual([]);
  });
});

// ==================== calibrateTokenEstimation (方法 11) ====================

describe('calibrateTokenEstimation (方法 11)', () => {
  it('updates calibration state when actual > estimated', () => {
    const before = getCalibrationState();
    // 估算 100，实际 150 → ratio 1.5，系数应增大
    calibrateTokenEstimation(100, 150);
    const after = getCalibrationState();
    expect(after.cjkFactor).toBeGreaterThan(before.cjkFactor);
    expect(after.nonCjkDivisor).toBeLessThan(before.nonCjkDivisor);
    expect(after.sampleCount).toBe(before.sampleCount + 1);
  });

  it('updates calibration state when actual < estimated', () => {
    const before = getCalibrationState();
    // 估算 200，实际 100 → ratio 0.5，系数应减小
    calibrateTokenEstimation(200, 100);
    const after = getCalibrationState();
    expect(after.cjkFactor).toBeLessThan(before.cjkFactor);
    expect(after.nonCjkDivisor).toBeGreaterThan(before.nonCjkDivisor);
  });

  it('ignores invalid inputs (zero or negative)', () => {
    const before = getCalibrationState();
    calibrateTokenEstimation(0, 100);
    calibrateTokenEstimation(100, 0);
    calibrateTokenEstimation(-10, 100);
    const after = getCalibrationState();
    expect(after.sampleCount).toBe(before.sampleCount); // no update
  });

  it('clamps extreme ratios to prevent runaway calibration', () => {
    // 估算 1，实际 10000 → ratio would be 10000, but clamped to 2.0
    calibrateTokenEstimation(1, 10000);
    const after = getCalibrationState();
    // cjkFactor should not exceed MAX_CJK_FACTOR (3.0)
    expect(after.cjkFactor).toBeLessThanOrEqual(3.0);
    expect(after.cjkFactor).toBeGreaterThan(0);
  });
});

// ==================== trimMessagesToFit 前缀保护 (方法 10) ====================

describe('trimMessagesToFit prefix protection (方法 10)', () => {
  const makeMsg = (role: string, content: string) => ({ role, content });

  it('preserves first 3 messages as cache prefix when trimming', () => {
    const messages = [
      makeMsg('system', 'System instruction'),
      makeMsg('user', 'first question'),
      makeMsg('assistant', 'first answer'),
      makeMsg('user', 'x'.repeat(5000)),
      makeMsg('assistant', 'y'.repeat(5000)),
      makeMsg('user', 'z'.repeat(5000)),
      makeMsg('assistant', 'w'.repeat(5000)),
      makeMsg('user', 'final question'),
      makeMsg('assistant', 'final answer'),
    ];
    const result = trimMessagesToFit(messages, 300);
    // 前 3 条必须原样保留（缓存前缀）
    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
    expect(result[2]).toBe(messages[2]);
  });

  it('preserves prefix when trimming middle messages', () => {
    // 前缀消息适中，中间消息很大，预算能容纳前缀+尾部但不容纳中间
    // 需要 >7 条消息，让 keepLastRounds=2 (4条尾部) + 前缀3条 之间有可移除的中间消息
    const messages = [
      makeMsg('system', 'System'),
      makeMsg('user', 'first question'),
      makeMsg('assistant', 'first answer'),
      makeMsg('user', 'x'.repeat(5000)),  // 可移除的中间消息
      makeMsg('assistant', 'y'.repeat(5000)), // 可移除的中间消息
      makeMsg('user', 'z'.repeat(5000)),  // 可移除的中间消息
      makeMsg('user', 'final question'),
      makeMsg('assistant', 'final answer'),
    ];
    // 前缀 ~20 tokens + 尾部 ~20 tokens = ~40 tokens
    // 预算 100 能容纳前缀+尾部，但不容纳中间的 5000 字符大消息
    const result = trimMessagesToFit(messages, 100);
    // 前缀 3 条应被保留（引用相同）
    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
    expect(result[2]).toBe(messages[2]);
  });
});

// ==================== 方法 15: 图片附件上下文管理 ====================

describe('方法 15: 图片附件上下文管理', () => {
  describe('getImageTokenEstimate', () => {
    it('returns provider-specific token estimates', () => {
      expect(getImageTokenEstimate('openai')).toBe(85);
      expect(getImageTokenEstimate('anthropic')).toBe(1600);
      expect(getImageTokenEstimate('ollama')).toBe(300);
    });

    it('returns default for unknown provider', () => {
      expect(getImageTokenEstimate('unknown')).toBe(DEFAULT_IMAGE_TOKENS);
      expect(getImageTokenEstimate(undefined)).toBe(DEFAULT_IMAGE_TOKENS);
      expect(getImageTokenEstimate('')).toBe(DEFAULT_IMAGE_TOKENS);
    });
  });

  describe('estimateMessageTokensWithProvider', () => {
    it('uses provider-specific image token estimate', () => {
      const msg = {
        role: 'user',
        content: [{ type: 'image', source: { data: 'base64...' } }],
      };
      const anthropicTokens = estimateMessageTokensWithProvider(msg, 'anthropic');
      const openaiTokens = estimateMessageTokensWithProvider(msg, 'openai');
      // Anthropic should estimate much higher than OpenAI
      expect(anthropicTokens).toBeGreaterThan(openaiTokens);
      // 4 overhead + 1600 for anthropic
      expect(anthropicTokens).toBe(1604);
      // 4 overhead + 85 for openai
      expect(openaiTokens).toBe(89);
    });

    it('falls back to default 300 when no provider', () => {
      const msg = {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.png' } }],
      };
      const tokens = estimateMessageTokensWithProvider(msg);
      expect(tokens).toBe(304); // 4 overhead + 300
    });

    it('handles non-image content same as estimateMessageTokens', () => {
      const msg = { role: 'user', content: 'Hello world' };
      expect(estimateMessageTokensWithProvider(msg, 'anthropic')).toBe(
        estimateMessageTokens(msg),
      );
    });
  });

  describe('ageOldImageAttachments', () => {
    it('returns original array when no images', () => {
      const messages = [
        { role: 'user', content: 'text only' },
        { role: 'assistant', content: 'response' },
      ];
      const result = ageOldImageAttachments(messages);
      expect(result).toBe(messages);
    });

    it('returns original when image count <= keepCount', () => {
      const messages = [
        {
          role: 'user',
          content: [{ type: 'image', source: {} }, { type: 'text', text: 'look at this' }],
        },
      ];
      const result = ageOldImageAttachments(messages, 3);
      expect(result).toBe(messages);
    });

    it('replaces old image blocks with text placeholders', () => {
      const makeImageMsg = (idx: number) => ({
        role: 'user',
        content: [
          { type: 'image', source: { data: `base64-${idx}` } },
          { type: 'text', text: `Image ${idx}` },
        ],
      });

      const messages = [
        makeImageMsg(1),
        { role: 'assistant', content: 'reply 1' },
        makeImageMsg(2),
        { role: 'assistant', content: 'reply 2' },
        makeImageMsg(3),
        { role: 'assistant', content: 'reply 3' },
        makeImageMsg(4),
        { role: 'assistant', content: 'reply 4' },
      ];

      const result = ageOldImageAttachments(messages, 2);
      // 4 image messages, keep last 2 → age first 2

      // First image message should have image replaced with text placeholder
      const firstMsg = result[0];
      const firstContent = firstMsg.content as Array<Record<string, unknown>>;
      const firstImageBlock = firstContent.find((b) => b.type === 'image');
      const firstPlaceholder = firstContent.find(
        (b) => b.type === 'text' && typeof b.text === 'string' && b.text.includes('Image removed'),
      );
      expect(firstImageBlock).toBeUndefined();
      expect(firstPlaceholder).toBeDefined();

      // Last image message should be unchanged
      const lastImageMsg = result[6];
      const lastContent = lastImageMsg.content as Array<Record<string, unknown>>;
      const lastImageBlock = lastContent.find((b) => b.type === 'image');
      expect(lastImageBlock).toBeDefined();
    });

    it('preserves text blocks in aged messages', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'image', source: {} },
            { type: 'text', text: 'important text' },
          ],
        },
        { role: 'assistant', content: 'reply' },
        {
          role: 'user',
          content: [
            { type: 'image', source: {} },
            { type: 'text', text: 'recent image' },
          ],
        },
      ];

      const result = ageOldImageAttachments(messages, 1);
      const firstMsg = result[0];
      const firstContent = firstMsg.content as Array<Record<string, unknown>>;
      // Text block should still be there
      const textBlock = firstContent.find(
        (b) => b.type === 'text' && b.text === 'important text',
      );
      expect(textBlock).toBeDefined();
    });

    it('handles empty messages array', () => {
      const result = ageOldImageAttachments([]);
      expect(result).toEqual([]);
    });
  });
});

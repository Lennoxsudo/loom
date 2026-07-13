import { describe, expect, it } from 'vitest';
import { finalizeMainStreamToolCalls } from '../finalizeMainStreamToolCalls';
import type { ToolCall } from '../../../types/ai';

describe('finalizeMainStreamToolCalls', () => {
  it('prefers native tool calls over pseudo extraction', () => {
    const native: ToolCall[] = [
      {
        id: 'native-1',
        type: 'function',
        function: { name: 'read', arguments: '{"path":"a.ts"}' },
      },
    ];

    const result = finalizeMainStreamToolCalls(
      '<tool_call><function=bash><parameter=command>ls</parameter></function></tool_call>',
      native,
      ['read', 'term']
    );

    expect(result.toolCalls).toEqual(native);
    expect(result.cleanedText).toContain('<tool_call>');
  });

  it('falls back to pseudo extraction when native tool calls are empty', () => {
    const result = finalizeMainStreamToolCalls(
      '<tool_call><function=bash><parameter=command>ls</parameter></function></tool_call>',
      [],
      ['term']
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('term');
    expect(result.cleanedText).not.toContain('<tool_call>');
  });
});

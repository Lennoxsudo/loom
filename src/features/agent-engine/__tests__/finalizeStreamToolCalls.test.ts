import { describe, expect, it } from 'vitest';
import { resolveNativeStreamToolCalls } from '../finalizeStreamToolCalls';
import type { ToolCall } from '../../../types/ai';

describe('resolveNativeStreamToolCalls', () => {
  it('returns only native tool calls and keeps assistant text unchanged', () => {
    const native: ToolCall[] = [
      {
        id: 'native-1',
        type: 'function',
        function: { name: 'finfo', arguments: '{"action":"list","path":"."}' },
      },
    ];

    const result = resolveNativeStreamToolCalls(
      '{ "tool": "list_directory", "arguments": { "path": "." } }',
      native
    );

    expect(result.toolCalls).toEqual(native);
    expect(result.cleanedText).toContain('list_directory');
  });

  it('does not parse JSON tool calls from assistant text', () => {
    const result = resolveNativeStreamToolCalls(
      '{ "tool": "list_directory", "arguments": { "path": "." } }',
      []
    );

    expect(result.toolCalls).toEqual([]);
    expect(result.cleanedText).toContain('list_directory');
  });
});

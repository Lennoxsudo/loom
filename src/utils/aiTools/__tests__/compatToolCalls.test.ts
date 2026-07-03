import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../../../types/ai';
import { extractCompatToolCallsFromContent } from '../compatToolCalls';
import { resolveSubagentStreamToolCalls } from '../finalizeStreamToolCalls';
import {
  extractKnownToolNamesFromProviderTools,
  resolveStreamCompletionToolCalls,
} from '../streamCompletionToolCalls';

const KNOWN_TOOLS = ['read', 'search', 'finfo'];

describe('extractCompatToolCallsFromContent', () => {
  it('parses standalone JSON tool objects with name + arguments', () => {
    const content = '{ "name": "list_directory", "arguments": { "path": "." } }';

    const { toolCalls, cleanedContent } = extractCompatToolCallsFromContent(content, KNOWN_TOOLS);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('finfo');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({
      action: 'list',
      path: '.',
    });
    expect(cleanedContent).toBe('');
  });

  it('parses standalone JSON tool objects with tool + arguments', () => {
    const content = '{ "tool": "read_file", "arguments": { "path": "package.json" } }';

    const { toolCalls } = extractCompatToolCallsFromContent(content, ['read', 'finfo']);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('read');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ path: 'package.json' });
  });

  it('parses JSON inside markdown code fences', () => {
    const content = '```json\n{ "name": "read", "arguments": { "path": "." } }\n```';

    const { toolCalls, cleanedContent } = extractCompatToolCallsFromContent(content, KNOWN_TOOLS);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('read');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ path: '.' });
    expect(cleanedContent).not.toContain('"name"');
    expect(cleanedContent).not.toContain('read');
  });

  it('parses JSON embedded after leading prose', () => {
    const content =
      'I will read the project root.\n\n{ "name": "read", "arguments": { "path": "." } }';

    const { toolCalls, cleanedContent } = extractCompatToolCallsFromContent(content, KNOWN_TOOLS);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('read');
    expect(cleanedContent).toBe('I will read the project root.');
    expect(cleanedContent).not.toContain('"arguments"');
  });
});

describe('resolveSubagentStreamToolCalls', () => {
  it('normalizes native tool_calls to allowed subagent tool names', () => {
    const result = resolveSubagentStreamToolCalls(
      '',
      [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'list_directory',
            arguments: JSON.stringify({ path: '.' }),
          },
        },
      ],
      ['finfo', 'read']
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('finfo');
  });

  it('falls back to compat JSON extraction when native tool_calls are missing', () => {
    const result = resolveSubagentStreamToolCalls(
      '{ "name": "list_directory", "arguments": { "path": "." } }',
      [],
      ['finfo']
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('finfo');
    expect(result.cleanedText).toBe('');
  });

  it('parses fenced JSON via compat fallback', () => {
    const result = resolveSubagentStreamToolCalls(
      '```json\n{ "name": "read", "arguments": { "path": "." } }\n```',
      [],
      ['read']
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('read');
    expect(result.cleanedText).not.toContain('"name"');
  });

  it('parses prose-prefixed JSON via compat fallback', () => {
    const result = resolveSubagentStreamToolCalls(
      'Listing files now.\n{ "name": "read", "arguments": { "path": "." } }',
      [],
      ['read']
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('read');
    expect(result.cleanedText).toBe('Listing files now.');
  });

  it('maps list_directory text JSON to finfo(action:list)', () => {
    const result = resolveSubagentStreamToolCalls(
      '{ "name": "list_directory", "arguments": { "path": "src" } }',
      [],
      ['finfo', 'read']
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('finfo');
    expect(JSON.parse(result.toolCalls[0].function.arguments)).toEqual({
      action: 'list',
      path: 'src',
    });
  });
});

describe('extractKnownToolNamesFromProviderTools', () => {
  it('extracts names from OpenAI-style tools', () => {
    const names = extractKnownToolNamesFromProviderTools([
      {
        type: 'function',
        function: { name: 'read', description: 'Read file', parameters: {} },
      },
      {
        type: 'function',
        function: { name: 'search', description: 'Search', parameters: {} },
      },
    ]);
    expect(names).toEqual(['read', 'search']);
  });
});

describe('resolveStreamCompletionToolCalls', () => {
  const knownTools = ['read', 'search', 'finfo'];

  it('passes through backend tool_calls including unknown tool names', () => {
    const backendCalls: ToolCall[] = [
      {
        id: 'call-think',
        type: 'function',
        function: { name: 'thinking', arguments: '{"content":"plan"}' },
      },
    ];

    const result = resolveStreamCompletionToolCalls(backendCalls, '', knownTools);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].function.name).toBe('thinking');
  });

  it('keeps real backend tool calls', () => {
    const backendCalls: ToolCall[] = [
      {
        id: 'call-read',
        type: 'function',
        function: { name: 'read', arguments: '{"path":"README.md"}' },
      },
    ];

    const result = resolveStreamCompletionToolCalls(backendCalls, '', knownTools);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].function.name).toBe('read');
  });

  it('passes through mixed backend tool calls', () => {
    const backendCalls: ToolCall[] = [
      {
        id: 'call-think',
        type: 'function',
        function: { name: 'think', arguments: '{}' },
      },
      {
        id: 'call-read',
        type: 'function',
        function: { name: 'read', arguments: '{"path":"src"}' },
      },
    ];

    const result = resolveStreamCompletionToolCalls(backendCalls, '', knownTools);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls?.map((call) => call.function.name)).toEqual(['think', 'read']);
  });

  it('does not treat hallucinated thinking tool names as real tools', () => {
    const text = '[Tool: thinking]\n{"content":"internal"}';

    const result = resolveStreamCompletionToolCalls(undefined, text, knownTools);

    expect(result.toolCalls).toBeUndefined();
    expect(result.cleanedText).toBeUndefined();
  });

  it('does not modify visible text when pseudo markup is stripped but no real tools match', () => {
    const text =
      'Here is the answer.\n<tool_call><function name="thinking"><parameter name="content">plan</parameter></function></tool_call>';

    const result = resolveStreamCompletionToolCalls(undefined, text, knownTools);

    expect(result.toolCalls).toBeUndefined();
    expect(result.cleanedText).toBeUndefined();
  });

  it('returns cleanedText only when real tools are resolved from content', () => {
    const text =
      '<tool_call><function name="read"><parameter name="path">README.md</parameter></function></tool_call>';

    const result = resolveStreamCompletionToolCalls(undefined, text, knownTools);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.cleanedText).toBeDefined();
    expect(result.cleanedText).not.toContain('<tool_call>');
  });
});

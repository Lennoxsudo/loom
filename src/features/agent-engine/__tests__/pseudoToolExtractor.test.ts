import { describe, expect, it } from 'vitest';
import { extractPseudoToolCallsFromContent } from '../pseudoToolExtractor';

describe('extractPseudoToolCallsFromContent', () => {
  it('extracts Qwen-style function=bash tool calls and maps to term', () => {
    const content = [
      '<tool_call>',
      '<function=bash>',
      '<parameter=command>ls -la</parameter>',
      '<parameter=description>List files</parameter>',
      '</function>',
      '</tool_call>',
    ].join(' ');

    const { toolCalls, cleanedContent } = extractPseudoToolCallsFromContent(content, [
      'term',
      'read',
    ]);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('term');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({
      command: 'ls -la',
      description: 'List files',
    });
    expect(cleanedContent).not.toContain('<tool_call>');
  });

  it('extracts standard function name attribute blocks', () => {
    const content =
      '<tool_call><function name="read"><parameter name="path">src/App.tsx</parameter></function></tool_call>';

    const { toolCalls } = extractPseudoToolCallsFromContent(content, ['read']);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('read');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ path: 'src/App.tsx' });
  });

  it('extracts JSON bodies inside tool_call tags', () => {
    const content = '<tool_call>{"name":"read","arguments":{"path":"README.md"}}</tool_call>';

    const { toolCalls } = extractPseudoToolCallsFromContent(content, ['read']);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('read');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ path: 'README.md' });
  });

  it('extracts multiline tool_name + JSON blocks and maps list_directory to finfo', () => {
    const content = `list_directory
{
  "path": "."
}`;

    const { toolCalls, cleanedContent } = extractPseudoToolCallsFromContent(content, [
      'read',
      'search',
      'finfo',
    ]);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('finfo');
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({
      action: 'list',
      path: '.',
    });
    expect(cleanedContent).not.toContain('list_directory');
  });
});

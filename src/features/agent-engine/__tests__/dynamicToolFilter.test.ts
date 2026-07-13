import { describe, it, expect } from 'vitest';
import {
  filterToolsByContext,
  extractRecentlyUsedToolNames,
  extractToolNameFromProviderTool,
} from '../dynamicToolFilter';

// ==================== filterToolsByContext ====================

describe('filterToolsByContext', () => {
  const makeTool = (name: string) => ({ name, description: '', parameters: { type: 'object' as const, properties: {}, required: [] } });

  it('removes git tools when not a git repo', () => {
    const tools = [makeTool('read'), makeTool('git'), makeTool('get_git_diff')];
    const result = filterToolsByContext(tools, { isGitRepo: false });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('keeps git tools when in a git repo', () => {
    const tools = [makeTool('read'), makeTool('git'), makeTool('get_git_diff')];
    const result = filterToolsByContext(tools, { isGitRepo: true });
    expect(result.map((t) => t.name)).toEqual(['read', 'git', 'get_git_diff']);
  });

  it('removes browser tools when no browser capability', () => {
    const tools = [makeTool('read'), makeTool('browser'), makeTool('fetch'), makeTool('web_search')];
    const result = filterToolsByContext(tools, { hasBrowserCapability: false });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });

  it('removes graph tools when enableCodeGraph is false', () => {
    const tools = [makeTool('read'), makeTool('graph_index'), makeTool('graph_query')];
    const result = filterToolsByContext(tools, { enableCodeGraph: false });
    expect(result.map((t) => t.name)).toEqual(['read']);
  });
});

// ==================== extractRecentlyUsedToolNames ====================

describe('extractRecentlyUsedToolNames', () => {
  it('extracts tool names from OpenAI-format tool_calls', () => {
    const messages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: '1', function: { name: 'read_file', arguments: '{}' } },
          { id: '2', function: { name: 'search', arguments: '{}' } },
        ],
      },
    ];
    const names = extractRecentlyUsedToolNames(messages);
    expect(names.has('read_file')).toBe(true);
    expect(names.has('search')).toBe(true);
    expect(names.size).toBe(2);
  });

  it('extracts tool names from Anthropic-format tool_use blocks', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read the file.' },
          { type: 'tool_use', id: '1', name: 'read_file', input: {} },
        ],
      },
    ];
    const names = extractRecentlyUsedToolNames(messages);
    expect(names.has('read_file')).toBe(true);
  });

  it('respects lookbackCount limit', () => {
    const messages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: '1', function: { name: 'old_tool', arguments: '{}' } }],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: '2', function: { name: 'new_tool', arguments: '{}' } }],
      },
    ];
    // Only look at last 1 message
    const names = extractRecentlyUsedToolNames(messages, 1);
    expect(names.has('new_tool')).toBe(true);
    expect(names.has('old_tool')).toBe(false);
  });

  it('returns empty set for messages without tool calls', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const names = extractRecentlyUsedToolNames(messages);
    expect(names.size).toBe(0);
  });
});

// ==================== extractToolNameFromProviderTool ====================

describe('extractToolNameFromProviderTool', () => {
  it('extracts name from OpenAI format', () => {
    const tool = { type: 'function', function: { name: 'read_file', parameters: {} } };
    expect(extractToolNameFromProviderTool(tool)).toBe('read_file');
  });

  it('extracts name from Anthropic format', () => {
    const tool = { name: 'read_file', description: 'Read a file', input_schema: {} };
    expect(extractToolNameFromProviderTool(tool)).toBe('read_file');
  });

  it('extracts name from Gemini format', () => {
    const tool = { functionDeclarations: [{ name: 'read_file', parameters: {} }] };
    expect(extractToolNameFromProviderTool(tool)).toBe('read_file');
  });

  it('returns null for unrecognized format', () => {
    expect(extractToolNameFromProviderTool({ random: 'stuff' })).toBeNull();
    expect(extractToolNameFromProviderTool(null)).toBeNull();
    expect(extractToolNameFromProviderTool('string')).toBeNull();
  });
});

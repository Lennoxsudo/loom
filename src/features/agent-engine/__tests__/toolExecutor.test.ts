import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeToolCall, isKnownToolName } from '../toolExecutor';
import type { ToolCall } from '../../../types/ai';
import { invoke } from '@tauri-apps/api/core';
import { toolCache } from '../toolCache';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../../utils/browserController', () => ({
  browserController: {
    open: vi.fn(),
    navigate: vi.fn(),
    refresh: vi.fn(),
  },
}));

describe('executeToolCall', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    toolCache.clear();
  });

  it('should return error for unknown tool with available tools list', async () => {
    const toolCall: ToolCall = {
      id: 'test-id',
      type: 'function',
      function: {
        name: 'unknown_tool',
        arguments: '{}',
      },
    };

    const result = await executeToolCall(toolCall);
    expect(result.error).toContain('未知的工具');
    expect(result.error).toContain('可用工具');
    expect(result.error).toContain('read');
    expect(result.error).toContain('term');
  });

  it('isKnownToolName recognizes built-in, merged, and MCP tools', () => {
    // Built-in
    expect(isKnownToolName('read')).toBe(true);
    expect(isKnownToolName('read_file')).toBe(true);
    expect(isKnownToolName('graph_query')).toBe(true);
    // Merged
    expect(isKnownToolName('term')).toBe(true);
    expect(isKnownToolName('finfo')).toBe(true);
    // MCP
    expect(isKnownToolName('mcp_myserver__do_thing')).toBe(true);
    // Unknown
    expect(isKnownToolName('apply_patch')).toBe(false);
    expect(isKnownToolName('browser_screenshot')).toBe(false);
  });

  it('should handle invalid JSON arguments', async () => {
    const toolCall: ToolCall = {
      id: 'test-id',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: 'invalid json',
      },
    };

    const result = await executeToolCall(toolCall);
    expect(result.tool_call_id).toBe('test-id');
  });

  it('should route to correct handler', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      is_binary: false,
      content: 'test content',
      truncated: false,
      lines_read: 1,
      bytes_read: 12,
    });

    const toolCall: ToolCall = {
      id: 'test-id',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ path: '/test/file.txt' }),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: '/test' });
    expect(result.tool_call_id).toBe('test-id');
    expect(result.output).toContain('文件内容');
  });

  it('should normalize tool arguments', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      is_binary: false,
      content: 'test content',
      truncated: false,
      lines_read: 1,
      bytes_read: 12,
    });

    const toolCall: ToolCall = {
      id: 'test-id',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ filePath: '/test/file.txt' }),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: '/test' });
    expect(result.tool_call_id).toBe('test-id');
  });

  it('should execute TodoWrite tool', async () => {
    const toolCall: ToolCall = {
      id: 'todo-test-id',
      type: 'function',
      function: {
        name: 'TodoWrite',
        arguments: JSON.stringify({
          todos: [
            { id: 't1', content: 'add TodoWrite support', status: 'in_progress' },
            { id: 't2', content: 'run tests', status: 'pending' },
          ],
        }),
      },
    };

    const result = await executeToolCall(toolCall, {
      agentId: 'test-agent',
      conversationId: 'test-conversation',
    });
    expect(result.tool_call_id).toBe('todo-test-id');
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Todo list updated');
    expect(result.output).toContain('add TodoWrite support');
  });

  it('should execute ask tool when the environment provides a question callback', async () => {
    const onAskUserQuestion = vi
      .fn()
      .mockResolvedValue([{ questionIndex: 0, selected: ['继续修复'] }]);
    const toolCall: ToolCall = {
      id: 'ask-test-id',
      type: 'function',
      function: {
        name: 'ask',
        arguments: JSON.stringify({
          questions: [
            {
              header: '确认',
              question: '下一步怎么做？',
              options: [
                { label: '继续修复', description: '继续处理当前问题' },
                { label: '稍后再说', description: '先暂停当前问题' },
              ],
            },
          ],
        }),
      },
    };

    const result = await executeToolCall(toolCall, {
      agentId: 'test-agent',
      onAskUserQuestion,
    });

    expect(onAskUserQuestion).toHaveBeenCalledWith('test-agent', [
      expect.objectContaining({
        header: '确认',
        question: '下一步怎么做？',
      }),
    ]);
    expect(result.tool_call_id).toBe('ask-test-id');
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('继续修复');
  });

  it('should return a clear error when ask tool is unavailable in the current environment', async () => {
    const toolCall: ToolCall = {
      id: 'ask-unsupported-id',
      type: 'function',
      function: {
        name: 'ask',
        arguments: JSON.stringify({
          questions: [
            {
              header: '确认',
              question: '下一步怎么做？',
              options: [
                { label: '继续修复', description: '继续处理当前问题' },
                { label: '稍后再说', description: '先暂停当前问题' },
              ],
            },
          ],
        }),
      },
    };

    const result = await executeToolCall(toolCall, {
      agentId: 'test-agent',
    });

    expect(result.tool_call_id).toBe('ask-unsupported-id');
    expect(result.error).toContain('ask_user_question');
    expect(result.error).toContain('未在此环境中支持');
  });

  it('returns full output without compression for large files', async () => {
    const longContent = 'x'.repeat(22000);
    vi.mocked(invoke).mockResolvedValueOnce({
      is_binary: false,
      content: longContent,
      truncated: false,
      lines_read: 1,
      bytes_read: longContent.length,
    });

    const toolCall: ToolCall = {
      id: 'long-read-id',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ path: '/test/large.txt' }),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: '/test' });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain(longContent);
  });

  it('invalidates cached read results after writing the same file via canonical tool names', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        is_binary: false,
        content: 'old content',
        truncated: false,
        lines_read: 1,
        bytes_read: 11,
      })
      .mockResolvedValueOnce({
        bytes_written: 11,
        lines: 1,
        duration_ms: 1,
        skipped: false,
      })
      .mockResolvedValueOnce('new content')
      .mockResolvedValueOnce({
        is_binary: false,
        content: 'new content',
        truncated: false,
        lines_read: 1,
        bytes_read: 11,
      });

    const firstRead: ToolCall = {
      id: 'read-1',
      type: 'function',
      function: {
        name: 'read',
        arguments: JSON.stringify({ path: 'src/file.ts' }),
      },
    };

    const write: ToolCall = {
      id: 'write-1',
      type: 'function',
      function: {
        name: 'write',
        arguments: JSON.stringify({ path: 'src/file.ts', content: 'new content' }),
      },
    };

    const secondRead: ToolCall = {
      id: 'read-2',
      type: 'function',
      function: {
        name: 'read',
        arguments: JSON.stringify({ path: 'src/file.ts' }),
      },
    };

    const context = { baseDir: '/test/project' };

    const firstReadResult = await executeToolCall(firstRead, context);
    expect(firstReadResult.output).toContain('old content');

    const writeResult = await executeToolCall(write, context);
    expect(writeResult.files_changed).toEqual(['/test/project/src/file.ts']);

    const secondReadResult = await executeToolCall(secondRead, context);
    expect(secondReadResult.output).toContain('new content');

    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === 'read_file_content_tool')
    ).toHaveLength(2);
  });
});

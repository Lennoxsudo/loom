import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AI_TOOLS, executeToolCall, type ToolCall } from '../features/agent-engine';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

describe('get_file_info tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined in AI_TOOLS via file_info merged tool', () => {
    const tool = AI_TOOLS.find((t) => t.name === 'file_info');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('info');
    expect(tool?.parameters.properties).toHaveProperty('action');
    expect(tool?.parameters.properties).toHaveProperty('path');
    expect(tool?.parameters.required).toContain('action');
  });

  it('should execute successfully for a small file via merged file_info tool', async () => {
    const mockResult = {
      path: 'D:\\project\\test\\file.txt',
      exists: true,
      file_type: 'file',
      size_bytes: 1234,
      size_human: '1.2 KB',
      created: '2026-01-15 10:30:45',
      modified: '2026-01-31 14:22:10',
      accessed: '2026-01-31 21:00:00',
      is_readonly: false,
      permissions: 'rw-r--r--',
      is_binary: false,
      target_path: null,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-1',
      type: 'function',
      function: {
        name: 'file_info',
        arguments: JSON.stringify({ action: 'info', path: 'file.txt' }),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: 'D:\\project\\test' });

    expect(result.tool_call_id).toBe('test-1');
    expect(result.output).toContain('文件信息');
    expect(result.output).toContain('类型: 文件');
    expect(result.output).toContain('1,234 字节');
    expect(result.output).toContain('1.2 KB');
    expect(result.output).toContain('提示: 文件较小，可以安全读取');
    expect(invoke).toHaveBeenCalledWith('get_file_info', {
      path: 'D:\\project\\test\\file.txt',
    });
  });

  it('should show warning for large files via merged tool', async () => {
    const mockResult = {
      path: 'D:\\logs\\app.log',
      exists: true,
      file_type: 'file',
      size_bytes: 52428800,
      size_human: '50.0 MB',
      created: '2026-01-01 00:00:00',
      modified: '2026-01-31 20:59:59',
      accessed: '2026-01-31 21:00:00',
      is_readonly: false,
      permissions: 'rw-r--r--',
      is_binary: false,
      target_path: null,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-2',
      type: 'function',
      function: {
        name: 'file_info',
        arguments: JSON.stringify({ action: 'info', path: 'D:\\logs\\app.log' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-2');
    expect(result.output).toContain('严重警告');
    expect(result.output).toContain('文件非常大');
    expect(result.output).toContain('50.0 MB');
    expect(result.output).toContain('严重的 Token 消耗');
  });

  it('should handle directory info', async () => {
    const mockResult = {
      path: 'D:\\project\\src',
      exists: true,
      file_type: 'directory',
      size_bytes: 0,
      size_human: '0 B',
      created: '2026-01-10 09:00:00',
      modified: '2026-01-31 18:45:30',
      accessed: '2026-01-31 21:00:00',
      is_readonly: false,
      permissions: 'rwxr-xr-x',
      is_binary: false,
      target_path: null,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-3',
      type: 'function',
      function: {
        name: 'get_file_info',
        arguments: JSON.stringify({ path: 'D:\\project\\src' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-3');
    expect(result.output).toContain('类型: 目录');
    expect(result.output).not.toContain('大小:');
    expect(result.output).toContain('权限: rwxr-xr-x');
  });

  it('should handle nonexistent files', async () => {
    const mockResult = {
      path: 'D:\\nonexistent\\file.txt',
      exists: false,
      file_type: 'unknown',
      size_bytes: 0,
      size_human: '0 B',
      created: null,
      modified: null,
      accessed: null,
      is_readonly: false,
      permissions: null,
      is_binary: false,
      target_path: null,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-4',
      type: 'function',
      function: {
        name: 'get_file_info',
        arguments: JSON.stringify({ path: 'D:\\nonexistent\\file.txt' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-4');
    expect(result.output).toContain('文件不存在');
  });

  it('should handle readonly files', async () => {
    const mockResult = {
      path: 'D:\\config\\readonly.conf',
      exists: true,
      file_type: 'file',
      size_bytes: 500,
      size_human: '500 B',
      created: '2026-01-01 00:00:00',
      modified: '2026-01-15 12:00:00',
      accessed: '2026-01-31 21:00:00',
      is_readonly: true,
      permissions: 'r--r--r--',
      is_binary: false,
      target_path: null,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-5',
      type: 'function',
      function: {
        name: 'get_file_info',
        arguments: JSON.stringify({ path: 'D:\\config\\readonly.conf' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-5');
    expect(result.output).toContain('只读: 是');
    expect(result.output).toContain('权限: r--r--r--');
  });

  it('should normalize parameter names', async () => {
    const mockResult = {
      path: 'D:\\test.txt',
      exists: true,
      file_type: 'file',
      size_bytes: 100,
      size_human: '100 B',
      created: null,
      modified: '2026-01-31 21:00:00',
      accessed: null,
      is_readonly: false,
      permissions: 'rw-r--r--',
      is_binary: false,
      target_path: null,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-6',
      type: 'function',
      function: {
        name: 'get_file_info',
        arguments: JSON.stringify({ filePath: 'test.txt' }),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: 'D:\\' });

    expect(result.tool_call_id).toBe('test-6');
    expect(invoke).toHaveBeenCalledWith('get_file_info', {
      path: 'D:/test.txt',
    });
  });

  it('should handle errors from Rust backend via merged tool', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('无法获取文件元数据: Permission denied'));

    const toolCall: ToolCall = {
      id: 'test-7',
      type: 'function',
      function: {
        name: 'file_info',
        arguments: JSON.stringify({ action: 'info', path: 'D:\\protected\\file.txt' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-7');
    expect(result.error).toContain('无法获取文件元数据');
    expect(result.error).toContain('Permission denied');
  });

  it('should require path parameter', async () => {
    const toolCall: ToolCall = {
      id: 'test-8',
      type: 'function',
      function: {
        name: 'get_file_info',
        arguments: JSON.stringify({}),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-8');
    expect(result.error).toContain('缺少必需参数: path');
  });

  it('should show medium file without warning via merged tool', async () => {
    const mockResult = {
      path: 'D:\\data\\medium.json',
      exists: true,
      file_type: 'file',
      size_bytes: 5000000, // 5 MB
      size_human: '4.8 MB',
      created: '2026-01-20 10:00:00',
      modified: '2026-01-30 15:30:00',
      accessed: '2026-01-31 21:00:00',
      is_readonly: false,
      permissions: 'rw-r--r--',
      is_binary: false,
      target_path: null,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-9',
      type: 'function',
      function: {
        name: 'file_info',
        arguments: JSON.stringify({ action: 'info', path: 'D:\\data\\medium.json' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-9');
    expect(result.output).toContain('4.8 MB');
    expect(result.output).toContain('注意');
    expect(result.output).toContain('文件较大');
  });

  it('should detect binary files via merged tool', async () => {
    const mockResult = {
      path: 'D:\\app\\program.exe',
      exists: true,
      file_type: 'file',
      size_bytes: 2048000,
      size_human: '2.0 MB',
      created: '2026-01-20 10:00:00',
      modified: '2026-01-30 15:30:00',
      accessed: '2026-01-31 21:00:00',
      is_readonly: false,
      permissions: 'rwxr-xr-x',
      is_binary: true,
      target_path: null,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-10',
      type: 'function',
      function: {
        name: 'file_info',
        arguments: JSON.stringify({ action: 'info', path: 'D:\\app\\program.exe' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-10');
    expect(result.output).toContain('文件类型: 二进制文件');
    expect(result.output).toContain('警告: 这是二进制文件');
    expect(result.output).toContain('建议不要使用 read_file 直接读取内容');
  });

  it('should handle symlinks with target path', async () => {
    const mockResult = {
      path: 'D:\\project\\link',
      exists: true,
      file_type: 'symlink',
      size_bytes: 0,
      size_human: '0 B',
      created: '2026-01-20 10:00:00',
      modified: '2026-01-30 15:30:00',
      accessed: '2026-01-31 21:00:00',
      is_readonly: false,
      permissions: 'rwxr-xr-x',
      is_binary: false,
      target_path: 'D:\\project\\actual\\target',
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-11',
      type: 'function',
      function: {
        name: 'get_file_info',
        arguments: JSON.stringify({ path: 'D:\\project\\link' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-11');
    expect(result.output).toContain('类型: 符号链接');
    expect(result.output).toContain('指向: D:\\project\\actual\\target');
  });
});

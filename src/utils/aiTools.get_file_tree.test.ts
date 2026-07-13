import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AI_TOOLS, executeToolCall, type ToolCall } from '../features/agent-engine';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

describe('get_file_tree tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined in AI_TOOLS via file_info merged tool', () => {
    const tool = AI_TOOLS.find((t) => t.name === 'file_info');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('tree');
    expect(tool?.parameters.properties).toHaveProperty('action');
    expect(tool?.parameters.properties).toHaveProperty('root_path');
    expect(tool?.parameters.properties).toHaveProperty('max_depth');
    expect(tool?.parameters.properties).toHaveProperty('dirs_only');
  });

  it('should execute with default parameters', async () => {
    const mockResult = {
      root_path: 'D:\\project\\test',
      tree: '项目根目录: D:\\project\\test\n├── src/\n│   └── main.ts\n└── package.json\n\n总计: 1 个目录, 2 个文件',
      total_dirs: 1,
      total_files: 2,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-1',
      type: 'function',
      function: {
        name: 'get_file_tree',
        arguments: JSON.stringify({}),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: 'D:\\project\\test' });

    expect(result.tool_call_id).toBe('test-1');
    expect(result.output).toContain('项目根目录');
    expect(result.output).toContain('src/');
    expect(result.output).toContain('main.ts');
    expect(invoke).toHaveBeenCalledWith('get_file_tree', {
      rootPath: 'D:\\project\\test',
      maxDepth: 3,
      dirsOnly: false,
    });
  });

  it('should execute with custom max_depth', async () => {
    const mockResult = {
      root_path: 'D:\\project\\test',
      tree: '项目根目录: D:\\project\\test\n├── src/\n└── package.json\n\n总计: 1 个目录, 1 个文件',
      total_dirs: 1,
      total_files: 1,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-2',
      type: 'function',
      function: {
        name: 'get_file_tree',
        arguments: JSON.stringify({ max_depth: 2 }),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: 'D:\\project\\test' });

    expect(result.tool_call_id).toBe('test-2');
    expect(invoke).toHaveBeenCalledWith('get_file_tree', {
      rootPath: 'D:\\project\\test',
      maxDepth: 2,
      dirsOnly: false,
    });
  });

  it('should execute with dirs_only mode', async () => {
    const mockResult = {
      root_path: 'D:\\project\\test',
      tree: '项目根目录: D:\\project\\test\n├── src/\n└── public/\n\n总计: 2 个目录',
      total_dirs: 2,
      total_files: 0,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-3',
      type: 'function',
      function: {
        name: 'get_file_tree',
        arguments: JSON.stringify({ dirs_only: true }),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: 'D:\\project\\test' });

    expect(result.tool_call_id).toBe('test-3');
    expect(result.output).toContain('src/');
    expect(result.output).toContain('public/');
    expect(invoke).toHaveBeenCalledWith('get_file_tree', {
      rootPath: 'D:\\project\\test',
      maxDepth: 3,
      dirsOnly: true,
    });
  });

  it('should use explicit root_path if provided', async () => {
    const mockResult = {
      root_path: 'D:\\custom\\path',
      tree: '项目根目录: D:\\custom\\path\n└── file.txt\n\n总计: 0 个目录, 1 个文件',
      total_dirs: 0,
      total_files: 1,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-4',
      type: 'function',
      function: {
        name: 'get_file_tree',
        arguments: JSON.stringify({ root_path: 'D:\\custom\\path' }),
      },
    };

    const result = await executeToolCall(toolCall, { baseDir: 'D:\\project\\test' });

    expect(result.tool_call_id).toBe('test-4');
    expect(invoke).toHaveBeenCalledWith('get_file_tree', {
      rootPath: 'D:\\custom\\path',
      maxDepth: 3,
      dirsOnly: false,
    });
  });

  it('should return error message when no baseDir is available via merged tool', async () => {
    const toolCall: ToolCall = {
      id: 'test-5',
      type: 'function',
      function: {
        name: 'file_info',
        arguments: JSON.stringify({ action: 'tree' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-5');
    expect(result.error).toContain('请先打开一个文件夹');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('should handle errors from Rust backend', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('路径不存在: D:\\nonexistent'));

    const toolCall: ToolCall = {
      id: 'test-6',
      type: 'function',
      function: {
        name: 'get_file_tree',
        arguments: JSON.stringify({ root_path: 'D:\\nonexistent' }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-6');
    expect(result.error).toContain('无法获取文件树');
    expect(result.error).toContain('路径不存在');
  });

  it('should normalize parameter names (camelCase to snake_case)', async () => {
    const mockResult = {
      root_path: 'D:\\project\\test',
      tree: '项目根目录: D:\\project\\test\n└── file.txt\n\n总计: 0 个目录, 1 个文件',
      total_dirs: 0,
      total_files: 1,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-7',
      type: 'function',
      function: {
        name: 'get_file_tree',
        arguments: JSON.stringify({
          rootPath: 'D:\\project\\test',
          maxDepth: 5,
          dirsOnly: true,
        }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-7');
    expect(invoke).toHaveBeenCalledWith('get_file_tree', {
      rootPath: 'D:\\project\\test',
      maxDepth: 5,
      dirsOnly: true,
    });
  });

  it('should handle all parameter combinations', async () => {
    const mockResult = {
      root_path: 'D:\\project\\test',
      tree: '项目根目录: D:\\project\\test\n├── src/\n└── dist/\n\n总计: 2 个目录',
      total_dirs: 2,
      total_files: 0,
    };

    vi.mocked(invoke).mockResolvedValue(mockResult);

    const toolCall: ToolCall = {
      id: 'test-8',
      type: 'function',
      function: {
        name: 'get_file_tree',
        arguments: JSON.stringify({
          root_path: 'D:\\project\\test',
          max_depth: 4,
          dirs_only: true,
        }),
      },
    };

    const result = await executeToolCall(toolCall);

    expect(result.tool_call_id).toBe('test-8');
    expect(result.output).toBeDefined();
    expect(invoke).toHaveBeenCalledWith('get_file_tree', {
      rootPath: 'D:\\project\\test',
      maxDepth: 4,
      dirsOnly: true,
    });
  });
});

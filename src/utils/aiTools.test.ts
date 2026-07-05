import { beforeEach, expect, test, vi } from 'vitest';

import { executeToolCall } from './aiTools';
import type { ToolCall } from './aiTools';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

beforeEach(() => {
  invokeMock.mockReset();
});

test('read_file wraps args in req for tool command', async () => {
  invokeMock.mockResolvedValue({
    content: 'hello',
    truncated: false,
    is_binary: false,
    bytes_read: 5,
    lines_read: 1,
  });

  const toolCall: ToolCall = {
    id: 'tool-1',
    type: 'function',
    function: {
      name: 'read_file',
      arguments: JSON.stringify({
        path: 'D:/project/file.txt',
        start_line: 2,
        max_lines: 10,
        max_bytes: 2048,
      }),
    },
  };

  await executeToolCall(toolCall);

  expect(invokeMock).toHaveBeenCalledWith('read_file_content_tool', {
    req: {
      filePath: 'D:/project/file.txt',
      startLine: 2,
      maxLines: 10,
      maxBytes: 2048,
    },
    source: 'ai',
  });
});

test('apply_patch returns an unknown tool error', async () => {
  const toolCall: ToolCall = {
    id: 'tool-apply',
    type: 'function',
    function: {
      name: 'apply_patch',
      arguments: JSON.stringify({
        patch: '*** Begin Patch\n*** End Patch',
        base_dir: 'D:/proj',
      }),
    },
  };

  const result = await executeToolCall(toolCall, { baseDir: 'D:/proj' });

  expect(invokeMock).not.toHaveBeenCalledWith('apply_patch', expect.anything());
  expect(result.error).toContain('未知的工具');
});

test('search_files uses glob_search_files with baseDir', async () => {
  invokeMock.mockResolvedValue(['D:/proj/src/App.tsx', 'D:/proj/src/main.ts']);

  const toolCall: ToolCall = {
    id: 'tool-search-files',
    type: 'function',
    function: {
      name: 'search_files',
      arguments: JSON.stringify({ pattern: '**/*.ts' }),
    },
  };

  const result = await executeToolCall(toolCall, { baseDir: 'D:/proj' });

  expect(invokeMock).toHaveBeenCalledWith('glob_search_files', {
    rootPath: 'D:/proj',
    pattern: '**/*.ts',
    maxResults: 50,
    source: 'ai',
  });
  expect(result.output).toContain('D:/proj/src/App.tsx');
});

test('delete_file invokes delete_file_or_folder with root', async () => {
  invokeMock.mockResolvedValue(undefined);

  const toolCall: ToolCall = {
    id: 'tool-delete',
    type: 'function',
    function: {
      name: 'delete_file',
      arguments: JSON.stringify({ path: 'D:/proj/a.txt' }),
    },
  };

  const result = await executeToolCall(toolCall, { baseDir: 'D:/proj' });

  expect(invokeMock).toHaveBeenCalledWith('delete_file_or_folder', {
    path: 'D:/proj/a.txt',
    permanent: false,
    rootPath: 'D:/proj',
    opSource: 'ai',
  });
  expect(result.output).toContain('回收站');
  expect(result.files_changed).toEqual(['D:/proj/a.txt']);
});

test('create_folder uses project root for relative path', async () => {
  invokeMock.mockResolvedValue(undefined);

  const toolCall: ToolCall = {
    id: 'tool-create-folder',
    type: 'function',
    function: {
      name: 'create_folder',
      arguments: JSON.stringify({ path: 'test' }),
    },
  };

  const result = await executeToolCall(toolCall, { baseDir: 'D:/proj' });

  expect(invokeMock).toHaveBeenCalledWith('create_folder', {
    folderPath: 'D:/proj/test',
    source: 'ai',
  });
  expect(result.output).toContain('D:/proj/test');
  expect(result.files_changed).toEqual(['D:/proj/test']);
});

test('list_directory resolves relative path against baseDir and uses read_folder_children', async () => {
  invokeMock.mockResolvedValue([
    { name: 'src', path: 'D:/proj/test/src', is_dir: true },
    { name: 'a.txt', path: 'D:/proj/test/a.txt', is_dir: false },
  ]);

  const toolCall: ToolCall = {
    id: 'tool-list-dir',
    type: 'function',
    function: {
      name: 'list_directory',
      arguments: JSON.stringify({ path: 'test' }),
    },
  };

  const result = await executeToolCall(toolCall, { baseDir: 'D:/proj' });

  expect(invokeMock).toHaveBeenCalledWith('read_folder_children', {
    folderPath: 'D:/proj/test',
    source: 'ai',
  });
  expect(result.output).toContain('目录内容 (D:/proj/test)');
  expect(result.output).toContain('📁 src');
  expect(result.output).toContain('📄 a.txt');
});

test('get_file_info uses project root for relative path', async () => {
  invokeMock.mockResolvedValue({
    exists: true,
    path: 'D:/proj/test.txt',
    file_type: 'file',
    size_bytes: 12,
    size_human: '12 B',
    is_binary: false,
    is_readonly: false,
  });

  const toolCall: ToolCall = {
    id: 'tool-file-info',
    type: 'function',
    function: {
      name: 'get_file_info',
      arguments: JSON.stringify({ path: 'test.txt' }),
    },
  };

  const result = await executeToolCall(toolCall, { baseDir: 'D:/proj' });

  expect(invokeMock).toHaveBeenCalledWith('get_file_info', {
    path: 'D:/proj/test.txt',
    source: 'ai',
  });
  expect(result.output).toContain('D:/proj/test.txt');
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolHandler, hasToolHandler } from '../registry';
import { ReadFileHandler, EditFileHandler } from '../handlers/fileHandlersRuntime';
import { RunCommandHandler } from '../handlers/terminalHandlers';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../../browserController', () => ({
  browserController: {
    open: vi.fn(),
    navigate: vi.fn(),
    refresh: vi.fn(),
  },
}));



describe('ToolHandler Registry', () => {
  it('should register file handlers', () => {
    expect(hasToolHandler('read_file')).toBe(true);
    expect(hasToolHandler('edit_file')).toBe(true);
    expect(hasToolHandler('write_file')).toBe(true);
  });

  it('should register search handlers', () => {
    expect(hasToolHandler('search_files')).toBe(true);
    expect(hasToolHandler('search_content')).toBe(true);
    expect(hasToolHandler('list_directory')).toBe(true);
    expect(hasToolHandler('get_file_tree')).toBe(true);
    expect(hasToolHandler('get_file_info')).toBe(true);
    expect(hasToolHandler('create_folder')).toBe(true);
  });

  it('should register terminal handlers', () => {
    expect(hasToolHandler('run_command')).toBe(true);
    expect(hasToolHandler('read_terminal_output')).toBe(true);
  });

  it('should register git handlers', () => {
    expect(hasToolHandler('get_git_diff')).toBe(true);
    expect(hasToolHandler('undo_changes')).toBe(true);
    expect(hasToolHandler('get_symbol_definition')).toBe(true);
  });

  it('should register browser handlers', () => {
    expect(hasToolHandler('control_browser')).toBe(true);
    expect(hasToolHandler('fetch_web_content')).toBe(true);
  });

  it('should register file operation handlers', () => {
    expect(hasToolHandler('move_file')).toBe(true);
    expect(hasToolHandler('delete_file')).toBe(true);
  });

  it('should return correct handler instance', () => {
    const handler = getToolHandler('read_file');
    expect(handler).toBeInstanceOf(ReadFileHandler);
    expect(handler?.name).toBe('read');
  });
});

describe('ReadFileHandler', () => {
  let handler: ReadFileHandler;

  beforeEach(() => {
    handler = new ReadFileHandler();
    vi.clearAllMocks();
  });

  it('should have correct name', () => {
    expect(handler.name).toBe('read');
  });

  it('should return error when path is missing', async () => {
    const result = await handler.execute({} as { path: string });
    expect(result.error).toContain('缺少必需参数');
    expect(result.error).toContain('请重新调用 read_file');
    expect(result.error).toContain('{"path":"src/App.tsx"}');
  });
});

describe('EditFileHandler', () => {
  let handler: EditFileHandler;

  beforeEach(() => {
    handler = new EditFileHandler();
    vi.clearAllMocks();
  });

  it('should have correct name', () => {
    expect(handler.name).toBe('edit');
  });

  it('should return error when required params are missing', async () => {
    const result = await handler.execute({ path: '', old_string: '', new_string: '' });
    expect(result.error).toContain('缺少必需参数');
  });
});

describe('RunCommandHandler', () => {
  let handler: RunCommandHandler;

  beforeEach(() => {
    handler = new RunCommandHandler();
    vi.clearAllMocks();
  });

  it('suppresses successful output when quiet is enabled', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exit_code: 0,
      timed_out: false,
      duration_ms: 12,
    });

    const result = await handler.execute(
      { command: 'mkdir tmp-test', no_output_expected: true },
      { baseDir: '/test' }
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toBe('');
  });
});

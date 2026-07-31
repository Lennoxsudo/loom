import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolHandler, hasToolHandler } from '../registry';
import { ReadFileHandler, EditFileHandler } from '../handlers/fileHandlersRuntime';
import {
  RunCommandHandler,
  ReadTerminalOutputHandler,
  sliceStdoutSince,
  outputMatchesNotifyPattern,
  clampBlockUntilMs,
} from '../handlers/terminalHandlers';
import { invoke } from '@tauri-apps/api/core';

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
    expect(hasToolHandler('web_search')).toBe(true);
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

  it('passes clamped timeout to foreground execute_command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: 'ok',
      stderr: '',
      exit_code: 0,
      timed_out: false,
      duration_ms: 5,
    });

    await handler.execute({ command: 'echo ok', timeout: 45_000 }, { baseDir: '/test' });

    expect(invoke).toHaveBeenCalledWith(
      'execute_command',
      expect.objectContaining({ timeoutMs: 45_000 })
    );
  });
});

describe('read_output helpers', () => {
  it('slices stdout by since_bytes', () => {
    expect(sliceStdoutSince('abcdef', 3)).toEqual({
      text: 'def',
      nextSinceBytes: 6,
      appliedSince: 3,
    });
    expect(sliceStdoutSince('abc', 99).text).toBe('');
    expect(sliceStdoutSince('abc', undefined).text).toBe('abc');
  });

  it('matches notify patterns and ignores invalid regex', () => {
    expect(outputMatchesNotifyPattern('ready on :3000', '', 'ready on')).toBe(true);
    expect(outputMatchesNotifyPattern('', 'err: fail', 'fail')).toBe(true);
    expect(outputMatchesNotifyPattern('ok', '', '[')).toBe(false);
    expect(outputMatchesNotifyPattern('ok', '', undefined)).toBe(false);
  });

  it('clamps block_until_ms', () => {
    expect(clampBlockUntilMs(undefined)).toBe(0);
    expect(clampBlockUntilMs(0)).toBe(0);
    expect(clampBlockUntilMs(1_000)).toBe(1_000);
    expect(clampBlockUntilMs(999_999)).toBe(600_000);
  });
});

describe('ReadTerminalOutputHandler', () => {
  let handler: ReadTerminalOutputHandler;

  beforeEach(() => {
    handler = new ReadTerminalOutputHandler();
    vi.clearAllMocks();
  });

  it('returns incremental stdout and next-since-bytes', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: 'hello world',
      stderr: '',
      completed: true,
      exit_code: 0,
      duration_ms: 10,
    });

    const result = await handler.execute({ terminal_id: 'bg1', since_bytes: 6 });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('world');
    expect(result.output).not.toContain('hello');
    expect(result.output).toContain('<next-since-bytes>11</next-since-bytes>');
  });

  it('returns early when notify_on_output matches while waiting', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        stdout: 'starting',
        stderr: '',
        completed: false,
        exit_code: null,
        duration_ms: null,
      })
      .mockResolvedValueOnce({
        stdout: 'starting\nServer ready',
        stderr: '',
        completed: false,
        exit_code: null,
        duration_ms: null,
      });

    const result = await handler.execute({
      terminal_id: 'bg2',
      block_until_ms: 5_000,
      notify_on_output: 'Server ready',
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('matched notify_on_output');
    expect(result.output).toContain('<matched-pattern>true</matched-pattern>');
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

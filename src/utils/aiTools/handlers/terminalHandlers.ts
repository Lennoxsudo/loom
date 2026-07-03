import type { ToolResult, ExecuteCommandResult, ExecuteCommandBgResult, CheckBackgroundCommandResult, BackgroundTaskSummary } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { RunCommandArgs, ReadTerminalOutputArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { resolvePathWithBaseDir } from '../argsParser';
import { normalizeTerminalTextOutput } from '../terminalText';
import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Constants (matching claude-code's BashTool thresholds)
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;   // 前台命令默认 30s 超时，超时后自动转为后台执行
const MAX_TIMEOUT_MS = 600_000;
const FOREGROUND_HARD_TIMEOUT_MS = 35_000; // 前端硬超时兜底（30s Rust 超时 + 5s 缓冲）

const MAX_INLINE_OUTPUT_CHARS = 30_000;  // claude-code: BASH_MAX_OUTPUT_DEFAULT

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampTimeout(ms: number | undefined): number {
  if (ms === undefined || ms <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(ms, MAX_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Output formatting (claude-code mapToolResultToToolResultBlockParam style)
// ---------------------------------------------------------------------------

interface CommandResult {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  timedOut: boolean;
  exitCode: number | null;
  durationMs: number;
}

function formatCommandResult(
  result: CommandResult,
  options?: { stripAnsi?: boolean; projectPath?: string }
): string {
  const parts: string[] = [];

  // 1. Process stdout
  let processedStdout = normalizeTerminalTextOutput(result.stdout, {
    stripAnsi: options?.stripAnsi,
  }).replace(/^(\s*\n)+/, '').trimEnd();

  // 2. If stdout is too large for inline, persist it
  if (processedStdout.length > MAX_INLINE_OUTPUT_CHARS) {
    const truncated = processedStdout.substring(0, MAX_INLINE_OUTPUT_CHARS);
    const totalLines = processedStdout.split('\n').length;
    const shownLines = truncated.split('\n').length;
    processedStdout = `${truncated}\n\n... [${totalLines - shownLines} lines truncated] ...`;
  }

  if (processedStdout) {
    parts.push(processedStdout);
  }

  // 3. Build error message from stderr + interrupted
  let errorMessage = result.stderr.trim();
  if (result.interrupted) {
    if (errorMessage) errorMessage += '\n';
    errorMessage += '<error>Command was aborted before completion</error>';
  }
  if (result.timedOut && !result.interrupted) {
    if (errorMessage) errorMessage += '\n';
    errorMessage += '<error>Command timed out before completion</error>';
  }
  if (errorMessage) {
    parts.push(errorMessage);
  }

  return parts.join('\n');
}

function formatStructuredMeta(result: CommandResult): string {
  const parts: string[] = [];
  parts.push(`<exit-code>${result.exitCode ?? 'null'}</exit-code>`);
  parts.push(`<duration>${result.durationMs}ms</duration>`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export class RunCommandHandler implements ToolHandler<'run_command'> {
  name = 'run_command' as const;

  async execute(args: RunCommandArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!args.command && !args.script) {
        throw ToolError.missingParam('command');
      }

      const workingDir = args.working_dir
        ? resolvePathWithBaseDir(args.working_dir, context?.baseDir)
        : context?.baseDir;

      const timeoutMs = clampTimeout(args.timeout);
      const isBackground = args.run_in_background === true;
      const noOutputExpected = args.no_output_expected === true;

      // -----------------------------------------------------------------------
      // Background path: execute_command_bg
      // -----------------------------------------------------------------------
      if (isBackground) {
        const bgResult = await invoke<ExecuteCommandBgResult>('execute_command_bg', {
          command: args.script || args.command,
          workingDir: workingDir || undefined,
          timeoutMs,
          shell: args.shell || undefined,
        });

        return {
          tool_call_id: '',
          output: `Command running in background with task ID: ${bgResult.task_id}. Use action=read_output with tid=${bgResult.task_id} to check output.`,
        };
      }

      // -----------------------------------------------------------------------
      // Foreground path: execute_command — 始终用 DEFAULT_TIMEOUT_MS
      // AI 传的 timeout 参数只用于后台命令；前台固定 30s 超时自动转后台。
      // 用 Promise.race 加前端硬超时兜底，避免 Rust 侧 child.kill 不生效时永远挂起。
      // -----------------------------------------------------------------------
      const invokePromise = invoke<ExecuteCommandResult>('execute_command', {
        command: args.script || args.command,
        workingDir: workingDir || undefined,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        shell: args.shell || undefined,
        maxLines: args.max_lines || undefined,
        script: args.script || undefined,
        noOutputExpected: noOutputExpected || undefined,
        streamId: context?.toolCallId || undefined,
      });

      type ForegroundResult =
        | { kind: 'ok'; value: ExecuteCommandResult }
        | { kind: 'timeout' };

      const raced = await Promise.race<ForegroundResult>([
        invokePromise.then((value) => ({ kind: 'ok' as const, value })),
        new Promise<ForegroundResult>((resolve) =>
          setTimeout(() => resolve({ kind: 'timeout' }), FOREGROUND_HARD_TIMEOUT_MS),
        ),
      ]);

      // ── 前端硬超时兜底 ──────────────────────────────────────────────
      // Rust 侧的 30s 超时可能因 Windows 子进程链无法 kill 而失效，
      // 前端在 35s 后直接接管：不等待 Rust 返回，直接后台执行。
      if (raced.kind === 'timeout') {
        let bgTaskId = '';
        try {
          const bgResult = await invoke<ExecuteCommandBgResult>('execute_command_bg', {
            command: args.script || args.command,
            workingDir: workingDir || undefined,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            shell: args.shell || undefined,
          });
          bgTaskId = bgResult.task_id;
        } catch {
          // 后台启动失败，返回无输出结果
        }

        return {
          tool_call_id: '',
          output:
            `Command timed out after ${(DEFAULT_TIMEOUT_MS / 1000).toFixed(0)}s ` +
            (bgTaskId
              ? `and was automatically moved to background.\n\n` +
                `To check progress later, use action=read_output with tid=${bgTaskId}.\n` +
                `To stop it, use action=kill with tid=${bgTaskId}.`
              : `and could not be continued in background.`),
        };
      }

      const result = raced.value;

      // ── Rust 侧超时自动切换后台 ──────────────────────────────────────
      if (result.timed_out) {
        try {
          const bgResult = await invoke<ExecuteCommandBgResult>('execute_command_bg', {
            command: args.script || args.command,
            workingDir: workingDir || undefined,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            shell: args.shell || undefined,
          });

          return {
            tool_call_id: '',
            output:
              `Command timed out after ${(DEFAULT_TIMEOUT_MS / 1000).toFixed(0)}s ` +
              `and was automatically moved to background.\n\n` +
              `To check progress later, use action=read_output with tid=${bgResult.task_id}.\n` +
              `To stop it, use action=kill with tid=${bgResult.task_id}.\n\n` +
              `Partial output before timeout:\n` +
              result.stdout.trim(),
          };
        } catch {
          // 后台启动也失败：退回标准超时结果
          const cmdResult: CommandResult = {
            stdout: result.stdout,
            stderr: result.stderr,
            interrupted: false,
            timedOut: true,
            exitCode: result.exit_code,
            durationMs: result.duration_ms,
          };

          let output = formatCommandResult(cmdResult, {
            stripAnsi: args.strip_ansi,
            projectPath: context?.baseDir,
          });

          output += '\n' + formatStructuredMeta(cmdResult);
          output += '\n\nCommand timed out. To run long commands in background, set run_in_background=true and check output with action=read_output.';

          return { tool_call_id: '', output };
        }
      }

      // ── 正常完成 ─────────────────────────────────────────────────────
      const cmdResult: CommandResult = {
        stdout: result.stdout,
        stderr: result.stderr,
        interrupted: false,
        timedOut: false,
        exitCode: result.exit_code,
        durationMs: result.duration_ms,
      };

      if (noOutputExpected) {
        const failed = cmdResult.exitCode != null && cmdResult.exitCode !== 0;
        if (!failed) {
          return { tool_call_id: '', output: '' };
        }
      }

      let output = formatCommandResult(cmdResult, {
        stripAnsi: args.strip_ansi,
        projectPath: context?.baseDir,
      });

      output += '\n' + formatStructuredMeta(cmdResult);

      return { tool_call_id: '', output };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

class ReadTerminalOutputHandler implements ToolHandler<'read_terminal_output'> {
  name = 'read_terminal_output' as const;

  async execute(args: ReadTerminalOutputArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const tid = args.terminal_id;

      if (!tid) {
        return {
          tool_call_id: '',
          output: '',
          error: 'No terminal_id (tid) specified. Provide the task ID returned by a background command.',
        };
      }

      const bgResult = await invoke<CheckBackgroundCommandResult>('check_background_command', {
        taskId: tid,
      });

      const cmdResult: CommandResult = {
        stdout: bgResult.stdout,
        stderr: bgResult.stderr,
        interrupted: false,
        timedOut: false,
        exitCode: bgResult.exit_code,
        durationMs: bgResult.duration_ms ?? 0,
      };

      const prefix = bgResult.completed
        ? 'Background command completed.\n\n'
        : 'Background command still running.\n\n';

      let output = prefix + formatCommandResult(cmdResult, {
        projectPath: context?.baseDir,
      });

      output += '\n' + formatStructuredMeta(cmdResult);

      return { tool_call_id: '', output };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

class ListBgTasksHandler implements ToolHandler<'list_bg_tasks'> {
  name = 'list_bg_tasks' as const;

  async execute(_args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    try {
      const tasks = await invoke<BackgroundTaskSummary[]>('list_background_commands');

      if (tasks.length === 0) {
        return { tool_call_id: '', output: 'No background tasks.' };
      }

      const lines = tasks.map(t => {
        const status = t.completed ? 'completed' : 'running';
        const exitCode = t.exit_code != null ? ` exit=${t.exit_code}` : '';
        const duration = t.duration_ms != null ? ` ${t.duration_ms}ms` : '';
        return `- ${t.task_id}: "${t.command}" [${status}${exitCode}${duration}] pid=${t.pid}`;
      });

      return { tool_call_id: '', output: `Background tasks:\n${lines.join('\n')}` };
    } catch (error) {
      return handleToolError(error);
    }
  }
}

class KillBgTaskHandler implements ToolHandler<'kill_bg_task'> {
  name = 'kill_bg_task' as const;

  async execute(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    try {
      const tid = args.terminal_id as string | undefined;

      if (!tid) {
        return {
          tool_call_id: '',
          output: '',
          error: 'No terminal_id (tid) specified. Provide the task ID of the background task to kill.',
        };
      }

      await invoke<void>('kill_background_command', { taskId: tid });

      return { tool_call_id: '', output: `Background task ${tid} has been terminated.` };
    } catch (error) {
      return handleToolError(error);
    }
  }
}

export const terminalHandlers: ToolHandler[] = [
  new RunCommandHandler(),
  new ReadTerminalOutputHandler(),
  new ListBgTasksHandler(),
  new KillBgTaskHandler(),
];

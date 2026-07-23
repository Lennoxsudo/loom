import { normalizeTerminalTextOutput } from '../features/agent-engine/terminalText';

export type ParsedCommandExec = {
  command: string;
  workingDir?: string;
  output: string;
  exitCode: number | null;
  durationMs: number | null;
  timedOut: boolean;
  isBackgroundStart: boolean;
  errorMessage?: string;
};

const BACKGROUND_START_RE = /^Command running in background with task ID:\s*\S+/;

const EXIT_CODE_RE = /<exit-code>(-?\d+|null)<\/exit-code>/;
const DURATION_RE = /<duration>(\d+)ms<\/duration>/;
const ERROR_RE = /<error>([\s\S]*?)<\/error>/g;

function readCommandFromArgs(toolArgs?: Record<string, unknown>): string {
  if (!toolArgs) return 'command';
  const command = toolArgs.command;
  if (typeof command === 'string' && command.trim()) return command.trim();
  const script = toolArgs.script;
  if (typeof script === 'string' && script.trim()) return script.trim();
  return 'command';
}

function readWorkingDir(toolArgs?: Record<string, unknown>): string | undefined {
  if (!toolArgs) return undefined;
  const cwd = toolArgs.working_dir ?? toolArgs.cwd;
  return typeof cwd === 'string' && cwd.trim() ? cwd.trim() : undefined;
}

function stripMetaTags(text: string): string {
  return text
    .replace(EXIT_CODE_RE, '')
    .replace(DURATION_RE, '')
    .replace(ERROR_RE, '')
    .replace(
      /\n\nTo run long commands in background, set run_in_background=true and check output with action=read_output\.\s*$/i,
      ''
    )
    .trim();
}

function extractErrorMessage(text: string): string | undefined {
  const errors: string[] = [];
  for (const match of text.matchAll(ERROR_RE)) {
    const body = match[1]?.trim();
    if (body) errors.push(body);
  }
  return errors.length > 0 ? errors.join('\n') : undefined;
}

function parseExitCode(text: string): number | null {
  const match = text.match(EXIT_CODE_RE);
  if (!match) return null;
  if (match[1] === 'null') return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseDurationMs(text: string): number | null {
  const match = text.match(DURATION_RE);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseCommandExecOutput(
  text: string,
  toolArgs?: Record<string, unknown>,
  options?: { isRunning?: boolean }
): ParsedCommandExec {
  const rawText = text ?? '';
  const command = readCommandFromArgs(toolArgs);
  const workingDir = readWorkingDir(toolArgs);
  const isBackgroundStart = BACKGROUND_START_RE.test(rawText.trim());

  if (isBackgroundStart) {
    return {
      command,
      workingDir,
      output: rawText.trim(),
      exitCode: null,
      durationMs: null,
      timedOut: false,
      isBackgroundStart: true,
    };
  }

  const errorMessage = extractErrorMessage(rawText);
  const timedOut =
    errorMessage?.includes('Command timed out before completion') === true ||
    rawText.includes('Command timed out before completion');

  const exitCode = options?.isRunning ? null : parseExitCode(rawText);
  const durationMs = options?.isRunning ? null : parseDurationMs(rawText);

  let output = stripMetaTags(rawText);
  if (output) {
    output = normalizeTerminalTextOutput(output, { stripAnsi: true });
  }

  return {
    command,
    workingDir,
    output,
    exitCode,
    durationMs,
    timedOut,
    isBackgroundStart: false,
    errorMessage,
  };
}

export function isRunCommandToolName(name?: string, args?: Record<string, unknown>): boolean {
  if (!name) return false;
  if (name === 'run_command' || name === 'terminal') return true;
  if (name === 'term') {
    const action = args?.action;
    if (action === undefined || action === null || action === '') return true;
    return action === 'run';
  }
  return false;
}

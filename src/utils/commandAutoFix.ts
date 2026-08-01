/**
 * Rule-based terminal command auto-fix (P0).
 * Suggests a safe rewrite (caller may retry once) or a hint for the model.
 */

export type AutoFixPlatform = 'win32' | 'darwin' | 'linux' | 'unknown';

export type CommandFailureContext = {
  command: string;
  shell?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  platform: AutoFixPlatform;
};

export type AutoFixResult =
  | { kind: 'rewrite'; command: string; reason: string }
  | { kind: 'hint'; hint: string }
  | null;

const PS_UNIX_MAP: Record<string, string> = {
  ls: 'Get-ChildItem',
  cat: 'Get-Content',
  rm: 'Remove-Item',
  which: 'Get-Command',
};

const CMD_UNIX_MAP: Record<string, string> = {
  ls: 'dir',
  cat: 'type',
  rm: 'del',
  which: 'where',
};

const TOKEN_INVALID_RE =
  /The token '(&&|\|\|)' is not a valid statement separator|Token '(&&|\|\|)'|Unexpected token '(&&|\|\|)'/i;

const COMMAND_NOT_FOUND_RE =
  /is not recognized as (an internal or external command|a cmdlet|the name of a cmdlet)|CommandNotFoundException|command not found|not found \(os error 2\)/i;

const PATH_NOT_FOUND_RE =
  /cannot find (the )?path|ENOENT|The system cannot find the (path|file) specified|No such file or directory/i;

export function detectAutoFixPlatform(): AutoFixPlatform {
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('windows')) return 'win32';
    if (ua.includes('mac')) return 'darwin';
    if (ua.includes('linux') || ua.includes('xdg')) return 'linux';
  }
  return 'unknown';
}

function combinedOutput(ctx: CommandFailureContext): string {
  return `${ctx.stdout}\n${ctx.stderr}`;
}

function shellKind(shell?: string): 'powershell' | 'cmd' | 'bash' | 'other' {
  const s = (shell ?? '').trim().toLowerCase();
  if (!s) return 'powershell'; // Windows default; Unix paths skip Windows rewrites via platform check
  if (s.includes('powershell') || s === 'pwsh') return 'powershell';
  if (s === 'cmd' || s.includes('cmd.exe')) return 'cmd';
  if (s.includes('bash') || s.includes('zsh') || s.includes('sh')) return 'bash';
  return 'other';
}

function splitSimpleTokens(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function hasUnsafeShellOps(command: string): boolean {
  return /[|;&`]/.test(command) || command.includes('&&') || command.includes('||');
}

function rewriteWindowsUnixCommand(
  command: string,
  shell: string | undefined
): AutoFixResult {
  const kind = shellKind(shell);
  if (kind === 'bash') return null;

  const tokens = splitSimpleTokens(command);
  if (tokens.length === 0 || hasUnsafeShellOps(command)) return null;

  const head = tokens[0].toLowerCase();
  const rest = tokens.slice(1);

  if (head === 'touch') {
    if (rest.length !== 1 || rest[0].startsWith('-')) return null;
    if (kind === 'cmd') {
      return {
        kind: 'rewrite',
        command: `type nul > "${rest[0].replace(/"/g, '')}"`,
        reason: 'Windows cmd does not have touch; create empty file via redirection',
      };
    }
    return {
      kind: 'rewrite',
      command: `New-Item -ItemType File -Force -Path ${rest[0]}`,
      reason: 'Windows PowerShell does not have touch; use New-Item',
    };
  }

  if (head === 'head') {
    if (rest.length !== 1 || rest[0].startsWith('-')) return null;
    if (kind === 'cmd') return null;
    return {
      kind: 'rewrite',
      command: `Get-Content ${rest[0]} -TotalCount 10`,
      reason: 'Windows PowerShell does not have head; use Get-Content -TotalCount',
    };
  }

  if (head === 'tail') {
    if (rest.length !== 1 || rest[0].startsWith('-')) return null;
    if (kind === 'cmd') return null;
    return {
      kind: 'rewrite',
      command: `Get-Content ${rest[0]} -Tail 10`,
      reason: 'Windows PowerShell does not have tail; use Get-Content -Tail',
    };
  }

  const map = kind === 'cmd' ? CMD_UNIX_MAP : PS_UNIX_MAP;
  const replacement = map[head];
  if (!replacement) return null;

  const rewritten = [replacement, ...rest].join(' ');
  if (rewritten === command) return null;

  return {
    kind: 'rewrite',
    command: rewritten,
    reason: `Windows ${kind === 'cmd' ? 'cmd' : 'PowerShell'} does not have '${head}'; use ${replacement}`,
  };
}

function rewritePowerShellChainAsCmd(command: string): AutoFixResult {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (/^\s*cmd(\.exe)?\s+\/c\b/i.test(trimmed)) return null;
  if (!trimmed.includes('&&') && !trimmed.includes('||')) return null;

  const escaped = trimmed.replace(/"/g, '\\"');
  return {
    kind: 'rewrite',
    command: `cmd /c "${escaped}"`,
    reason: 'PowerShell rejected &&/||; retry via cmd /c',
  };
}

function hintForCommandNotFound(command: string, output: string): AutoFixResult {
  const tokens = splitSimpleTokens(command);
  const bin = tokens[0] ?? command;
  const lower = bin.toLowerCase();

  if (['npm', 'pnpm', 'yarn', 'npx', 'node'].includes(lower)) {
    return {
      kind: 'hint',
      hint:
        `'${bin}' was not found on PATH. Install Node.js / the package manager, ` +
        `or use a full path. For one-off CLIs prefer npx <pkg> when appropriate.`,
    };
  }

  if (['cargo', 'rustc'].includes(lower)) {
    return {
      kind: 'hint',
      hint: `'${bin}' was not found on PATH. Install Rust (rustup) or open a shell where cargo is available.`,
    };
  }

  if (COMMAND_NOT_FOUND_RE.test(output)) {
    return {
      kind: 'hint',
      hint:
        `Command '${bin}' was not found. Check spelling/PATH, use an absolute path, ` +
        `or run via npx/package.json scripts if it is a JS CLI.`,
    };
  }

  return null;
}

/**
 * Suggest a rewrite (safe to auto-retry once) or a hint for the model.
 * Returns null when no rule matches.
 */
export function suggestCommandAutoFix(ctx: CommandFailureContext): AutoFixResult {
  const command = ctx.command?.trim() ?? '';
  if (!command) return null;
  if (ctx.exitCode == null || ctx.exitCode === 0) return null;

  const output = combinedOutput(ctx);
  const isWin = ctx.platform === 'win32';

  if (isWin && TOKEN_INVALID_RE.test(output)) {
    const fix = rewritePowerShellChainAsCmd(command);
    if (fix) return fix;
  }

  if (isWin && shellKind(ctx.shell) !== 'bash') {
    // Prefer unix-cmd rewrite when the failure looks like command-not-found for that cmd,
    // or always try when first token is a known unix alias (even if stderr is generic).
    const tokens = splitSimpleTokens(command);
    const head = tokens[0]?.toLowerCase();
    const unixHeads = new Set([
      'ls',
      'cat',
      'rm',
      'touch',
      'which',
      'head',
      'tail',
    ]);
    if (head && unixHeads.has(head)) {
      const fix = rewriteWindowsUnixCommand(command, ctx.shell);
      if (fix) return fix;
    }
  }

  if (COMMAND_NOT_FOUND_RE.test(output)) {
    const hint = hintForCommandNotFound(command, output);
    if (hint) return hint;
  }

  if (PATH_NOT_FOUND_RE.test(output)) {
    return {
      kind: 'hint',
      hint:
        'Path not found. Verify the path exists and pass the correct cwd / working_dir ' +
        '(relative paths are resolved from the project root).',
    };
  }

  return null;
}

export function formatAutoFixHint(hint: string): string {
  return `<auto-fix-hint>${hint}</auto-fix-hint>`;
}

export function formatAutoRetryNote(reason: string, retryCommand: string): string {
  return `(auto-retried after: ${reason})\n(auto-retry command: ${retryCommand})`;
}

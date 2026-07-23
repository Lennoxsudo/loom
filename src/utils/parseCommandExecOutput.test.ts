import { describe, it, expect } from 'vitest';
import { isRunCommandToolName, parseCommandExecOutput } from './parseCommandExecOutput';

describe('parseCommandExecOutput', () => {
  it('parses exit code and duration from structured meta', () => {
    const result = parseCommandExecOutput(
      'hello\nworld\n<exit-code>0</exit-code>\n<duration>42ms</duration>',
      { command: 'echo hello' }
    );
    expect(result.command).toBe('echo hello');
    expect(result.output).toBe('hello\nworld');
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it('parses nonzero exit code', () => {
    const result = parseCommandExecOutput(
      'err\n<error>failed</error>\n<exit-code>1</exit-code>\n<duration>120ms</duration>',
      { command: 'npm test' }
    );
    expect(result.exitCode).toBe(1);
    expect(result.durationMs).toBe(120);
    expect(result.errorMessage).toBe('failed');
  });

  it('gracefully degrades when meta tags are missing', () => {
    const result = parseCommandExecOutput('plain output', { command: 'ls' });
    expect(result.output).toBe('plain output');
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeNull();
  });

  it('detects background start message', () => {
    const result = parseCommandExecOutput(
      'Command running in background with task ID: bg0. Use action=read_output with tid=bg0 to check output.',
      { command: 'npm run dev' }
    );
    expect(result.isBackgroundStart).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('returns null exit/duration while running', () => {
    const result = parseCommandExecOutput(
      'partial\noutput',
      { command: 'sleep 1' },
      { isRunning: true }
    );
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeNull();
  });

  it('reads script and working_dir from args', () => {
    const result = parseCommandExecOutput('', {
      script: 'echo hi',
      working_dir: '/tmp',
    });
    expect(result.command).toBe('echo hi');
    expect(result.workingDir).toBe('/tmp');
  });
});

describe('isRunCommandToolName', () => {
  it('matches run_command and terminal', () => {
    expect(isRunCommandToolName('run_command')).toBe(true);
    expect(isRunCommandToolName('terminal')).toBe(true);
  });

  it('matches term only for run action', () => {
    expect(isRunCommandToolName('term', { action: 'run' })).toBe(true);
    expect(isRunCommandToolName('term', {})).toBe(true);
    expect(isRunCommandToolName('term', { action: 'read_output' })).toBe(false);
  });
});

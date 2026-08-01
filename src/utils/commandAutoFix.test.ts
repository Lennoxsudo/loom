import { describe, expect, it } from 'vitest';
import {
  formatAutoFixHint,
  formatAutoRetryNote,
  suggestCommandAutoFix,
} from './commandAutoFix';

describe('suggestCommandAutoFix', () => {
  it('rewrites ls to Get-ChildItem on Windows PowerShell', () => {
    const fix = suggestCommandAutoFix({
      command: 'ls src',
      stdout: '',
      stderr: "ls : The term 'ls' is not recognized as the name of a cmdlet",
      exitCode: 1,
      platform: 'win32',
    });
    expect(fix).toEqual({
      kind: 'rewrite',
      command: 'Get-ChildItem src',
      reason: expect.stringContaining('Get-ChildItem'),
    });
  });

  it('rewrites cat/rm/which with PowerShell cmdlets', () => {
    expect(
      suggestCommandAutoFix({
        command: 'cat README.md',
        stdout: '',
        stderr: 'not recognized',
        exitCode: 1,
        platform: 'win32',
      })
    ).toMatchObject({ kind: 'rewrite', command: 'Get-Content README.md' });

    expect(
      suggestCommandAutoFix({
        command: 'rm tmp.txt',
        stdout: '',
        stderr: 'not recognized',
        exitCode: 1,
        platform: 'win32',
      })
    ).toMatchObject({ kind: 'rewrite', command: 'Remove-Item tmp.txt' });

    expect(
      suggestCommandAutoFix({
        command: 'which node',
        stdout: '',
        stderr: 'not recognized',
        exitCode: 1,
        platform: 'win32',
      })
    ).toMatchObject({ kind: 'rewrite', command: 'Get-Command node' });
  });

  it('rewrites simple head/tail/touch on Windows', () => {
    expect(
      suggestCommandAutoFix({
        command: 'head notes.txt',
        stdout: '',
        stderr: 'not recognized',
        exitCode: 1,
        platform: 'win32',
      })
    ).toMatchObject({
      kind: 'rewrite',
      command: 'Get-Content notes.txt -TotalCount 10',
    });

    expect(
      suggestCommandAutoFix({
        command: 'tail notes.txt',
        stdout: '',
        stderr: 'not recognized',
        exitCode: 1,
        platform: 'win32',
      })
    ).toMatchObject({ kind: 'rewrite', command: 'Get-Content notes.txt -Tail 10' });

    expect(
      suggestCommandAutoFix({
        command: 'touch new.txt',
        stdout: '',
        stderr: 'not recognized',
        exitCode: 1,
        platform: 'win32',
      })
    ).toMatchObject({
      kind: 'rewrite',
      command: 'New-Item -ItemType File -Force -Path new.txt',
    });
  });

  it('uses cmd mappings when shell is cmd', () => {
    expect(
      suggestCommandAutoFix({
        command: 'ls',
        shell: 'cmd',
        stdout: '',
        stderr: "'ls' is not recognized as an internal or external command",
        exitCode: 1,
        platform: 'win32',
      })
    ).toMatchObject({ kind: 'rewrite', command: 'dir' });
  });

  it('does not rewrite unix aliases when shell is bash', () => {
    expect(
      suggestCommandAutoFix({
        command: 'ls',
        shell: 'bash',
        stdout: '',
        stderr: 'ls: command not found',
        exitCode: 127,
        platform: 'win32',
      })
    ).toMatchObject({ kind: 'hint' });
  });

  it('rewrites && chain to cmd /c when PowerShell rejects the token', () => {
    const fix = suggestCommandAutoFix({
      command: 'echo a && echo b',
      stdout: '',
      stderr: "The token '&&' is not a valid statement separator in this version.",
      exitCode: 1,
      platform: 'win32',
    });
    expect(fix).toEqual({
      kind: 'rewrite',
      command: 'cmd /c "echo a && echo b"',
      reason: expect.stringContaining('cmd /c'),
    });
  });

  it('hints on command-not-found without rewrite', () => {
    const fix = suggestCommandAutoFix({
      command: 'foobarbaz --help',
      stdout: '',
      stderr: "'foobarbaz' is not recognized as an internal or external command",
      exitCode: 1,
      platform: 'win32',
    });
    expect(fix?.kind).toBe('hint');
    if (fix?.kind === 'hint') {
      expect(fix.hint).toContain('foobarbaz');
      expect(fix.hint).toContain('PATH');
    }
  });

  it('hints when npm is missing', () => {
    const fix = suggestCommandAutoFix({
      command: 'npm test',
      stdout: '',
      stderr: "'npm' is not recognized as an internal or external command",
      exitCode: 1,
      platform: 'win32',
    });
    expect(fix?.kind).toBe('hint');
    if (fix?.kind === 'hint') {
      expect(fix.hint).toMatch(/Node\.js|package manager/i);
    }
  });

  it('hints on path-not-found', () => {
    const fix = suggestCommandAutoFix({
      command: 'Get-Content missing.txt',
      stdout: '',
      stderr: 'Cannot find path because it does not exist.',
      exitCode: 1,
      platform: 'win32',
    });
    expect(fix).toMatchObject({
      kind: 'hint',
      hint: expect.stringContaining('working_dir'),
    });
  });

  it('returns null on success or unknown failures', () => {
    expect(
      suggestCommandAutoFix({
        command: 'echo ok',
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        platform: 'win32',
      })
    ).toBeNull();

    expect(
      suggestCommandAutoFix({
        command: 'exit 2',
        stdout: '',
        stderr: 'some obscure failure',
        exitCode: 2,
        platform: 'win32',
      })
    ).toBeNull();
  });

  it('does not rewrite unix commands on non-Windows', () => {
    expect(
      suggestCommandAutoFix({
        command: 'ls',
        stdout: '',
        stderr: 'ls: command not found',
        exitCode: 127,
        platform: 'linux',
      })
    ).toMatchObject({ kind: 'hint' });
  });
});

describe('format helpers', () => {
  it('formats hint and retry notes', () => {
    expect(formatAutoFixHint('check PATH')).toBe('<auto-fix-hint>check PATH</auto-fix-hint>');
    expect(formatAutoRetryNote('use Get-ChildItem', 'Get-ChildItem')).toContain(
      'auto-retried after: use Get-ChildItem'
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildWindowsReservedDeleteCommand,
  extractInvalidPathNames,
  formatFriendlyGitError,
  isWindowsReservedFilename,
} from './friendlyGitError';

const gitI18n = {
  invalidPathReservedNames:
    'Git cannot add Windows reserved name "{names}". Delete the file and retry.',
};

describe('friendlyGitError', () => {
  it('detects Windows reserved filenames', () => {
    expect(isWindowsReservedFilename('nul')).toBe(true);
    expect(isWindowsReservedFilename('NUL.txt')).toBe(true);
    expect(isWindowsReservedFilename('src/foo.ts')).toBe(false);
  });

  it('formats invalid path git errors', () => {
    const raw = "error: invalid path 'nul'\nerror: unable to add 'nul' to index";
    expect(formatFriendlyGitError(raw, gitI18n)).toContain('nul');
    expect(formatFriendlyGitError(raw, gitI18n)).not.toContain('unable to add');
  });

  it('extracts invalid path names from git output', () => {
    expect(extractInvalidPathNames("error: invalid path 'nul'")).toEqual(['nul']);
  });

  it('builds extended-length delete command', () => {
    expect(buildWindowsReservedDeleteCommand('D:\\demo-repo', 'nul')).toBe(
      'del \\\\?\\D:\\demo-repo\\nul'
    );
  });
});

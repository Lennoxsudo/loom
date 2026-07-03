import { describe, expect, it } from 'vitest';
import {
  appendGitignoreRule,
  gitignoreAlreadyHasRule,
  isUnsafeGitignoreRelativePath,
  normalizePathForGitignore,
} from './gitignorePathUtils';

describe('gitignorePathUtils', () => {
  it('normalizes slashes and trims leading slashes', () => {
    expect(normalizePathForGitignore('\\dist\\')).toBe('dist/');
    expect(normalizePathForGitignore('/src/a.ts')).toBe('src/a.ts');
  });

  it('rejects traversal', () => {
    expect(normalizePathForGitignore('..\\evil')).toBe('');
    expect(isUnsafeGitignoreRelativePath('.gitignore')).toBe(true);
    expect(isUnsafeGitignoreRelativePath('.git/hooks/foo')).toBe(true);
    expect(isUnsafeGitignoreRelativePath('src/foo.ts')).toBe(false);
  });

  it('detects duplicate rules', () => {
    expect(gitignoreAlreadyHasRule('dist/\nbuild/', 'dist/')).toBe(true);
    expect(gitignoreAlreadyHasRule('dist/\nbuild/', 'out/')).toBe(false);
  });

  it('appends newline rules', () => {
    expect(appendGitignoreRule('', 'dist/')).toBe('dist/\n');
    expect(appendGitignoreRule('a\n', 'b')).toBe('a\nb\n');
  });
});

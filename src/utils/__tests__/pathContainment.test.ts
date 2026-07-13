import { describe, expect, it } from 'vitest';
import { resolvePathWithBaseDir } from '../aiTools/argsParser';
import {
  isAbsolutePath,
  isPathUnderRoot,
  normalizeLexicalPath,
  resolveContainedPath,
} from '../pathUtils';

describe('path containment (phase 2)', () => {
  const winRoot = 'D:\\workspace\\proj';
  const unixRoot = '/workspace/proj';

  it('detects absolute paths', () => {
    expect(isAbsolutePath('C:\\Users\\a')).toBe(true);
    expect(isAbsolutePath('/etc/passwd')).toBe(true);
    expect(isAbsolutePath('src/main.ts')).toBe(false);
  });

  it('allows relative paths under base', () => {
    const resolved = resolvePathWithBaseDir('src/main.ts', winRoot);
    expect(isPathUnderRoot(resolved, winRoot)).toBe(true);
  });

  it('rejects absolute paths outside base (Windows-style)', () => {
    expect(() =>
      resolvePathWithBaseDir('C:\\Windows\\System32\\drivers\\etc\\hosts', winRoot)
    ).toThrow(/escapes workspace/i);
  });

  it('rejects absolute paths outside base (Unix-style)', () => {
    expect(() => resolvePathWithBaseDir('/etc/passwd', unixRoot)).toThrow(/escapes workspace/i);
  });

  it('rejects relative traversal outside base', () => {
    expect(() => resolvePathWithBaseDir('../../etc/passwd', unixRoot)).toThrow(
      /escapes workspace/i
    );
    expect(() => resolvePathWithBaseDir('..\\..\\Windows\\System32', winRoot)).toThrow(
      /escapes workspace/i
    );
  });

  it('allows absolute path that is already under base', () => {
    const inside = `${winRoot}\\src\\a.ts`;
    const resolved = resolveContainedPath(inside, winRoot);
    expect(isPathUnderRoot(resolved, winRoot)).toBe(true);
  });

  it('normalizeLexicalPath collapses parent segments', () => {
    expect(normalizeLexicalPath('a/b/../c')).toMatch(/a[\\/]c$/);
  });

  it('without baseDir keeps legacy behaviour', () => {
    expect(resolvePathWithBaseDir('/absolute/only')).toBe('/absolute/only');
    expect(resolvePathWithBaseDir('rel/path')).toBe('rel/path');
  });
});

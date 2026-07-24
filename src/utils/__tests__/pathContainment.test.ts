import { describe, expect, it } from 'vitest';
import { resolvePathWithBaseDir } from '../../features/agent-engine/argsParser';
import {
  isAbsolutePath,
  isPathUnderRoot,
  normalizeLexicalPath,
  normalizePathForCompare,
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

  it('soft-remaps unix-style absolute paths into the workspace', () => {
    const remapped = resolvePathWithBaseDir('/etc/passwd', unixRoot);
    expect(isPathUnderRoot(remapped, unixRoot)).toBe(true);
    expect(normalizeLexicalPath(remapped).replace(/\\/g, '/')).toMatch(/\/etc\/passwd$/);
  });

  it('maps /<workspace-name> to the workspace root', () => {
    const resolved = resolvePathWithBaseDir('/proj', unixRoot);
    expect(normalizeLexicalPath(resolved).replace(/\\/g, '/')).toBe(
      normalizeLexicalPath(unixRoot).replace(/\\/g, '/')
    );
    const nested = resolvePathWithBaseDir('/proj/src/a.ts', unixRoot);
    expect(isPathUnderRoot(nested, unixRoot)).toBe(true);
    expect(normalizeLexicalPath(nested).replace(/\\/g, '/')).toMatch(/\/src\/a\.ts$/);
  });

  it('maps /loom under a Windows workspace named loom', () => {
    const loomRoot = 'D:\\project\\loom';
    const resolved = resolvePathWithBaseDir('/loom', loomRoot);
    expect(normalizePathForCompare(resolved)).toBe(normalizePathForCompare(loomRoot));
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

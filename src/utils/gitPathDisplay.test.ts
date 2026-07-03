import { describe, expect, it } from 'vitest';
import {
  compactGitPathHeadTail,
  gitPathPreferSeparators,
  truncatePathMiddle,
} from './gitPathDisplay';

describe('gitPathDisplay', () => {
  it('prefers backslash when repo is Windows-like', () => {
    expect(gitPathPreferSeparators('D:\\p', 'a/b/c')).toBe('a\\b\\c');
  });

  it('keeps forward slash for posix root', () => {
    expect(gitPathPreferSeparators('/home/p', 'a/b')).toBe('a/b');
  });

  it('truncates middle', () => {
    const long = 'admin-dashboard/src/components/deep/file/index.vue';
    const s = truncatePathMiddle(long, 28);
    expect(s.length).toBeLessThanOrEqual(28);
    expect(s.includes('...')).toBe(true);
  });

  it('compactGitPathHeadTail uses full first and last segments for 3+ parts', () => {
    expect(compactGitPathHeadTail('admin-dashboard\\src\\api\\dormit')).toBe(
      'admin-dashboard\\...\\dormit',
    );
    expect(compactGitPathHeadTail('a/b/c/d')).toBe('a/.../d');
  });

});

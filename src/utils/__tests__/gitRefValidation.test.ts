import { describe, expect, it } from 'vitest';
import {
  formatBlameEpochDate,
  isUnmergedBranchDeleteError,
  isValidBranchName,
  isValidCommitHash,
} from '../gitRefValidation';

describe('gitRefValidation', () => {
  it('accepts valid commit hashes', () => {
    expect(isValidCommitHash('abc1234')).toBe(true);
    expect(isValidCommitHash('abcdef0123456789abcdef0123456789abcdef0')).toBe(true);
  });

  it('rejects invalid commit hashes', () => {
    expect(isValidCommitHash('abc')).toBe(false);
    expect(isValidCommitHash('ghijklm')).toBe(false);
    expect(isValidCommitHash('abc1234;')).toBe(false);
  });

  it('accepts valid branch names', () => {
    expect(isValidBranchName('feature/foo')).toBe(true);
    expect(isValidBranchName('main')).toBe(true);
  });

  it('rejects invalid branch names', () => {
    expect(isValidBranchName('')).toBe(false);
    expect(isValidBranchName('bad..name')).toBe(false);
    expect(isValidBranchName('a'.repeat(241))).toBe(false);
  });

  it('formats blame epoch seconds as locale date', () => {
    const formatted = formatBlameEpochDate('1700000000');
    expect(formatted).not.toBe('1700000000');
    expect(formatBlameEpochDate('')).toBe('');
    expect(formatBlameEpochDate('not-a-number')).toBe('not-a-number');
  });

  it('detects unmerged branch delete errors', () => {
    expect(isUnmergedBranchDeleteError("error: branch 'x' is not fully merged")).toBe(true);
    expect(isUnmergedBranchDeleteError('分支未完全合并')).toBe(true);
    expect(isUnmergedBranchDeleteError('错误：分支没有完全合并')).toBe(true);
    expect(isUnmergedBranchDeleteError('network error')).toBe(false);
  });
});

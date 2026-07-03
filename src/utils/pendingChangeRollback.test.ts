import { describe, expect, it } from 'vitest';
import { isMissingPathRollbackError } from './pendingChangeRollback';

describe('isMissingPathRollbackError', () => {
  it('detects rust path-not-found messages', () => {
    expect(isMissingPathRollbackError('路径不存在: tool-test.md')).toBe(true);
    expect(isMissingPathRollbackError('Path does not exist: src/a.ts')).toBe(true);
    expect(isMissingPathRollbackError('folder does not exist')).toBe(true);
  });

  it('detects os-level missing path messages', () => {
    expect(isMissingPathRollbackError('no such file or directory')).toBe(true);
    expect(isMissingPathRollbackError('cannot find the path specified')).toBe(true);
    expect(isMissingPathRollbackError('系统找不到指定的路径。')).toBe(true);
    expect(isMissingPathRollbackError('找不到指定的路径')).toBe(true);
    expect(isMissingPathRollbackError('文件不存在')).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isMissingPathRollbackError('permission denied')).toBe(false);
    expect(isMissingPathRollbackError('追加写入失败: disk full')).toBe(false);
    expect(isMissingPathRollbackError(new Error('network timeout'))).toBe(false);
  });
});

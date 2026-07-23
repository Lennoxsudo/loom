import { describe, expect, it } from 'vitest';
import { formatGitCommitFailureMessage } from './friendlyGitCommitError';

const g = {
  commitFailedGeneric: 'FAIL: {detail}',
  commitFailedNeedUser: 'NEED_USER',
  commitFailedGpg: 'GPG',
  commitFailedHook: 'HOOK',
  commitFailedMerge: 'MERGE',
  commitFailedNothing: 'NOTHING',
};

describe('formatGitCommitFailureMessage', () => {
  it('maps author identity', () => {
    expect(formatGitCommitFailureMessage('fatal: Please tell me who you are.', g)).toBe(
      'NEED_USER'
    );
  });

  it('maps nothing to commit', () => {
    expect(formatGitCommitFailureMessage('On branch main\nnothing to commit', g)).toBe('NOTHING');
  });

  it('falls back with detail', () => {
    expect(formatGitCommitFailureMessage('some weird error', g)).toBe('FAIL: some weird error');
  });
});

import { describe, expect, it } from 'vitest';
import { formatGitPushFailureMessage } from './friendlyGitPushError';

const g = {
  pushFailedGeneric: 'FAIL: {detail}',
  pushFailedNoUpstream: 'NO_UPSTREAM',
  pushFailedNetwork: 'NETWORK',
  pushFailedAuth: 'AUTH',
  pushFailedNonFastForward: 'NON_FAST_FORWARD',
  pushFailedRemoteRejected: 'REMOTE_REJECTED',
};

describe('formatGitPushFailureMessage', () => {
  it('classifies missing upstream', () => {
    expect(
      formatGitPushFailureMessage(
        'fatal: The current branch main has no upstream branch.\nTo push the current branch and set the remote as upstream...',
        g
      ).summary
    ).toBe('NO_UPSTREAM');
  });

  it('classifies authentication failures', () => {
    expect(formatGitPushFailureMessage('remote: Permission denied', g).summary).toBe('AUTH');
  });

  it('classifies network failures', () => {
    expect(
      formatGitPushFailureMessage('fatal: unable to access https://repo: Could not resolve host', g)
        .summary
    ).toBe('NETWORK');
  });

  it('classifies non-fast-forward failures', () => {
    expect(
      formatGitPushFailureMessage('! [rejected] main -> main (non-fast-forward)', g).summary
    ).toBe('NON_FAST_FORWARD');
  });

  it('falls back to generic message', () => {
    expect(formatGitPushFailureMessage('some weird push problem', g).summary).toBe(
      'FAIL: some weird push problem'
    );
  });
});

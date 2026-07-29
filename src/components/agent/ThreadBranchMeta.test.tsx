import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import ThreadBranchMeta from './ThreadBranchMeta';

afterEach(() => {
  cleanup();
});

describe('ThreadBranchMeta', () => {
  it('shows branch capsule and mismatch warning', () => {
    render(
      <I18nProvider defaultLocale="en-US">
        <ThreadBranchMeta branchName="feature-a" branchMismatch />
      </I18nProvider>
    );

    expect(screen.getByText('feature-a')).toBeInTheDocument();
    expect(screen.getByTestId('thread-branch-mismatch')).toHaveTextContent('Wrong branch');
  });
});

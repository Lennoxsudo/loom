import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GitBranchSelect } from './GitBranchSelect';

describe('GitBranchSelect', () => {
  it('opens a styled menu with grouped branches and hides symbolic refs', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <GitBranchSelect
        branches={[
          { name: 'main', isCurrent: true, isRemote: false },
          { name: 'feature/foo', isCurrent: false, isRemote: false },
          { name: 'remotes/origin/main', isCurrent: false, isRemote: true },
          { name: 'remotes/origin/HEAD -> origin/main', isCurrent: false, isRemote: true },
        ]}
        currentBranch="main"
        switchBranchLabel="Switch branch"
        localGroupLabel="Local"
        remoteGroupLabel="Remote"
        onSelect={onSelect}
      />
    );

    await user.click(screen.getByRole('button', { name: 'main' }));

    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /feature\/foo/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /origin\/main/ })).toBeInTheDocument();
    expect(screen.queryByText(/HEAD -> origin\/main/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /feature\/foo/ }));
    expect(onSelect).toHaveBeenCalledWith('feature/foo');
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import ActivityBar from './ActivityBar';
import type { ComponentType } from 'react';

afterEach(() => {
  cleanup();
});

test('ActivityBar shows Search button', async () => {
  render(
    <ActivityBar isExplorerActive={true} onToggleExplorer={() => {}} onClickSettings={() => {}} />
  );

  expect(screen.getByLabelText('Search')).toBeInTheDocument();
});

test('ActivityBar Search button triggers callback', async () => {
  const user = userEvent.setup();
  const onToggleSearch = vi.fn();

  const AnyActivityBar = ActivityBar as ComponentType<{
    isExplorerActive: boolean;
    onToggleExplorer: () => void;
    onToggleSearch: () => void;
    isSearchActive: boolean;
  }>;

  render(
    <AnyActivityBar
      isExplorerActive={true}
      onToggleExplorer={() => {}}
      onToggleSearch={onToggleSearch}
      isSearchActive={false}
    />
  );

  await user.click(screen.getByLabelText('Search'));
  expect(onToggleSearch).toHaveBeenCalledTimes(1);
});

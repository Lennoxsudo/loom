import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import ActivityBar from './ActivityBar';
import type { ComponentType } from 'react';

import { I18nProvider } from '../i18n';

afterEach(() => {
  cleanup();
});

test('ActivityBar shows Search button', async () => {
  render(
    <I18nProvider>
      <ActivityBar isExplorerActive={true} onToggleExplorer={() => {}} onClickSettings={() => {}} />
    </I18nProvider>
  );

  expect(screen.getByLabelText(/search|搜索/i)).toBeInTheDocument();
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
    <I18nProvider>
      <AnyActivityBar
        isExplorerActive={true}
        onToggleExplorer={() => {}}
        onToggleSearch={onToggleSearch}
        isSearchActive={false}
      />
    </I18nProvider>
  );

  await user.click(screen.getByLabelText(/search|搜索/i));
  expect(onToggleSearch).toHaveBeenCalledTimes(1);
});

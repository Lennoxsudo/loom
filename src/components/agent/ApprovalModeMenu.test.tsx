import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n';
import { useSettingsStore } from '../../stores/useSettingsStore';
import ApprovalModeMenu from './ApprovalModeMenu';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: vi.fn(() => false),
}));

describe('ApprovalModeMenu', () => {
  beforeEach(() => {
    useSettingsStore.getState().loadSettings({ agentAccessMode: 'auto' });
  });

  test('shows current access mode and updates on selection', async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider defaultLocale="en-US">
        <ApprovalModeMenu />
      </I18nProvider>
    );

    expect(screen.getByRole('button', { name: /approve for me/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve for me/i }));
    await user.click(screen.getByRole('menuitem', { name: /read only/i }));

    expect(useSettingsStore.getState().agentAccessMode).toBe('read_only');
    expect(screen.getByRole('button', { name: /read only/i })).toBeInTheDocument();
  });
});

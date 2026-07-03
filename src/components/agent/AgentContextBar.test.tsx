import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../i18n';
import { NotificationProvider } from '../../contexts/NotificationContext';
import { useSettingsStore } from '../../stores/useSettingsStore';
import AgentContextBar from './AgentContextBar';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: vi.fn(() => false),
}));

describe('AgentContextBar', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useSettingsStore.getState().loadSettings({
      agentRuntimeMode: 'local',
      recentWorkspaces: [],
    });
    invokeMock.mockResolvedValue({
      status: { branch: 'main' },
    });
  });

  test('renders project and branch from git snapshot', async () => {
    const onSwitchProject = vi.fn();

    render(
      <NotificationProvider>
        <I18nProvider defaultLocale="en-US">
          <AgentContextBar
            projectPath="D:\\test\\project"
            projectName="project"
            onSwitchProject={onSwitchProject}
          />
        </I18nProvider>
      </NotificationProvider>
    );

    expect(screen.getByRole('button', { name: /project: project/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /branch: main/i })).toBeInTheDocument();
    });

    expect(invokeMock).toHaveBeenCalledWith('git_workspace_snapshot', expect.objectContaining({ limit: 1 }));
  });
});

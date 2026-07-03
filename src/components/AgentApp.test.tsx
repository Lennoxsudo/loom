import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AgentApp from './AgentApp';

const emitMock = vi.fn();
const initializeSettingsMock = vi.fn();
const useSettingsLoadingMock = vi.fn();
const useLanguageMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  emit: (...args: unknown[]) => emitMock(...args),
}));

vi.mock('../stores', () => ({
  useSettingsLoading: () => useSettingsLoadingMock(),
  useInitializeSettings: () => initializeSettingsMock,
  useLanguage: () => useLanguageMock(),
}));

vi.mock('./TitleBar', () => ({
  default: ({ projectName }: { projectName?: string }) => <div>TitleBar {projectName}</div>,
}));

vi.mock('./AgentPanel', () => ({
  default: ({
    projectPath,
    onProjectPathChange,
  }: {
    projectPath: string;
    onProjectPathChange?: (path: string) => void;
  }) => (
    <div>
      AgentPanel {projectPath}
      <button type="button" onClick={() => onProjectPathChange?.('D:\\next\\project')}>
        switch-project
      </button>
    </div>
  ),
}));

describe('AgentApp', () => {
  beforeEach(() => {
    emitMock.mockReset();
    initializeSettingsMock.mockReset();
    useSettingsLoadingMock.mockReset();
    useLanguageMock.mockReset();
    useLanguageMock.mockReturnValue('en-US');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a loading shell instead of a blank window while settings are loading', async () => {
    useSettingsLoadingMock.mockReturnValue(true);

    render(<AgentApp projectPath="D:\\test\\project" />);

    expect(screen.getByTestId('agent-app-loading')).toHaveTextContent('Loading Agent…');
    expect(screen.getByText('TitleBar Agent')).toBeInTheDocument();
    expect(screen.queryByText(/AgentPanel/)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(initializeSettingsMock).toHaveBeenCalledTimes(1);
    });
  });

  it('renders AgentPanel after settings finish loading', async () => {
    useSettingsLoadingMock.mockReturnValue(false);

    render(<AgentApp projectPath="D:\\test\\project" />);

    expect(screen.getByText(/AgentPanel/)).toBeInTheDocument();
    expect(screen.getByText(/D:\\\\test\\\\project/)).toBeInTheDocument();

    await waitFor(() => {
      expect(initializeSettingsMock).toHaveBeenCalledTimes(1);
    });
  });

  it('soft-switches project path without reloading the page', async () => {
    useSettingsLoadingMock.mockReturnValue(false);
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    render(<AgentApp projectPath="D:\\test\\project" />);

    fireEvent.click(screen.getByRole('button', { name: 'switch-project' }));

    expect(screen.getByText((content) => content.includes('D:\\next\\project'))).toBeInTheDocument();
    expect(replaceStateSpy).toHaveBeenCalled();
    replaceStateSpy.mockRestore();
  });
});

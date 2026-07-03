import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useIndexedProjects } from '../useIndexedProjects';
import { useCbmStore } from '../../stores/useCbmStore';

vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({
    showInfo: vi.fn(),
    showWarning: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    graph: {
      indexedProjectsStale: 'Stale: {name}',
      indexDeleted: 'Index deleted',
      indexDeleteFailed: 'Delete failed',
    },
  }),
}));

describe('useIndexedProjects', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCbmStore.setState({
      sidecarChecked: true,
      sidecarAvailable: true,
      ipcReady: true,
      projects: [],
      projectsLoading: false,
      projectsError: null,
      initialized: true,
    });
  });

  it('loads indexed projects when enabled', async () => {
    const projects = [
      {
        repo_path: 'D:/foo',
        display_name: 'foo',
        path_status: 'ok' as const,
        index_status: 'ready' as const,
        is_stale: false,
      },
    ];
    vi.spyOn(useCbmStore.getState(), 'refreshProjects').mockImplementation(async () => {
      useCbmStore.setState({ projects });
      return projects;
    });

    const { result } = renderHook(() => useIndexedProjects(true));

    await waitFor(() => {
      expect(result.current.projects).toHaveLength(1);
    });
  });

  it('does not load when disabled', () => {
    const { result } = renderHook(() => useIndexedProjects(false));
    expect(result.current.loading).toBe(false);
    expect(result.current.projects).toEqual([]);
  });

  it('exposes store error state', () => {
    useCbmStore.setState({ projectsError: 'timeout' });
    const { result } = renderHook(() => useIndexedProjects(true));
    expect(result.current.error).toBe('timeout');
  });
});

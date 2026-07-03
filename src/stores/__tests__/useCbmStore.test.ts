import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCbmStore } from '../useCbmStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockListIndexedProjects = vi.fn();
const mockProbeTauriIpc = vi.fn();
const mockCheckCbmSidecarAvailable = vi.fn();
const mockDeleteCbmWorkspaceIndex = vi.fn();
const mockFetchCbmStorageInfo = vi.fn();

vi.mock('../../utils/cbmRuntime', () => ({
  listIndexedProjects: (...args: unknown[]) => mockListIndexedProjects(...args),
  probeTauriIpc: (...args: unknown[]) => mockProbeTauriIpc(...args),
  checkCbmSidecarAvailable: (...args: unknown[]) => mockCheckCbmSidecarAvailable(...args),
  deleteCbmWorkspaceIndex: (...args: unknown[]) => mockDeleteCbmWorkspaceIndex(...args),
  fetchCbmStorageInfo: (...args: unknown[]) => mockFetchCbmStorageInfo(...args),
}));

describe('useCbmStore', () => {
  beforeEach(() => {
    mockListIndexedProjects.mockReset();
    mockProbeTauriIpc.mockReset();
    mockCheckCbmSidecarAvailable.mockReset();
    mockDeleteCbmWorkspaceIndex.mockReset();
    mockFetchCbmStorageInfo.mockReset();
    useCbmStore.setState({
      sidecarChecked: false,
      sidecarAvailable: false,
      versionMismatch: false,
      ipcReady: false,
      projects: [],
      projectsLoading: false,
      projectsError: null,
      initialized: false,
    });
  });

  it('initialize probes IPC then sidecar and loads projects', async () => {
    mockProbeTauriIpc.mockResolvedValue(true);
    mockCheckCbmSidecarAvailable.mockResolvedValue(true);
    mockFetchCbmStorageInfo.mockResolvedValue({
      pinnedVersion: '0.8.1',
      runtimeVersion: '0.8.1',
    });
    mockListIndexedProjects.mockResolvedValue([
      {
        repo_path: 'D:/foo',
        display_name: 'foo',
        path_status: 'ok',
        index_status: 'ready',
      },
    ]);

    await useCbmStore.getState().initialize();

    expect(mockProbeTauriIpc).toHaveBeenCalled();
    expect(mockCheckCbmSidecarAvailable).toHaveBeenCalled();
    expect(useCbmStore.getState().ipcReady).toBe(true);
    expect(useCbmStore.getState().sidecarAvailable).toBe(true);
    expect(useCbmStore.getState().versionMismatch).toBe(false);
    expect(useCbmStore.getState().projects).toHaveLength(1);
    expect(useCbmStore.getState().projectsLoading).toBe(false);
  });

  it('refreshProjects is a no-op when ipc is not ready', async () => {
    useCbmStore.setState({ ipcReady: false, projectsLoading: true });
    const list = await useCbmStore.getState().refreshProjects();
    expect(list).toEqual([]);
    expect(useCbmStore.getState().projectsLoading).toBe(true);
  });

  it('refreshProjects clears loading after failure', async () => {
    useCbmStore.setState({ ipcReady: true });
    mockListIndexedProjects.mockRejectedValue(new Error('IPC failed'));

    const list = await useCbmStore.getState().refreshProjects();

    expect(list).toEqual([]);
    expect(useCbmStore.getState().projectsLoading).toBe(false);
    expect(useCbmStore.getState().projectsError).toContain('IPC failed');
  });

  it('dedupes concurrent refreshProjects calls', async () => {
    useCbmStore.setState({ ipcReady: true });
    let resolveList: (value: unknown[]) => void = () => {};
    mockListIndexedProjects.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const first = useCbmStore.getState().refreshProjects();
    const second = useCbmStore.getState().refreshProjects();
    expect(mockListIndexedProjects).toHaveBeenCalledTimes(1);

    resolveList([
      {
        repo_path: 'D:/bar',
        display_name: 'bar',
        path_status: 'ok',
        index_status: 'ready',
      },
    ]);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(useCbmStore.getState().projectsLoading).toBe(false);
  });

  it('marks sidecar unavailable on major version mismatch', async () => {
    mockProbeTauriIpc.mockResolvedValue(true);
    mockCheckCbmSidecarAvailable.mockResolvedValue(true);
    mockFetchCbmStorageInfo.mockResolvedValue({
      pinnedVersion: '0.8.1',
      runtimeVersion: '1.0.0',
    });

    await useCbmStore.getState().initialize();

    expect(useCbmStore.getState().ipcReady).toBe(true);
    expect(useCbmStore.getState().sidecarAvailable).toBe(false);
    expect(useCbmStore.getState().versionMismatch).toBe(true);
    expect(useCbmStore.getState().projectsError).toBe('CBM version mismatch');
    // Should not attempt to load projects when degraded
    expect(mockListIndexedProjects).not.toHaveBeenCalled();
  });

  it('allows minor version difference without degradation', async () => {
    mockProbeTauriIpc.mockResolvedValue(true);
    mockCheckCbmSidecarAvailable.mockResolvedValue(true);
    mockFetchCbmStorageInfo.mockResolvedValue({
      pinnedVersion: '0.8.1',
      runtimeVersion: '0.8.3',
    });
    mockListIndexedProjects.mockResolvedValue([]);

    await useCbmStore.getState().initialize();

    expect(useCbmStore.getState().sidecarAvailable).toBe(true);
    expect(useCbmStore.getState().versionMismatch).toBe(false);
  });

  it('skips version check when storage info is unavailable', async () => {
    mockProbeTauriIpc.mockResolvedValue(true);
    mockCheckCbmSidecarAvailable.mockResolvedValue(true);
    mockFetchCbmStorageInfo.mockResolvedValue(null);
    mockListIndexedProjects.mockResolvedValue([]);

    await useCbmStore.getState().initialize();

    // No version info → no mismatch, sidecar stays available
    expect(useCbmStore.getState().sidecarAvailable).toBe(true);
    expect(useCbmStore.getState().versionMismatch).toBe(false);
  });
});

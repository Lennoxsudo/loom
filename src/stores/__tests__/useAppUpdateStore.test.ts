import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkMock = vi.fn();
const getVersionMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => getVersionMock(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

describe('useAppUpdateStore', () => {
  beforeEach(async () => {
    vi.resetModules();
    checkMock.mockReset();
    getVersionMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    getVersionMock.mockResolvedValue('0.1.3');
  });

  async function loadStore() {
    const mod = await import('../useAppUpdateStore');
    return mod.useAppUpdateStore;
  }

  it('does not call native updater APIs outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);
    const useAppUpdateStore = await loadStore();

    await useAppUpdateStore.getState().checkForUpdates({ silent: true });

    expect(checkMock).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().status).toBe('desktopOnly');
  });

  it('marks status upToDate when check returns null', async () => {
    checkMock.mockResolvedValue(null);
    const useAppUpdateStore = await loadStore();

    await useAppUpdateStore.getState().checkForUpdates();

    expect(useAppUpdateStore.getState().status).toBe('upToDate');
    expect(useAppUpdateStore.getState().currentVersion).toBe('0.1.3');
    expect(useAppUpdateStore.getState().availableVersion).toBeNull();
  });

  it('stores available update metadata', async () => {
    checkMock.mockResolvedValue({
      version: '0.1.4',
      body: 'Notes',
      date: '2026-07-22T00:00:00Z',
      downloadAndInstall: vi.fn(),
    });
    const useAppUpdateStore = await loadStore();

    await useAppUpdateStore.getState().checkForUpdates();

    const state = useAppUpdateStore.getState();
    expect(state.status).toBe('available');
    expect(state.availableVersion).toBe('0.1.4');
    expect(state.notes).toBe('Notes');
    expect(state.publishedAt).toBe('2026-07-22T00:00:00Z');
  });

  it('shares a single in-flight check promise', async () => {
    let resolveCheck: (value: null) => void = () => undefined;
    checkMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        })
    );
    const useAppUpdateStore = await loadStore();

    const first = useAppUpdateStore.getState().checkForUpdates();
    const second = useAppUpdateStore.getState().checkForUpdates();
    expect(first).toBe(second);

    await vi.waitFor(() => {
      expect(checkMock).toHaveBeenCalledTimes(1);
    });

    resolveCheck(null);
    await Promise.all([first, second]);
    expect(useAppUpdateStore.getState().status).toBe('upToDate');
  });

  it('tracks download progress and reaches restartRequired after install', async () => {
    const downloadAndInstall = vi.fn(async (onEvent?: (event: unknown) => void) => {
      onEvent?.({ event: 'Started', data: { contentLength: 100 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 60 } });
      onEvent?.({ event: 'Finished' });
    });
    checkMock.mockResolvedValue({
      version: '0.1.4',
      body: null,
      date: null,
      downloadAndInstall,
    });
    const useAppUpdateStore = await loadStore();
    await useAppUpdateStore.getState().checkForUpdates();
    await useAppUpdateStore.getState().downloadAndInstall();

    const state = useAppUpdateStore.getState();
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(state.downloadedBytes).toBe(100);
    expect(state.contentLength).toBe(100);
    expect(state.status).toBe('restartRequired');
  });

  it('captures check errors in recoverable error state', async () => {
    checkMock.mockRejectedValue(new Error('network down'));
    const useAppUpdateStore = await loadStore();

    await useAppUpdateStore.getState().checkForUpdates();

    expect(useAppUpdateStore.getState().status).toBe('error');
    expect(useAppUpdateStore.getState().error).toContain('network down');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../useSettingsStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn(() => true),
}));

describe('useSettingsStore removeRecentWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      recentWorkspaces: [
        {
          path: 'D:\\keep\\project',
          name: 'Keep',
          lastOpenedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          path: 'D:\\remove\\project',
          name: 'Remove',
          lastOpenedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
  });

  it('removes a workspace by normalized path and persists settings', async () => {
    await useSettingsStore.getState().removeRecentWorkspace('d:/remove/project');

    expect(useSettingsStore.getState().recentWorkspaces).toEqual([
      {
        path: 'D:\\keep\\project',
        name: 'Keep',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(invoke).toHaveBeenCalledWith(
      'save_editor_settings',
      expect.objectContaining({
        settings: expect.stringContaining('D:\\\\keep\\\\project'),
      })
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { deleteProjectFromWorkspace } from './deleteProjectFromWorkspace';
import {
  deleteProjectState,
  getProjectState,
  projectStorageKey,
  type ProjectConversationState,
} from './agentPersistence';
import { removeProjectStateBackupFromLocalStorage } from '../components/agent/hooks/useAgentInit';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock('./agentPersistence', () => ({
  deleteProjectState: vi.fn(),
  getProjectState: vi.fn(),
  projectStorageKey: vi.fn(),
}));

vi.mock('../components/agent/hooks/useAgentInit', () => ({
  removeProjectStateBackupFromLocalStorage: vi.fn(),
}));

describe('deleteProjectFromWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectStorageKey).mockResolvedValue('project-key');
    vi.mocked(getProjectState).mockResolvedValue({
      selectedConversationId: 'conv-1',
      conversations: [
        {
          id: 'conv-1',
          title: 'Test',
          messages: [
            {
              id: 'm1',
              role: 'user',
              text: 'hi',
              createdAt: 1,
              attachments: [
                {
                  id: 'img-1',
                  type: 'image',
                  path: '/tmp/image.png',
                  mediaType: 'image/png',
                  width: 1,
                  height: 1,
                  size: 1,
                  sha256: 'abc',
                },
              ],
            },
          ],
          previewHistory: [],
          currentPreviewIndex: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } satisfies ProjectConversationState);
  });

  it('deletes persisted project data and clears recent workspace entry', async () => {
    const removeRecentWorkspace = vi.fn().mockResolvedValue(undefined);
    const clearSessionExtrasForProject = vi.fn();

    await deleteProjectFromWorkspace({
      projectPath: 'D:\\demo\\project',
      currentProjectPath: 'D:\\other\\project',
      removeRecentWorkspace,
      clearSessionExtrasForProject,
      enableCodeGraph: true,
    });

    expect(clearSessionExtrasForProject).toHaveBeenCalledWith('project-key');
    expect(deleteProjectState).toHaveBeenCalledWith('project-key');
    expect(invoke).toHaveBeenCalledWith('cbm_delete_workspace_index', {
      repoPath: 'D:\\demo\\project',
      enableCodeGraph: true,
    });
    expect(removeRecentWorkspace).toHaveBeenCalledWith('D:\\demo\\project');
    expect(removeProjectStateBackupFromLocalStorage).toHaveBeenCalledWith('project-key');
    expect(invoke).toHaveBeenCalledWith('cleanup_unreferenced_chat_images', {
      candidatePaths: ['/tmp/image.png'],
    });
  });

  it('resets active project when deleting the current workspace project', async () => {
    const onResetActiveProject = vi.fn();
    const onProjectPathChange = vi.fn();

    await deleteProjectFromWorkspace({
      projectPath: 'D:/demo/project',
      currentProjectPath: 'd:\\demo\\project',
      removeRecentWorkspace: vi.fn().mockResolvedValue(undefined),
      clearSessionExtrasForProject: vi.fn(),
      onResetActiveProject,
      onProjectPathChange,
      enableCodeGraph: true,
    });

    expect(onResetActiveProject).toHaveBeenCalledTimes(1);
    expect(onProjectPathChange).toHaveBeenCalledWith('');
  });

  it('calls onCbmDeleteFailed and continues when CBM index deletion fails', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'cbm_delete_workspace_index') {
        return Promise.reject(new Error('CBM delete failed'));
      }
      return Promise.resolve(undefined);
    });

    const onCbmDeleteFailed = vi.fn();
    const removeRecentWorkspace = vi.fn().mockResolvedValue(undefined);

    await deleteProjectFromWorkspace({
      projectPath: 'D:\\demo\\project',
      currentProjectPath: 'D:\\other\\project',
      removeRecentWorkspace,
      clearSessionExtrasForProject: vi.fn(),
      onCbmDeleteFailed,
      enableCodeGraph: true,
    });

    expect(onCbmDeleteFailed).toHaveBeenCalledTimes(1);
    // Agent deletion should still proceed despite CBM failure
    expect(removeRecentWorkspace).toHaveBeenCalledWith('D:\\demo\\project');
    expect(removeProjectStateBackupFromLocalStorage).toHaveBeenCalledWith('project-key');
  });

  it('calls onCbmDeleteFailed when Rust returns status=failed', async () => {
    // Rust returns Ok({ status: 'failed' }) not Err — frontend must check status.
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'cbm_delete_workspace_index') {
        return Promise.resolve({
          status: 'failed',
          repoPath: 'D:\\demo\\project',
          message: 'CLI error',
        });
      }
      return Promise.resolve(undefined);
    });

    const onCbmDeleteFailed = vi.fn();
    const removeRecentWorkspace = vi.fn().mockResolvedValue(undefined);

    await deleteProjectFromWorkspace({
      projectPath: 'D:\\demo\\project',
      currentProjectPath: 'D:\\other\\project',
      removeRecentWorkspace,
      clearSessionExtrasForProject: vi.fn(),
      onCbmDeleteFailed,
      enableCodeGraph: true,
    });

    expect(onCbmDeleteFailed).toHaveBeenCalledTimes(1);
    expect(removeRecentWorkspace).toHaveBeenCalledWith('D:\\demo\\project');
  });

  it('does not call onCbmDeleteFailed when status is skipped_disabled', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'cbm_delete_workspace_index') {
        return Promise.resolve({
          status: 'skipped_disabled',
          repoPath: 'D:\\demo\\project',
          message: '代码图谱已关闭',
        });
      }
      return Promise.resolve(undefined);
    });

    const onCbmDeleteFailed = vi.fn();
    const removeRecentWorkspace = vi.fn().mockResolvedValue(undefined);

    await deleteProjectFromWorkspace({
      projectPath: 'D:\\demo\\project',
      currentProjectPath: 'D:\\other\\project',
      removeRecentWorkspace,
      clearSessionExtrasForProject: vi.fn(),
      onCbmDeleteFailed,
      enableCodeGraph: false,
    });

    expect(onCbmDeleteFailed).not.toHaveBeenCalled();
    expect(removeRecentWorkspace).toHaveBeenCalledWith('D:\\demo\\project');
  });

  it('does not call onCbmDeleteFailed when status is skipped_in_progress', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'cbm_delete_workspace_index') {
        return Promise.resolve({
          status: 'skipped_in_progress',
          repoPath: 'D:\\demo\\project',
          message: '索引进行中',
        });
      }
      return Promise.resolve(undefined);
    });

    const onCbmDeleteFailed = vi.fn();
    const removeRecentWorkspace = vi.fn().mockResolvedValue(undefined);

    await deleteProjectFromWorkspace({
      projectPath: 'D:\\demo\\project',
      currentProjectPath: 'D:\\other\\project',
      removeRecentWorkspace,
      clearSessionExtrasForProject: vi.fn(),
      onCbmDeleteFailed,
      enableCodeGraph: true,
    });

    expect(onCbmDeleteFailed).not.toHaveBeenCalled();
    expect(removeRecentWorkspace).toHaveBeenCalledWith('D:\\demo\\project');
  });
});

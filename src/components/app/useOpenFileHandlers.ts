import { useCallback } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { FileNode } from '../FileTree';
import type { EditorGroupId, OpenFilesByPath, EditorGroupState } from '../../types/app';
import { isTauriCancellationError } from '../../utils/editorUtils';

export interface UseOpenFileHandlersOptions {
  activeGroupId: EditorGroupId;
  openFileInGroup: (filePath: string, targetGroupId: EditorGroupId, forceRefresh?: boolean) => Promise<void>;
  setProjectName: (name: string) => void;
  setProjectPath: (path: string) => void;
  setFileTree: (nodes: FileNode[]) => void;
  setExpandedDirs: (dirs: Set<string>) => void;
  setLoadingDirs: (dirs: Set<string>) => void;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
  setEditorGroups: React.Dispatch<React.SetStateAction<EditorGroupState[]>>;
  setActiveGroupId: (id: EditorGroupId) => void;
  setHoveredTabId: (id: string | null) => void;
  showError: (message: string) => void;
}

export function useOpenFileHandlers({
  activeGroupId,
  openFileInGroup,
  setProjectName,
  setProjectPath,
  setFileTree,
  setExpandedDirs,
  setLoadingDirs,
  setOpenFilesByPath,
  setEditorGroups,
  setActiveGroupId,
  setHoveredTabId,
  showError,
}: UseOpenFileHandlersOptions) {
  const resetWorkspaceState = useCallback(
    async (dirPath: string) => {
      const name = dirPath.split(/[\\/]/).pop() || dirPath;
      setProjectName(name);
      setProjectPath(dirPath);

      const nodes = await invoke<FileNode[]>('open_folder', { folderPath: dirPath });
      setFileTree(nodes);
      setExpandedDirs(new Set());
      setLoadingDirs(new Set());
      setOpenFilesByPath({});
      setEditorGroups([{ id: 'group-1', tabPaths: [], activePath: null }]);
      setActiveGroupId('group-1');
      setHoveredTabId(null);
    },
    [
      setProjectName,
      setProjectPath,
      setFileTree,
      setExpandedDirs,
      setLoadingDirs,
      setOpenFilesByPath,
      setEditorGroups,
      setActiveGroupId,
      setHoveredTabId,
    ]
  );

  const openFolderAtPath = useCallback(
    async (dirPath: string) => {
      try {
        await resetWorkspaceState(dirPath);
      } catch (error) {
        if (isTauriCancellationError(error)) return;
        console.error(error);
      }
    },
    [resetWorkspaceState]
  );

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected === null) return;
      const dirPath = Array.isArray(selected) ? selected[0] : selected;
      await resetWorkspaceState(dirPath);
    } catch (error) {
      if (isTauriCancellationError(error)) return;
      console.error(error);
    }
  }, [resetWorkspaceState]);

  const handleSelectFile = useCallback(
    async (filePath: string) => {
      try {
        await openFileInGroup(filePath, activeGroupId);
      } catch (error) {
        showError(`${error}`);
      }
    },
    [activeGroupId, openFileInGroup, showError]
  );

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: false, multiple: false });
      if (selected === null) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      await handleSelectFile(filePath);
    } catch (error) {
      if (isTauriCancellationError(error)) return;
      console.error(error);
    }
  }, [handleSelectFile]);

  return { handleOpenFolder, handleSelectFile, handleOpenFile, openFolderAtPath };
}

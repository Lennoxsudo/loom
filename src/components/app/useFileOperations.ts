import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { CreatingItem } from '../../types/file';

export interface UseFileOperationsOptions {
  projectPath: string;
  focusedActiveFilePath: string | null;
  setProjectName: (name: string) => void;
  setProjectPath: (path: string) => void;
  setExpandedDirs: (dirs: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setLoadingDirs: (dirs: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  loadFolderChildren: (folderPath: string, options?: { silent?: boolean }) => Promise<void>;
  onSelectFile: (filePath: string) => void;
  showWarning: (message: string) => void;
  showError: (message: string) => void;
}

export interface UseFileOperationsReturn {
  creatingItem: CreatingItem | null;
  handleCreateFile: () => void;
  handleCreateFolder: () => void;
  startCreateItemAt: (type: 'file' | 'folder', parentPath: string) => void;
  handleConfirmCreate: (name: string) => Promise<void>;
  handleCancelCreate: () => void;
}

export function useFileOperations({
  projectPath,
  focusedActiveFilePath,
  setProjectName: _setProjectName,
  setProjectPath: _setProjectPath,
  setExpandedDirs: _setExpandedDirs,
  setLoadingDirs: _setLoadingDirs,
  loadFolderChildren,
  onSelectFile,
  showWarning,
  showError,
}: UseFileOperationsOptions): UseFileOperationsReturn {
  const [creatingItem, setCreatingItem] = useState<CreatingItem | null>(null);

  const handleCreateFile = useCallback(() => {
    if (creatingItem?.type === 'file') {
      setCreatingItem(null);
      return;
    }

    if (!projectPath) {
      showWarning('请先打开一个文件夹');
      return;
    }

    let targetDir = projectPath;
    if (focusedActiveFilePath) {
      const parts = focusedActiveFilePath.split(/[\\/]/);
      parts.pop();
      targetDir = parts.join('\\');
    }

    setCreatingItem({ type: 'file', parentPath: targetDir });
  }, [creatingItem, projectPath, focusedActiveFilePath, showWarning]);

  const handleCreateFolder = useCallback(() => {
    if (creatingItem?.type === 'folder') {
      setCreatingItem(null);
      return;
    }

    if (!projectPath) {
      showWarning('请先打开一个文件夹');
      return;
    }

    let targetDir = projectPath;
    if (focusedActiveFilePath) {
      const parts = focusedActiveFilePath.split(/[\\/]/);
      parts.pop();
      targetDir = parts.join('\\');
    }

    setCreatingItem({ type: 'folder', parentPath: targetDir });
  }, [creatingItem, projectPath, focusedActiveFilePath, showWarning]);

  const startCreateItemAt = useCallback(
    (type: 'file' | 'folder', parentPath: string) => {
      if (!projectPath) {
        showWarning('请先打开一个文件夹');
        return;
      }

      setCreatingItem({ type, parentPath });
    },
    [projectPath, showWarning]
  );

  const handleConfirmCreate = useCallback(
    async (name: string) => {
      if (!creatingItem || !name.trim()) {
        setCreatingItem(null);
        return;
      }

      const separator = creatingItem.parentPath.includes('/') ? '/' : '\\';
      const newPath = `${creatingItem.parentPath}${separator}${name.trim()}`;

      try {
        if (creatingItem.type === 'file') {
          await invoke('create_file', { filePath: newPath });
          await loadFolderChildren(creatingItem.parentPath);
          onSelectFile(newPath);
        } else {
          await invoke('create_folder', { folderPath: newPath });
          await loadFolderChildren(creatingItem.parentPath);
        }
        setCreatingItem(null);
      } catch (error) {
        showError(`创建${creatingItem.type === 'file' ? '文件' : '文件夹'}失败: ${error}`);
        setCreatingItem(null);
      }
    },
    [creatingItem, loadFolderChildren, onSelectFile, showError]
  );

  const handleCancelCreate = useCallback(() => {
    setCreatingItem(null);
  }, []);

  return {
    creatingItem,
    handleCreateFile,
    handleCreateFolder,
    startCreateItemAt,
    handleConfirmCreate,
    handleCancelCreate,
  };
}

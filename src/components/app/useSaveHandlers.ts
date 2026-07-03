import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { OpenFile, OpenFilesByPath, EditorGroupId } from '../../types/app';
import { normalizeEolForCompare } from '../../utils/pathUtils';

interface TabToClose {
  groupId: EditorGroupId;
  filePath: string;
}

export interface UseSaveHandlersOptions {
  openFilesByPath: OpenFilesByPath;
  tabToClose: TabToClose | null;
  focusedActiveFile: OpenFile | null;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
  setModalOpen: (open: boolean) => void;
  setTabToClose: (tab: TabToClose | null) => void;
  closeTabDirectly: (groupId: EditorGroupId, filePath: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  clearAutoSaveTimer: (filePath: string) => void;
  autoSaveTimersRef: React.MutableRefObject<Map<string, number>>;
}

export function useSaveHandlers({
  openFilesByPath,
  tabToClose,
  focusedActiveFile,
  setOpenFilesByPath,
  setModalOpen,
  setTabToClose,
  closeTabDirectly,
  showError,
  showWarning,
  clearAutoSaveTimer,
  autoSaveTimersRef,
}: UseSaveHandlersOptions) {
  const saveFileInternal = useCallback(
    async (file: OpenFile) => {
      if (file.kind !== 'text') return;

      if ('isDeleted' in file && file.isDeleted) {
        showWarning(`文件已从磁盘删除，无法保存: ${file.path}`);
        return;
      }

      try {
        const info = await invoke<{ exists: boolean }>('get_file_info', { path: file.path });
        if (!info.exists) {
          showWarning(`文件已被删除，无法保存: ${file.path}`);
          setOpenFilesByPath((prev) => {
            const existing = prev[file.path];
            if (!existing || existing.kind !== 'text') return prev;
            return { ...prev, [file.path]: { ...existing, isDeleted: true } };
          });
          return;
        }
      } catch {
        // 如果 get_file_info 调用失败，继续尝试保存
      }

      const savedContent = file.content;
      await invoke('write_file_content', {
        filePath: file.path,
        content: savedContent,
      });

      setOpenFilesByPath((prev) => {
        const existing = prev[file.path];
        if (!existing) return prev;
        if (existing.kind !== 'text') return prev;

        if (normalizeEolForCompare(existing.content) !== normalizeEolForCompare(savedContent)) {
          return prev;
        }
        return { ...prev, [file.path]: { ...existing, isDirty: false, isDeleted: false } };
      });
    },
    [setOpenFilesByPath, showWarning]
  );

  const handleConfirmSave = useCallback(async () => {
    if (!tabToClose) return;

    const file = openFilesByPath[tabToClose.filePath];
    if (!file) {
      setModalOpen(false);
      setTabToClose(null);
      return;
    }

    try {
      await saveFileInternal(file);
      setModalOpen(false);
      closeTabDirectly(tabToClose.groupId, tabToClose.filePath);
      setTabToClose(null);
    } catch (error) {
      showError(`保存失败，无法关闭: ${error}`);
      setModalOpen(false);
    }
  }, [
    tabToClose,
    openFilesByPath,
    saveFileInternal,
    closeTabDirectly,
    showError,
    setModalOpen,
    setTabToClose,
  ]);

  const handleConfirmDontSave = useCallback(() => {
    if (!tabToClose) return;
    setModalOpen(false);
    closeTabDirectly(tabToClose.groupId, tabToClose.filePath);
    setTabToClose(null);
  }, [tabToClose, closeTabDirectly, setModalOpen, setTabToClose]);

  const handleCancelClose = useCallback(() => {
    setModalOpen(false);
    setTabToClose(null);
  }, [setModalOpen, setTabToClose]);

  useEffect(() => {
    return () => {
      autoSaveTimersRef.current.forEach((timer) => clearTimeout(timer));
      autoSaveTimersRef.current.clear();
    };
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!focusedActiveFile) return;
    if (focusedActiveFile.kind !== 'text') return;

    clearAutoSaveTimer(focusedActiveFile.path);

    try {
      await saveFileInternal(focusedActiveFile);
    } catch (error) {
      showError(`保存失败: ${error}`);
    }
  }, [focusedActiveFile, saveFileInternal, showError, clearAutoSaveTimer]);

  return { saveFileInternal, handleConfirmSave, handleConfirmDontSave, handleCancelClose, handleSaveFile };
}

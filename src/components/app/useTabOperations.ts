import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { EditorGroupId, EditorGroupState, OpenFilesByPath } from '../../types/app';
import { isPathUnderRoot, normalizePathForCompare } from '../../utils/pathUtils';

export interface UseTabOperationsOptions {
  editorGroups: EditorGroupState[];
  activeGroupId: EditorGroupId;
  isSplit: boolean;
  openFilesByPath: OpenFilesByPath;
  openFilesByPathRef: React.MutableRefObject<OpenFilesByPath>;
  projectPath: string;
  isAnyAgentBusy: boolean;
  agentBusyPanelsRef: React.MutableRefObject<Set<string>>;
  autoSaveTimersRef: React.MutableRefObject<Map<string, number>>;
  clearAutoSaveTimer?: (filePath: string) => void;
  setEditorGroups: React.Dispatch<React.SetStateAction<EditorGroupState[]>>;
  setActiveGroupId: React.Dispatch<React.SetStateAction<EditorGroupId>>;
  setHoveredTabId: React.Dispatch<React.SetStateAction<string | null>>;
  setSplitDirection: React.Dispatch<React.SetStateAction<'row' | 'column'>>;
  setIsEditorSplitResizing: React.Dispatch<React.SetStateAction<boolean>>;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
  showWarning: (message: string) => void;
  onShowSaveModal?: (groupId: EditorGroupId, filePath: string) => void;
}

export interface UseTabOperationsReturn {
  handleActivateTab: (groupId: EditorGroupId, filePath: string) => void;
  handleSplitRight: (sourceGroupId: EditorGroupId) => void;
  handleSplitDown: (sourceGroupId: EditorGroupId) => void;
  handleSingle: () => void;
  handleFocusGroup: (groupId: EditorGroupId) => void;
  closeTabDirectly: (groupId: EditorGroupId, filePath: string) => void;
  handleCloseTab: (e: React.MouseEvent, groupId: EditorGroupId, filePath: string) => void;
}

export function useTabOperations({
  editorGroups,
  activeGroupId,
  isSplit,
  openFilesByPath,
  openFilesByPathRef,
  projectPath,
  isAnyAgentBusy,
  agentBusyPanelsRef,
  autoSaveTimersRef,
  clearAutoSaveTimer,
  setEditorGroups,
  setActiveGroupId,
  setHoveredTabId,
  setSplitDirection,
  setIsEditorSplitResizing,
  setOpenFilesByPath,
  showWarning,
  onShowSaveModal,
}: UseTabOperationsOptions): UseTabOperationsReturn {
  const handleActivateTab = useCallback(
    (groupId: EditorGroupId, filePath: string) => {
      setActiveGroupId(groupId);
      setEditorGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, activePath: filePath } : g))
      );
    },
    [setActiveGroupId, setEditorGroups]
  );

  const handleSplitRight = useCallback(
    (sourceGroupId: EditorGroupId) => {
      const source = editorGroups.find((g) => g.id === sourceGroupId) || editorGroups[0];
      if (source.activePath) {
        const file = openFilesByPathRef.current[source.activePath];
        if (file?.kind === 'agent') {
          showWarning('Agent 面板不支持分屏');
          return;
        }
      }

      setSplitDirection('row');
      setActiveGroupId(sourceGroupId);

      if (!isSplit) {
        setEditorGroups((prev) => {
          if (prev.length > 1) return prev;
          const prevSource = prev.find((g) => g.id === sourceGroupId) || prev[0];
          const activePath = prevSource.activePath;
          const group2: EditorGroupState = {
            id: 'group-2',
            tabPaths: activePath ? [activePath] : [],
            activePath: activePath || null,
          };
          return [prev[0], group2];
        });
        setActiveGroupId('group-2');
      }
    },
    [isSplit, editorGroups, openFilesByPathRef, showWarning, setSplitDirection, setActiveGroupId, setEditorGroups]
  );

  const handleSplitDown = useCallback(
    (sourceGroupId: EditorGroupId) => {
      const source = editorGroups.find((g) => g.id === sourceGroupId) || editorGroups[0];
      if (source.activePath) {
        const file = openFilesByPathRef.current[source.activePath];
        if (file?.kind === 'agent') {
          showWarning('Agent 面板不支持分屏');
          return;
        }
      }

      setSplitDirection('column');
      setActiveGroupId(sourceGroupId);

      if (!isSplit) {
        setEditorGroups((prev) => {
          if (prev.length > 1) return prev;
          const prevSource = prev.find((g) => g.id === sourceGroupId) || prev[0];
          const activePath = prevSource.activePath;
          const group2: EditorGroupState = {
            id: 'group-2',
            tabPaths: activePath ? [activePath] : [],
            activePath: activePath || null,
          };
          return [prev[0], group2];
        });
        setActiveGroupId('group-2');
      }
    },
    [isSplit, editorGroups, openFilesByPathRef, showWarning, setSplitDirection, setActiveGroupId, setEditorGroups]
  );

  const handleSingle = useCallback(() => {
    if (!isSplit) return;
    const activeBefore = activeGroupId;

    setIsEditorSplitResizing(false);

    setEditorGroups((prev) => {
      if (prev.length < 2) return prev;
      const g1 = prev[0];
      const g2 = prev[1];

      const mergedTabs = [...g1.tabPaths];
      for (const p of g2.tabPaths) {
        if (!mergedTabs.includes(p)) mergedTabs.push(p);
      }

      const mergedActive =
        activeBefore === 'group-2' ? g2.activePath || g1.activePath : g1.activePath || g2.activePath;

      return [{ id: 'group-1', tabPaths: mergedTabs, activePath: mergedActive }];
    });

    setActiveGroupId('group-1');
    setHoveredTabId(null);
  }, [isSplit, activeGroupId, setIsEditorSplitResizing, setEditorGroups, setActiveGroupId, setHoveredTabId]);

  const handleFocusGroup = useCallback(
    (groupId: EditorGroupId) => {
      setActiveGroupId(groupId);
    },
    [setActiveGroupId]
  );

  const closeTabDirectly = useCallback(
    (groupId: EditorGroupId, filePath: string) => {
      const file = openFilesByPathRef.current[filePath];
      if (file?.kind === 'agent' && agentBusyPanelsRef.current.size > 0) {
        showWarning('Agent 正在运行，停止后才能关闭');
        return;
      }

      // 使用统一的清理函数
      if (clearAutoSaveTimer) {
        clearAutoSaveTimer(filePath);
      } else {
        // 向后兼容：直接清理
        const timer = autoSaveTimersRef.current.get(filePath);
        if (timer !== undefined) {
          clearTimeout(timer);
          autoSaveTimersRef.current.delete(filePath);
        }
      }

      setEditorGroups((prevGroups) => {
        const nextGroups = prevGroups.map((g) => {
          if (g.id !== groupId) return g;

          const closingIndex = g.tabPaths.indexOf(filePath);
          if (closingIndex === -1) return g;

          const nextTabs = g.tabPaths.filter((p) => p !== filePath);
          let nextActive = g.activePath;

          if (g.activePath === filePath) {
            if (nextTabs.length > 0) {
              const nextIndex = Math.min(closingIndex, nextTabs.length - 1);
              nextActive = nextTabs[nextIndex];
            } else {
              nextActive = null;
            }
          }

          return { ...g, tabPaths: nextTabs, activePath: nextActive };
        });

        const stillReferenced = nextGroups.some((g) => g.tabPaths.includes(filePath));
        if (!stillReferenced) {
          setOpenFilesByPath((prevFiles) => {
            if (!prevFiles[filePath]) return prevFiles;
            const nextFiles = { ...prevFiles };
            delete nextFiles[filePath];
            return nextFiles;
          });

          const normalizedForWatch = normalizePathForCompare(filePath).toLowerCase();
          const ignoredByProjectWatcher =
            normalizedForWatch.includes('node_modules') ||
            normalizedForWatch.includes('.git') ||
            normalizedForWatch.includes('target');
          if (!projectPath || !isPathUnderRoot(filePath, projectPath) || ignoredByProjectWatcher) {
            invoke('unwatch_file', { path: filePath }).catch((err) => {
              console.warn('[closeTabDirectly] Failed to unwatch external file:', err);
            });
          }
        }

        return nextGroups;
      });
    },
    [
      showWarning,
      agentBusyPanelsRef,
      autoSaveTimersRef,
      clearAutoSaveTimer,
      openFilesByPathRef,
      setEditorGroups,
      setOpenFilesByPath,
      projectPath,
    ]
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, groupId: EditorGroupId, filePath: string) => {
      e.stopPropagation();

      const file = openFilesByPath[filePath];
      if (!file) {
        closeTabDirectly(groupId, filePath);
        return;
      }

      if (file.kind === 'agent' && isAnyAgentBusy) {
        showWarning('Agent 正在运行，停止后才能关闭');
        return;
      }

      const instanceCount = editorGroups.reduce(
        (acc, g) => acc + (g.tabPaths.includes(filePath) ? 1 : 0),
        0
      );
      const isLastInstance = instanceCount <= 1;

      if (isLastInstance && file.isDirty) {
        if (onShowSaveModal) {
          onShowSaveModal(groupId, filePath);
        }
        return;
      }

      closeTabDirectly(groupId, filePath);
    },
    [openFilesByPath, editorGroups, isAnyAgentBusy, showWarning, closeTabDirectly, onShowSaveModal]
  );

  return {
    handleActivateTab,
    handleSplitRight,
    handleSplitDown,
    handleSingle,
    handleFocusGroup,
    closeTabDirectly,
    handleCloseTab,
  };
}

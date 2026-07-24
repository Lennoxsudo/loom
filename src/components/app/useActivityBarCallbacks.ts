import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { OpenFile, OpenFilesByPath, EditorGroupState, EditorGroupId } from '../../types/app';
import { debugLog } from '../../utils/debugLog';

type SidebarView = 'explorer' | 'search' | 'git';

export interface UseActivityBarCallbacksOptions {
  isFileTreeCollapsed: boolean;
  isSidebarHidden: boolean;
  activeSidebarView: SidebarView;
  isChatPanelOpen: boolean;
  hasTerminals: boolean;
  projectPath: string;
  openFilesByPath: OpenFilesByPath;
  activeGroupId: EditorGroupId;
  layoutActions: {
    setIsResizing: (resizing: boolean) => void;
    setActiveSidebarView: (view: SidebarView) => void;
    setIsSidebarHidden: (hidden: boolean) => void;
    setIsChatPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
    setIsTerminalOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  };
  setIsFileTreeCollapsed: (collapsed: boolean) => void;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
  setEditorGroups: React.Dispatch<React.SetStateAction<EditorGroupState[]>>;
  showWarning: (message: string) => void;
  setExplorerWorkingDir: (dir: string | null) => void;
}

export function useActivityBarCallbacks({
  isFileTreeCollapsed,
  isSidebarHidden,
  activeSidebarView,
  isChatPanelOpen,
  hasTerminals,
  projectPath,
  openFilesByPath,
  activeGroupId,
  layoutActions,
  setIsFileTreeCollapsed,
  setOpenFilesByPath,
  setEditorGroups,
  setExplorerWorkingDir,
}: UseActivityBarCallbacksOptions) {
  const showSidebarView = useCallback(
    (view: SidebarView) => {
      layoutActions.setIsResizing(false);
      layoutActions.setActiveSidebarView(view);
      layoutActions.setIsSidebarHidden(false);
      setIsFileTreeCollapsed(false);
    },
    [layoutActions, setIsFileTreeCollapsed]
  );

  const handleToggleExplorer = useCallback(() => {
    layoutActions.setIsResizing(false);
    // Activity Bar: hide the whole sidebar column (not header-only soft collapse).
    if (!isSidebarHidden && activeSidebarView === 'explorer') {
      layoutActions.setIsSidebarHidden(true);
      return;
    }
    showSidebarView('explorer');
  }, [isSidebarHidden, activeSidebarView, layoutActions, showSidebarView]);

  const handleToggleSearch = useCallback(() => {
    layoutActions.setIsResizing(false);
    if (!isSidebarHidden && activeSidebarView === 'search') {
      layoutActions.setIsSidebarHidden(true);
      return;
    }
    showSidebarView('search');
  }, [isSidebarHidden, activeSidebarView, layoutActions, showSidebarView]);

  const handleToggleGit = useCallback(() => {
    layoutActions.setIsResizing(false);
    if (!isSidebarHidden && activeSidebarView === 'git') {
      layoutActions.setIsSidebarHidden(true);
      return;
    }
    showSidebarView('git');
  }, [isSidebarHidden, activeSidebarView, layoutActions, showSidebarView]);

  const handleToggleChat = useCallback(() => {
    layoutActions.setIsChatPanelOpen(!isChatPanelOpen);
  }, [isChatPanelOpen, layoutActions]);

  const handleToggleAgent = useCallback(() => {
    debugLog('agent-button', {
      projectPath,
      href: window.location.href,
      openFileCount: Object.keys(openFilesByPath).length,
    });

    const agentPath = '__agent__';
    if (openFilesByPath[agentPath]) {
      setOpenFilesByPath((prev) => {
        const next = { ...prev };
        delete next[agentPath];
        return next;
      });
      setEditorGroups((prev) =>
        prev.map((g) => {
          const filtered = g.tabPaths.filter((p) => p !== agentPath);
          const activePath = g.activePath === agentPath ? (filtered[0] ?? null) : g.activePath;
          return { ...g, tabPaths: filtered, activePath };
        })
      );
    }

    void invoke('open_agent_window', { projectPath }).catch((error) => {
      debugLog('agent-button-error', {
        projectPath,
        error: String(error),
      });
    });
  }, [projectPath, openFilesByPath, setOpenFilesByPath, setEditorGroups]);

  const handleToggleTerminal = useCallback(() => {
    if (!hasTerminals) {
      layoutActions.setIsTerminalOpen(true);
      return;
    }
    layoutActions.setIsTerminalOpen((prev: boolean) => !prev);
  }, [hasTerminals, layoutActions]);

  const handleClickSettings = useCallback(() => {
    const settingsPath = '__settings__';

    if (!openFilesByPath[settingsPath]) {
      const settingsFile: OpenFile = {
        kind: 'settings',
        path: settingsPath,
        name: '设置',
        isDirty: false,
      };
      setOpenFilesByPath((prev) => ({ ...prev, [settingsPath]: settingsFile }));
    }

    setEditorGroups((prev) =>
      prev.map((g) => {
        if (g.id !== activeGroupId) return g;
        const nextTabs = g.tabPaths.includes(settingsPath)
          ? g.tabPaths
          : [settingsPath, ...g.tabPaths];
        return { ...g, tabPaths: nextTabs, activePath: settingsPath };
      })
    );
  }, [openFilesByPath, activeGroupId, setOpenFilesByPath, setEditorGroups]);

  const handleSidebarToggleCollapse = useCallback(() => {
    layoutActions.setIsResizing(false);
    layoutActions.setIsSidebarHidden(false);
    setIsFileTreeCollapsed(!isFileTreeCollapsed);
  }, [layoutActions, isFileTreeCollapsed, setIsFileTreeCollapsed]);

  const handleSetExplorerWorkingDir = useCallback(
    (dir: string | null) => {
      setExplorerWorkingDir(dir);
    },
    [setExplorerWorkingDir]
  );

  return {
    handleToggleExplorer,
    handleToggleSearch,
    handleToggleGit,
    handleToggleChat,
    handleToggleAgent,
    handleToggleTerminal,
    handleClickSettings,
    handleSidebarToggleCollapse,
    handleSetExplorerWorkingDir,
  };
}

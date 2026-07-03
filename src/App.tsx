import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import type { FileNode } from './components/FileTree';
import type { RenamingItem } from './types/file';
import TitleBar from './components/TitleBar';
import SaveConfirmModal from './components/SaveConfirmModal';
import ActivityBar from './components/ActivityBar';
import { DragPreviewWindow } from './components/DragPreviewWindow';
import { EditorContextMenu } from './components/editor/EditorContextMenu';
import { EditorSplitView } from './components/editor/EditorSplitView';
import { DragOverlayContent } from './components/editor/DragOverlayContent';
import { FileTreeContextMenu } from './components/FileTreeContextMenu';
import { SidebarArea } from './components/SidebarArea';
import { PanelArea } from './components/PanelArea';
import { ChatPanelArea } from './components/ChatPanelArea';
import { NotificationProvider, useNotification } from './contexts/NotificationContext';
import { I18nProvider, useTranslation } from './i18n';
import {
  useSidebarWidth,
  useIsResizing,
  useIsChatPanelOpen,
  useChatPanelWidth,
  useIsChatPanelResizing,
  useIsTerminalOpen,
  useTerminalHeight,
  useIsTerminalResizing,
  useHasTerminals,
  useActiveSidebarView,
  useLayoutActions,
  useTabSize,
  useAutoSaveDelay,
  useFontSize,
  useWordWrap,
  useLineNumbers,
  useMinimap,
  useCursorStyle,
  useCursorBlinking,
  useFormatOnSave,
  useExcludePatterns,
  useFileSortBy,
  useFoldersFirst,
  useKeyBindings,
  useLanguage,
  useThemeMode,
  useCompactFolders,
  useAutoRevealCurrentFile,
  useEnableCodeGraph,
  useGraphAutoIndexOnOpen,
  useGraphAutoIndexMaxFiles,
  useRenderWhitespace,
  useCurrentLineHighlight,
  useCurrentLineHighlightColor,
  useBracketPairColorization,
  useSettingsLoading,
  useInitializeSettings,
  useEditorOpenFiles,
  useEditorGroups,
  useEditorActiveGroupId,
  useEditorHoveredTabId,
  useEditorSplitDirection,
  useEditorSplitRatioRow,
  useEditorSplitRatioColumn,
  useEditorIsSplitResizing,
  useEditorModalOpen,
  useEditorTabToClose,
  useEditorContextMenu,
  useEditorActions,
} from './stores';
import { applyCurrentLineHighlightColor, resolveThemeFromMode } from './utils/lineHighlightColor';
import {
  shouldSkipFileTreeCopyShortcut,
  shouldSkipFileTreeKeyboardShortcut,
} from './utils/fileTreeKeyboard';
import { refreshMonacoTheme } from './utils/monacoTheme';
import { useSettingsStore } from './stores/useSettingsStore';
import { useLayoutResize } from './hooks/useLayoutResize';
import { useCbmGraphReady, useCbmSidecarState, useCbmStore } from './stores/useCbmStore';
import { useCbmIndexEvents } from './hooks/useCbmIndexEvents';
import { useCbmConfigSync } from './hooks/useCbmConfigSync';
import { useCbmMainWindowReindex } from './hooks/useCbmMainWindowReindex';
import { useIndexedProjects } from './hooks/useIndexedProjects';
import { isCbmSkippedTooLarge, scheduleCbmWorkspaceIndex } from './utils/cbmRuntime';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  CollisionDetection,
  pointerWithin,
} from '@dnd-kit/core';

import {
  type OpenFile,
  type EditorGroupId,
  type EditorGroupState,
  SPLIT_ZONE_RIGHT_ID,
  SPLIT_ZONE_DOWN_ID,
  OPEN_ZONE_LEFT_ID,
} from './types/app';

import {
  getBasename,
  getParentDir,
  normalizePathForCompare,
  normalizeEolForCompare,
  isPathUnderRoot,
  toRelativePathUnderProject,
} from './utils/pathUtils';

import {
  buildExcludeMatchers,
  filterFileTreeByExcludePatterns,
  sortFileTreeNodes,
  isImageFilePath,
} from './utils/fileTreeUtils';

import { useFileTree } from './hooks/useFileTree';
import { useDragDropHandlers } from './hooks/useDragDropHandlers';
import { useLiveServer } from './hooks/useLiveServer';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useAutoSave } from './hooks/useAutoSave';
import { useEditorSplitResize } from './hooks/useEditorSplitResize';
import { useFileChangeSync } from './hooks/useFileChangeSync';
import {
  useAppLifecycle,
  useEditorOperations,
  useKeyboardShortcuts,
  useFileOperations,
  useTabOperations,
  useSaveHandlers,
  useActivityBarCallbacks,
  useOpenFileHandlers,
} from './components/app';

function AppContent() {
  const t = useTranslation();
  const tabSize = useTabSize();
  const autoSaveDelay = useAutoSaveDelay();
  const fontSize = useFontSize();
  const wordWrap = useWordWrap();
  const lineNumbers = useLineNumbers();
  const minimap = useMinimap();
  const cursorStyle = useCursorStyle();
  const cursorBlinking = useCursorBlinking();
  const formatOnSave = useFormatOnSave();
  const excludePatterns = useExcludePatterns();
  const fileSortBy = useFileSortBy();
  const foldersFirst = useFoldersFirst();
  const keyBindings = useKeyBindings();
  const themeMode = useThemeMode();
  const compactFolders = useCompactFolders();
  const autoRevealCurrentFile = useAutoRevealCurrentFile();
  const enableCodeGraph = useEnableCodeGraph();
  const graphAutoIndexOnOpen = useGraphAutoIndexOnOpen();
  const graphAutoIndexMaxFiles = useGraphAutoIndexMaxFiles();
  const cbmGraphEnabled = useCbmGraphReady(enableCodeGraph);
  const { available: cbmSidecarAvailable } = useCbmSidecarState();
  const {
    projects: indexedProjects,
    loading: indexedProjectsLoading,
    loadAndReconcile,
    deleteIndex: deleteIndexedProject,
  } = useIndexedProjects(enableCodeGraph, cbmGraphEnabled);

  useEffect(() => {
    void useCbmStore.getState().initialize();
  }, []);
  useCbmIndexEvents(cbmGraphEnabled && graphAutoIndexOnOpen);
  useCbmConfigSync();
  const renderWhitespace = useRenderWhitespace();
  const currentLineHighlight = useCurrentLineHighlight();
  const bracketPairColorization = useBracketPairColorization();

  const { showError, showWarning } = useNotification();

  const sidebarWidth = useSidebarWidth();
  const isResizing = useIsResizing();
  const isChatPanelOpen = useIsChatPanelOpen();
  const chatPanelWidth = useChatPanelWidth();
  const isChatPanelResizing = useIsChatPanelResizing();
  const isTerminalOpen = useIsTerminalOpen();
  const terminalHeight = useTerminalHeight();
  const isTerminalResizing = useIsTerminalResizing();
  const hasTerminals = useHasTerminals();
  const activeSidebarView = useActiveSidebarView();

  const layoutActions = useLayoutActions();

  const editorAreaRef = useRef<HTMLDivElement | null>(null);
  const [fileTreeContextMenu, setFileTreeContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode | null;
  } | null>(null);
  const [renamingItem, setRenamingItem] = useState<RenamingItem | null>(null);
  const [activeTreeNode, setActiveTreeNode] = useState<FileNode | null>(null);
  const [selectedTreeNodePaths, setSelectedTreeNodePaths] = useState<Set<string>>(new Set());
  const [treeSelectionAnchorPath, setTreeSelectionAnchorPath] = useState<string | null>(null);
  const [treeClipboard, setTreeClipboard] = useState<{
    mode: 'copy' | 'cut';
    nodes: FileNode[];
  } | null>(null);

  const { handleSidebarResizeStart, handleChatPanelResizeStart, handleTerminalResizeStart } =
    useLayoutResize(editorAreaRef);

  const programmaticRefreshPathsRef = useRef<Set<string>>(new Set());

  const autoSaveTimersRef = useRef<Map<string, number>>(new Map());
  const clearAutoSaveTimer = useCallback((filePath: string) => {
    const timer = autoSaveTimersRef.current.get(filePath);
    if (timer !== undefined) {
      clearTimeout(timer);
      autoSaveTimersRef.current.delete(filePath);
    }
  }, []);

  const {
    fileTree,
    projectName,
    projectPath,
    expandedDirs,
    loadingDirs,
    isFileTreeCollapsed,
    explorerWorkingDir,
    setFileTree,
    setProjectName,
    setProjectPath,
    setExpandedDirs,
    setLoadingDirs,
    setIsFileTreeCollapsed,
    setExplorerWorkingDir,
    loadFolderChildren,
    toggleDir,
    refreshFileTreeFromDisk,
    handleMoveNode,
  } = useFileTree();

  useCbmMainWindowReindex(projectPath);

  const openFilesByPath = useEditorOpenFiles();
  const editorGroups = useEditorGroups();
  const activeGroupId = useEditorActiveGroupId();
  const hoveredTabId = useEditorHoveredTabId();
  const splitDirection = useEditorSplitDirection();
  const splitRatioRow = useEditorSplitRatioRow();
  const splitRatioColumn = useEditorSplitRatioColumn();
  const isEditorSplitResizing = useEditorIsSplitResizing();
  const modalOpen = useEditorModalOpen();
  const tabToClose = useEditorTabToClose();
  const editorContextMenu = useEditorContextMenu();

  const {
    setOpenFilesByPath,
    setEditorGroups,
    setActiveGroupId,
    setHoveredTabId,
    setSplitDirection,
    setSplitRatioRow,
    setSplitRatioColumn,
    setIsEditorSplitResizing,
    setModalOpen,
    setTabToClose,
    setEditorContextMenu,
  } = useEditorActions();

  const openFilesByPathRef = useRef<Record<string, OpenFile>>(openFilesByPath);
  openFilesByPathRef.current = openFilesByPath;

  const editorGroupsRef = useRef<EditorGroupState[]>(editorGroups);
  editorGroupsRef.current = editorGroups;

  const editorSplitContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    liveServerStatus,
    getLiveServerStatus,
    openWithLiveServer,
    openInBrowserViaLiveServer,
    stopLiveServer,
  } = useLiveServer();

  const { isAnyAgentBusy, agentBusyPanelsRef } = useAppLifecycle({
    openFilesByPath,
    editorGroups,
    activeGroupId,
    setOpenFilesByPath,
    setEditorGroups,
    setActiveGroupId,
  });

  const editorOps = useEditorOperations({
    tabSize,
    openFilesByPath,
    programmaticRefreshPathsRef,
    editorGroups,
    activeGroupId,
    setActiveGroupId,
    setEditorContextMenu,
  });
  const {
    editorInstanceByGroupRef,
    editorMountedFilePathByGroupRef,
    handleEditorMount,
    layoutEditors,
    runEditorCommand,
  } = editorOps;

  const isSplit = editorGroups.length > 1;

  const { handleFilesChanged, isIgnoredByProjectWatcher } = useFileChangeSync({
    openFilesByPathRef,
    programmaticRefreshPathsRef,
    editorInstanceByGroupRef,
    editorMountedFilePathByGroupRef,
    projectPath,
    refreshFileTreeFromDisk,
    setOpenFilesByPath,
    setEditorGroups,
  });

  const openFileInGroup = useCallback(
    async (filePath: string, targetGroupId: EditorGroupId, forceRefresh?: boolean) => {
      const existing = openFilesByPathRef.current[filePath];
      if (existing && !forceRefresh) {
        if (existing.kind === 'text' && !existing.isDirty) {
          try {
            const latestContent = await invoke<string>('read_file_content', { filePath });
            if (
              normalizeEolForCompare(existing.content) !== normalizeEolForCompare(latestContent)
            ) {
              setOpenFilesByPath((prev) => {
                const current = prev[filePath];
                if (!current || current.kind !== 'text' || current.isDirty) return prev;
                if (
                  normalizeEolForCompare(current.content) === normalizeEolForCompare(latestContent)
                ) {
                  return prev;
                }
                return {
                  ...prev,
                  [filePath]: {
                    ...current,
                    content: latestContent,
                    isDirty: false,
                    isDeleted: false,
                  },
                };
              });
            }
          } catch (error) {
            console.warn(
              '[openFileInGroup] Failed to refresh existing file before activate:',
              error
            );
          }
        }

        setEditorGroups((prev) =>
          prev.map((g) => {
            if (g.id !== targetGroupId) return g;
            const nextTabs = g.tabPaths.includes(filePath) ? g.tabPaths : [filePath, ...g.tabPaths];
            return { ...g, tabPaths: nextTabs, activePath: filePath };
          })
        );
        setActiveGroupId(targetGroupId);
        return;
      }

      const fileName = getBasename(filePath) || 'unknown';
      const newFile: OpenFile = isImageFilePath(filePath)
        ? {
            kind: 'image',
            path: filePath,
            name: fileName,
            src: convertFileSrc(filePath),
            isDirty: false,
          }
        : {
            kind: 'text',
            path: filePath,
            name: fileName,
            content: await invoke<string>('read_file_content', { filePath }),
            isDirty: false,
          };

      setOpenFilesByPath((prev) => ({ ...prev, [filePath]: newFile }));
      setEditorGroups((prev) =>
        prev.map((g) => {
          if (g.id !== targetGroupId) return g;
          const nextTabs = g.tabPaths.includes(filePath) ? g.tabPaths : [filePath, ...g.tabPaths];
          return { ...g, tabPaths: nextTabs, activePath: filePath };
        })
      );
      setActiveGroupId(targetGroupId);

      if (
        !projectPath ||
        !isPathUnderRoot(filePath, projectPath) ||
        isIgnoredByProjectWatcher(filePath)
      ) {
        invoke('watch_file', { path: filePath }).catch((err) => {
          console.warn('[openFileInGroup] Failed to watch external file:', err);
        });
      }
    },
    [setEditorGroups, setActiveGroupId, setOpenFilesByPath, projectPath, isIgnoredByProjectWatcher]
  );

  const dragDropHandlers = useDragDropHandlers({
    fileTree,
    openFilesByPath,
    openFilesByPathRef,
    editorGroups,
    editorGroupsRef,
    activeGroupId,
    splitDirection,
    setEditorGroups,
    setActiveGroupId: ((id: EditorGroupId) => setActiveGroupId(id)) as Dispatch<
      SetStateAction<EditorGroupId>
    >,
    setSplitDirection: ((direction: 'row' | 'column') => setSplitDirection(direction)) as Dispatch<
      SetStateAction<'row' | 'column'>
    >,
    setSplitRatioRow: ((ratio: number) => setSplitRatioRow(ratio)) as Dispatch<
      SetStateAction<number>
    >,
    setSplitRatioColumn: ((ratio: number) => setSplitRatioColumn(ratio)) as Dispatch<
      SetStateAction<number>
    >,
    setOpenFilesByPath,
    openFileInGroup,
    handleMoveNode,
    projectPath,
  });
  const { activeNode, activeTab, handleDragStart, handleDragEnd, handleDragCancel } =
    dragDropHandlers;

  const focusedGroup = editorGroups.find((g) => g.id === activeGroupId) || editorGroups[0];
  const focusedActiveFilePath = focusedGroup?.activePath || null;
  const focusedActiveFile = focusedActiveFilePath ? openFilesByPath[focusedActiveFilePath] : null;

  const terminalWorkingDir = useMemo(() => {
    const normalize = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/g, '');
    const root = projectPath ? normalize(projectPath) : null;

    if (!root) return null;

    const candidate = explorerWorkingDir
      ? normalize(explorerWorkingDir)
      : focusedActiveFilePath
        ? normalize(getParentDir(focusedActiveFilePath))
        : null;

    if (!candidate) return root;

    if (candidate === root) return root;
    if (candidate.startsWith(root + '\\')) return root;
    return root;
  }, [projectPath, explorerWorkingDir, focusedActiveFilePath]);

  const excludeMatchers = useMemo(() => buildExcludeMatchers(excludePatterns), [excludePatterns]);
  const visibleFileTree = useMemo(
    () => filterFileTreeByExcludePatterns(fileTree, projectPath, excludeMatchers),
    [fileTree, projectPath, excludeMatchers]
  );
  const sortedVisibleFileTree = useMemo(
    () => sortFileTreeNodes(visibleFileTree, fileSortBy, foldersFirst),
    [visibleFileTree, fileSortBy, foldersFirst]
  );
  const flatVisibleTreeNodes = useMemo(() => {
    const nodes: FileNode[] = [];
    const walk = (list: FileNode[]) => {
      for (const node of list) {
        nodes.push(node);
        if (node.is_dir && expandedDirs.has(node.path) && node.children && node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(sortedVisibleFileTree);
    return nodes;
  }, [expandedDirs, sortedVisibleFileTree]);
  const allTreeNodesByPath = useMemo(() => {
    const map = new Map<string, FileNode>();
    const walk = (list: FileNode[]) => {
      for (const node of list) {
        map.set(node.path, node);
        if (node.children && node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(fileTree);
    return map;
  }, [fileTree]);
  const treeClipboardMode = treeClipboard?.mode ?? null;
  const treeClipboardPaths = useMemo(
    () => new Set(treeClipboard?.nodes.map((node) => node.path) ?? []),
    [treeClipboard]
  );

  useEffect(() => {
    const availablePaths = new Set(allTreeNodesByPath.keys());
    setSelectedTreeNodePaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const path of prev) {
        if (availablePaths.has(path)) {
          next.add(path);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setActiveTreeNode((prev) => (prev && availablePaths.has(prev.path) ? prev : null));
    setTreeSelectionAnchorPath((prev) => (prev && availablePaths.has(prev) ? prev : null));
  }, [allTreeNodesByPath]);

  useFileWatcher({ projectPath, onFilesChanged: handleFilesChanged });

  useEffect(() => {
    if (!cbmGraphEnabled || !graphAutoIndexOnOpen || !projectPath?.trim()) {
      return;
    }
    const timer = window.setTimeout(() => {
      void scheduleCbmWorkspaceIndex(projectPath, {
        maxFiles: graphAutoIndexMaxFiles > 0 ? graphAutoIndexMaxFiles : undefined,
      }).then((result) => {
        if (isCbmSkippedTooLarge(result)) {
          showWarning(t.graph.projectTooLarge);
        }
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [cbmGraphEnabled, graphAutoIndexMaxFiles, graphAutoIndexOnOpen, projectPath, showWarning, t.graph.projectTooLarge]);

  const {
    handleOpenFolder,
    handleSelectFile,
    handleOpenFile,
    openFolderAtPath,
  } = useOpenFileHandlers({
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
  });

  const {
    handleActivateTab,
    handleSplitRight,
    handleSplitDown,
    handleSingle,
    handleFocusGroup,
    closeTabDirectly,
    handleCloseTab,
  } = useTabOperations({
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
    setActiveGroupId: ((id: EditorGroupId) => setActiveGroupId(id)) as Dispatch<
      SetStateAction<EditorGroupId>
    >,
    setHoveredTabId: ((id: string | null) => setHoveredTabId(id)) as Dispatch<
      SetStateAction<string | null>
    >,
    setSplitDirection: ((direction: 'row' | 'column') => setSplitDirection(direction)) as Dispatch<
      SetStateAction<'row' | 'column'>
    >,
    setIsEditorSplitResizing: ((resizing: boolean) =>
      setIsEditorSplitResizing(resizing)) as Dispatch<SetStateAction<boolean>>,
    setOpenFilesByPath,
    showWarning,
    onShowSaveModal: (groupId, filePath) => {
      setTabToClose({ groupId, filePath });
      setModalOpen(true);
    },
  });

  const {
    saveFileInternal,
    handleConfirmSave,
    handleConfirmDontSave,
    handleCancelClose,
    handleSaveFile,
  } = useSaveHandlers({
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
  });

  const { handleEditorChange } = useAutoSave({
    autoSaveDelay,
    formatOnSave,
    openFilesByPathRef,
    editorInstanceByGroupRef,
    editorMountedFilePathByGroupRef,
    programmaticRefreshPathsRef,
    setOpenFilesByPath,
    saveFileInternal,
    autoSaveTimersRef,
    clearAutoSaveTimer,
  });

  useEffect(() => {
    const handleResize = () => {
      requestAnimationFrame(() => {
        layoutEditors();
      });
    };

    const container = editorAreaRef.current;
    let resizeObserver: ResizeObserver | null = null;

    if (container) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(container);
    }

    return () => {
      if (resizeObserver && container) {
        resizeObserver.unobserve(container);
        resizeObserver.disconnect();
      }
    };
  }, [editorAreaRef, layoutEditors]);

  const {
    creatingItem,
    handleCreateFile,
    handleCreateFolder,
    startCreateItemAt,
    handleConfirmCreate,
    handleCancelCreate,
  } = useFileOperations({
    projectPath,
    focusedActiveFilePath,
    setProjectName,
    setProjectPath,
    setExpandedDirs,
    setLoadingDirs,
    loadFolderChildren,
    onSelectFile: handleSelectFile,
    showWarning,
    showError,
  });

  const closeFileTreeContextMenu = useCallback(() => {
    setFileTreeContextMenu(null);
  }, []);

  const cancelFileTreeRename = useCallback(() => {
    setRenamingItem(null);
  }, []);

  const remapOpenPaths = useCallback((oldPath: string, newPath: string) => {
    const normalizedOldPath = normalizePathForCompare(oldPath);
    const normalizedOldPathLower = normalizedOldPath.toLowerCase();
    const oldPrefix = `${normalizedOldPathLower}\\`;

    const mapPath = (candidate: string) => {
      const normalizedCandidate = normalizePathForCompare(candidate);
      const normalizedCandidateLower = normalizedCandidate.toLowerCase();
      if (normalizedCandidateLower === normalizedOldPathLower) {
        return newPath;
      }
      if (normalizedCandidateLower.startsWith(oldPrefix)) {
        return `${newPath}\\${normalizedCandidate.slice(normalizedOldPath.length + 1)}`;
      }
      return candidate;
    };

    setOpenFilesByPath((prev) => {
      let changed = false;
      const next: typeof prev = {};

      for (const [path, file] of Object.entries(prev)) {
        const mappedPath = mapPath(path);
        if (mappedPath !== path) {
          changed = true;
          const mappedName = getBasename(mappedPath);
          next[mappedPath] = file.kind === 'image'
            ? { ...file, path: mappedPath, name: mappedName, src: convertFileSrc(mappedPath) }
            : { ...file, path: mappedPath, name: mappedName };
        } else {
          next[path] = file;
        }
      }

      return changed ? next : prev;
    });

    setEditorGroups((prev) => prev.map((group) => ({
      ...group,
      tabPaths: group.tabPaths.map(mapPath),
      activePath: group.activePath ? mapPath(group.activePath) : null,
    })));
  }, [setEditorGroups, setOpenFilesByPath]);

  const remapPathSet = useCallback((
    oldPath: string,
    newPath: string,
    setter: typeof setExpandedDirs | typeof setLoadingDirs,
  ) => {
    const normalizedOldPath = normalizePathForCompare(oldPath);
    const normalizedOldPathLower = normalizedOldPath.toLowerCase();
    const oldPrefix = `${normalizedOldPathLower}\\`;

    const mapPath = (candidate: string) => {
      const normalizedCandidate = normalizePathForCompare(candidate);
      const normalizedCandidateLower = normalizedCandidate.toLowerCase();
      if (normalizedCandidateLower === normalizedOldPathLower) {
        return newPath;
      }
      if (normalizedCandidateLower.startsWith(oldPrefix)) {
        return `${newPath}\\${normalizedCandidate.slice(normalizedOldPath.length + 1)}`;
      }
      return candidate;
    };

    setter((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const path of prev) {
        const mappedPath = mapPath(path);
        if (mappedPath !== path) {
          changed = true;
        }
        next.add(mappedPath);
      }
      return changed ? next : prev;
    });
  }, [setExpandedDirs, setLoadingDirs]);

  const removeOpenPathsUnder = useCallback((targetPath: string) => {
    const normalizedTargetPath = normalizePathForCompare(targetPath);
    const normalizedTargetLower = normalizedTargetPath.toLowerCase();
    const targetPrefix = `${normalizedTargetLower}\\`;

    const shouldRemove = (candidate: string) => {
      const normalizedCandidateLower = normalizePathForCompare(candidate).toLowerCase();
      return (
        normalizedCandidateLower === normalizedTargetLower ||
        normalizedCandidateLower.startsWith(targetPrefix)
      );
    };

    setOpenFilesByPath((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const path of Object.keys(prev)) {
        if (!shouldRemove(path)) continue;
        delete next[path];
        changed = true;
      }
      return changed ? next : prev;
    });

    setEditorGroups((prev) =>
      prev.map((group) => {
        const nextTabPaths = group.tabPaths.filter((path) => !shouldRemove(path));
        const nextActivePath =
          group.activePath && shouldRemove(group.activePath)
            ? nextTabPaths[0] ?? null
            : group.activePath;

        if (
          nextTabPaths.length === group.tabPaths.length &&
          nextActivePath === group.activePath
        ) {
          return group;
        }

        return {
          ...group,
          tabPaths: nextTabPaths,
          activePath: nextActivePath,
        };
      })
    );
  }, [setEditorGroups, setOpenFilesByPath]);

  const resolveTreeOperationNodes = useCallback((primaryNode: FileNode) => {
    const selectedPaths = selectedTreeNodePaths.has(primaryNode.path)
      ? Array.from(selectedTreeNodePaths)
      : [primaryNode.path];

    const candidateNodes = selectedPaths
      .map((path) => allTreeNodesByPath.get(path))
      .filter((node): node is FileNode => Boolean(node));

    const filteredNodes = candidateNodes.filter((node) => {
      const normalizedNodePath = normalizePathForCompare(node.path).toLowerCase();
      return !candidateNodes.some((other) => {
        if (other.path === node.path) {
          return false;
        }
        const normalizedOtherPath = normalizePathForCompare(other.path).toLowerCase();
        return normalizedNodePath.startsWith(`${normalizedOtherPath}\\`);
      });
    });

    const visibleOrder = new Map(flatVisibleTreeNodes.map((node, index) => [node.path, index] as const));
    return filteredNodes.sort((a, b) => {
      const indexA = visibleOrder.get(a.path) ?? Number.MAX_SAFE_INTEGER;
      const indexB = visibleOrder.get(b.path) ?? Number.MAX_SAFE_INTEGER;
      return indexA - indexB;
    });
  }, [allTreeNodesByPath, flatVisibleTreeNodes, selectedTreeNodePaths]);

  const handleActivateTreeNode = useCallback((
    node: FileNode,
    options?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; contextMenu?: boolean }
  ) => {
    const ctrlOrMeta = options?.ctrlKey || options?.metaKey;
    const shiftKey = options?.shiftKey ?? false;
    const contextMenu = options?.contextMenu ?? false;
    const clickedPath = node.path;

    setActiveTreeNode(node);

    if (contextMenu) {
      if (!selectedTreeNodePaths.has(clickedPath)) {
        setSelectedTreeNodePaths(new Set([clickedPath]));
        setTreeSelectionAnchorPath(clickedPath);
      }
      return;
    }

    if (shiftKey) {
      const anchorPath = treeSelectionAnchorPath ?? activeTreeNode?.path ?? clickedPath;
      const startIndex = flatVisibleTreeNodes.findIndex((item) => item.path === anchorPath);
      const endIndex = flatVisibleTreeNodes.findIndex((item) => item.path === clickedPath);

      if (startIndex !== -1 && endIndex !== -1) {
        const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        setSelectedTreeNodePaths(
          new Set(flatVisibleTreeNodes.slice(from, to + 1).map((item) => item.path))
        );
      } else {
        setSelectedTreeNodePaths(new Set([clickedPath]));
      }
      return;
    }

    if (ctrlOrMeta) {
      setSelectedTreeNodePaths((prev) => {
        const next = new Set(prev);
        if (next.has(clickedPath)) {
          next.delete(clickedPath);
        } else {
          next.add(clickedPath);
        }
        return next;
      });
      setTreeSelectionAnchorPath(clickedPath);
      return;
    }

    setSelectedTreeNodePaths(new Set([clickedPath]));
    setTreeSelectionAnchorPath(clickedPath);
  }, [activeTreeNode?.path, flatVisibleTreeNodes, selectedTreeNodePaths, treeSelectionAnchorPath]);

  const handleFileTreeContextMenu = useCallback((node: FileNode, x: number, y: number) => {
    setFileTreeContextMenu({ node, x, y });
  }, []);

  const handleFileTreeBlankContextMenu = useCallback((x: number, y: number) => {
    setFileTreeContextMenu({ node: null, x, y });
  }, []);

  useEffect(() => {
    if (
      !autoRevealCurrentFile ||
      !projectPath ||
      !focusedActiveFilePath ||
      !isPathUnderRoot(focusedActiveFilePath, projectPath)
    ) {
      return;
    }

    let cancelled = false;

    const expandToActiveFile = async () => {
      const normalizedRoot = normalizePathForCompare(projectPath);
      let currentDir = normalizePathForCompare(getParentDir(focusedActiveFilePath));
      const ancestorDirs: string[] = [];

      while (
        currentDir &&
        currentDir !== normalizedRoot &&
        isPathUnderRoot(currentDir, normalizedRoot)
      ) {
        ancestorDirs.push(currentDir);
        const nextDir = normalizePathForCompare(getParentDir(currentDir));
        if (nextDir === currentDir) {
          break;
        }
        currentDir = nextDir;
      }

      ancestorDirs.reverse();

      if (ancestorDirs.length > 0) {
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const dir of ancestorDirs) {
            if (!next.has(dir)) {
              next.add(dir);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }

      for (const dir of ancestorDirs) {
        if (cancelled) {
          return;
        }

        const existingNode = allTreeNodesByPath.get(dir);
        if (!existingNode?.children_loaded) {
          await loadFolderChildren(dir, { silent: true });
        }
      }
    };

    void expandToActiveFile();

    return () => {
      cancelled = true;
    };
  }, [
    allTreeNodesByPath,
    autoRevealCurrentFile,
    focusedActiveFilePath,
    loadFolderChildren,
    projectPath,
    setExpandedDirs,
  ]);

  const handleFileTreeCreateAtNode = useCallback((node: FileNode, type: 'file' | 'folder') => {
    setRenamingItem(null);
    const parentPath = node.is_dir ? node.path : getParentDir(node.path);
    startCreateItemAt(type, parentPath);
  }, [startCreateItemAt]);

  const handleFileTreeCreateAtRoot = useCallback((type: 'file' | 'folder') => {
    if (!projectPath) {
      showWarning('请先打开一个文件夹');
      return;
    }
    setRenamingItem(null);
    startCreateItemAt(type, projectPath);
  }, [projectPath, showWarning, startCreateItemAt]);

  const startFileTreeRename = useCallback((node: FileNode) => {
    setRenamingItem({
      path: node.path,
      name: node.name,
      isDir: node.is_dir,
    });
  }, []);

  const handleFileTreeRename = useCallback(async (nextName: string) => {
    const currentItem = renamingItem;
    const trimmedName = nextName.trim();
    if (!currentItem) {
      return;
    }

    if (!trimmedName || trimmedName === currentItem.name) {
      setRenamingItem(null);
      return;
    }

    const parentDir = getParentDir(currentItem.path);
    const separator = currentItem.path.includes('/') ? '/' : '\\';
    const newPath = parentDir ? `${parentDir}${separator}${trimmedName}` : trimmedName;
    const wasExpanded =
      currentItem.isDir &&
      Array.from(expandedDirs).some(
        (path) =>
          normalizePathForCompare(path).toLowerCase() ===
          normalizePathForCompare(currentItem.path).toLowerCase()
      );

    try {
      await invoke('move_file_or_folder', {
        oldPath: currentItem.path,
        newPath,
        overwrite: false,
        rootPath: projectPath || undefined,
      });
      remapOpenPaths(currentItem.path, newPath);
      remapPathSet(currentItem.path, newPath, setExpandedDirs);
      remapPathSet(currentItem.path, newPath, setLoadingDirs);
      await refreshFileTreeFromDisk([currentItem.path, newPath]);
      if (wasExpanded) {
        await loadFolderChildren(newPath, { silent: true });
      }
      setRenamingItem(null);
    } catch (error) {
      showError(`重命名失败: ${error}`);
    }
  }, [expandedDirs, loadFolderChildren, projectPath, refreshFileTreeFromDisk, remapOpenPaths, remapPathSet, renamingItem, setExpandedDirs, setLoadingDirs, showError]);

  const handleFileTreeDelete = useCallback(async (node: FileNode) => {
    const nodes = resolveTreeOperationNodes(node);
    try {
      for (const targetNode of nodes) {
        await invoke('delete_file_or_folder', {
          path: targetNode.path,
          permanent: false,
          rootPath: projectPath || undefined,
        });
        removeOpenPathsUnder(targetNode.path);
      }
      setSelectedTreeNodePaths(new Set());
      setTreeSelectionAnchorPath(null);
      setActiveTreeNode(null);
      const refreshPaths = nodes.flatMap((targetNode) => [targetNode.path, getParentDir(targetNode.path)]);
      await refreshFileTreeFromDisk(refreshPaths);
    } catch (error) {
      showError(`删除失败: ${error}`);
    }
  }, [projectPath, refreshFileTreeFromDisk, removeOpenPathsUnder, resolveTreeOperationNodes, showError]);

  const handleFileTreeCopyPath = useCallback(async (node: FileNode) => {
    try {
      await navigator.clipboard.writeText(node.path);
    } catch (error) {
      showError(`复制路径失败: ${error}`);
    }
  }, [showError]);

  const handleFileTreeCopyRelativePath = useCallback(async (node: FileNode) => {
    if (!projectPath || !isPathUnderRoot(node.path, projectPath)) {
      showError('复制相对路径失败: 当前路径不在项目目录内');
      return;
    }

    const relativePath = toRelativePathUnderProject(node.path, projectPath);
    const projectRootName = getBasename(normalizePathForCompare(projectPath));
    const projectRelativePath = relativePath
      ? `${projectRootName}/${relativePath}`
      : projectRootName;

    try {
      await navigator.clipboard.writeText(projectRelativePath);
    } catch (error) {
      showError(`复制相对路径失败: ${error}`);
    }
  }, [projectPath, showError]);

  const handleFileTreeRevealInExplorer = useCallback(async (node: FileNode) => {
    try {
      await revealItemInDir(node.path);
    } catch (error) {
      showError(`在资源管理器中显示失败: ${error}`);
    }
  }, [showError]);

  const handleRootCopyPath = useCallback(async () => {
    if (!projectPath) {
      return;
    }
    try {
      await navigator.clipboard.writeText(projectPath);
    } catch (error) {
      showError(`复制路径失败: ${error}`);
    }
  }, [projectPath, showError]);

  const handleRootCopyRelativePath = useCallback(async () => {
    if (!projectPath) {
      return;
    }
    try {
      await navigator.clipboard.writeText(getBasename(normalizePathForCompare(projectPath)));
    } catch (error) {
      showError(`复制相对路径失败: ${error}`);
    }
  }, [projectPath, showError]);

  const handleRootRevealInExplorer = useCallback(async () => {
    if (!projectPath) {
      return;
    }
    try {
      await revealItemInDir(projectPath);
    } catch (error) {
      showError(`在资源管理器中显示失败: ${error}`);
    }
  }, [projectPath, showError]);

  const handleFileTreeRefresh = useCallback(async (node: FileNode) => {
    try {
      await loadFolderChildren(node.path);
    } catch (error) {
      showError(`刷新失败: ${error}`);
    }
  }, [loadFolderChildren, showError]);

  const handleFileTreeRefreshRoot = useCallback(async () => {
    if (!projectPath) {
      return;
    }

    try {
      await loadFolderChildren(projectPath, { silent: true });
    } catch (error) {
      showError(`刷新失败: ${error}`);
    }
  }, [loadFolderChildren, projectPath, showError]);

  const handleToggleTreeNodeExpanded = useCallback((node: FileNode) => {
    if (!node.is_dir) {
      return;
    }
    toggleDir(node.path);
  }, [toggleDir]);

  const handleExpandAllTreeNodes = useCallback(async () => {
    const dirPaths: string[] = [];
    const unloadedDirPaths: string[] = [];
    const blockedDirNames = new Set([
      'node_modules',
      'dist',
      'build',
      'target',
      'coverage',
      'vendor',
      '.git',
      '.svn',
      '.hg',
      '.idea',
      '.vscode',
      '.next',
      '.nuxt',
      '.cache',
      '.turbo',
      '.output',
      'bin',
      'obj',
    ]);

    const walk = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (!node.is_dir) {
          continue;
        }
        const dirName = node.name.trim().toLowerCase();
        if (dirName.startsWith('.') || blockedDirNames.has(dirName)) {
          continue;
        }
        dirPaths.push(node.path);
        if (!node.children_loaded) {
          unloadedDirPaths.push(node.path);
        }
        if (node.children && node.children.length > 0) {
          walk(node.children);
        }
      }
    };

    walk(fileTree);
    setExpandedDirs(new Set(dirPaths));

    for (const dirPath of unloadedDirPaths) {
      try {
        await loadFolderChildren(dirPath, { silent: true });
      } catch {
        /* ignore partial expand failures */
      }
    }
  }, [fileTree, loadFolderChildren, setExpandedDirs]);

  const handleCollapseAllTreeNodes = useCallback(() => {
    setExpandedDirs(new Set());
    setLoadingDirs(new Set());
  }, [setExpandedDirs, setLoadingDirs]);

  const remapTreeNode = useCallback((node: FileNode | null, oldPath: string, newPath: string) => {
    if (!node) {
      return node;
    }

    const normalizedOldPath = normalizePathForCompare(oldPath);
    const normalizedNodePath = normalizePathForCompare(node.path);
    const normalizedOldPathLower = normalizedOldPath.toLowerCase();
    const normalizedNodePathLower = normalizedNodePath.toLowerCase();
    const oldPrefix = `${normalizedOldPathLower}\\`;

    if (normalizedNodePathLower === normalizedOldPathLower) {
      return {
        ...node,
        path: newPath,
        name: getBasename(newPath),
      };
    }

    if (normalizedNodePathLower.startsWith(oldPrefix)) {
      const mappedPath = `${newPath}\\${normalizedNodePath.slice(normalizedOldPath.length + 1)}`;
      return {
        ...node,
        path: mappedPath,
        name: getBasename(mappedPath),
      };
    }

    return node;
  }, []);

  const handleCopyTreeNode = useCallback((node: FileNode) => {
    const nodes = resolveTreeOperationNodes(node);
    setTreeClipboard({ mode: 'copy', nodes });
  }, [resolveTreeOperationNodes]);

  const handleCutTreeNode = useCallback((node: FileNode) => {
    const nodes = resolveTreeOperationNodes(node);
    setTreeClipboard({ mode: 'cut', nodes });
  }, [resolveTreeOperationNodes]);

  const canPasteTreeNodeToDirectory = useCallback((targetDir: string) => {
    if (!treeClipboard) {
      return false;
    }

    const targetPath = normalizePathForCompare(targetDir).toLowerCase();
    return treeClipboard.nodes.every((node) => {
      const sourcePath = normalizePathForCompare(node.path).toLowerCase();
      if (sourcePath === targetPath) {
        return false;
      }
      if (treeClipboard.mode === 'cut') {
        const sourceParentPath = normalizePathForCompare(getParentDir(node.path)).toLowerCase();
        if (sourceParentPath === targetPath) {
          return false;
        }
      }
      return !targetPath.startsWith(`${sourcePath}\\`);
    });
  }, [treeClipboard]);

  const handlePasteTreeNode = useCallback(async (targetDir: string) => {
    if (!treeClipboard) {
      return;
    }

    if (!canPasteTreeNodeToDirectory(targetDir)) {
      return;
    }

    const { mode, nodes } = treeClipboard;
    const separator = targetDir.includes('/') ? '/' : '\\';

    try {
      const refreshPaths: string[] = [targetDir];
      for (const node of nodes) {
        const sourcePath = node.path;
        const sourceParentPath = getParentDir(sourcePath);
        const destination = `${targetDir.replace(/[\\/]$/, '')}${separator}${node.name}`;
        if (mode === 'copy') {
          await invoke('file_ops_tool', {
            action: 'copy',
            source: sourcePath,
            destination,
            conflict: 'rename',
            rootPath: projectPath || undefined,
          });
        } else {
          await invoke('move_file_or_folder', {
            oldPath: sourcePath,
            newPath: destination,
            overwrite: false,
            rootPath: projectPath || undefined,
          });
          remapOpenPaths(sourcePath, destination);
          remapPathSet(sourcePath, destination, setExpandedDirs);
          remapPathSet(sourcePath, destination, setLoadingDirs);
          setActiveTreeNode((prev) => remapTreeNode(prev, sourcePath, destination));
        }
        refreshPaths.push(sourcePath, sourceParentPath, destination);
      }
      if (mode === 'cut') {
        setSelectedTreeNodePaths(new Set());
        setTreeSelectionAnchorPath(null);
        setTreeClipboard(null);
      }
      await refreshFileTreeFromDisk(refreshPaths);
      await loadFolderChildren(targetDir, { silent: true });
    } catch (error) {
      showError(`粘贴失败: ${error}`);
    }
  }, [canPasteTreeNodeToDirectory, treeClipboard, projectPath, remapOpenPaths, remapPathSet, setExpandedDirs, setLoadingDirs, remapTreeNode, refreshFileTreeFromDisk, loadFolderChildren, showError]);

  const handlePasteIntoTreeNode = useCallback(async (node: FileNode) => {
    const targetDir = node.is_dir ? node.path : getParentDir(node.path);
    await handlePasteTreeNode(targetDir);
  }, [handlePasteTreeNode]);

  const handlePasteAtRoot = useCallback(async () => {
    if (!projectPath) {
      return;
    }
    await handlePasteTreeNode(projectPath);
  }, [handlePasteTreeNode, projectPath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCopyShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
      const isCutShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x';
      const isPasteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';

      if (event.key !== 'F2' && event.key !== 'Delete' && !isCopyShortcut && !isCutShortcut && !isPasteShortcut) {
        return;
      }
      if (activeSidebarView !== 'explorer' || isFileTreeCollapsed) {
        return;
      }
      if (renamingItem || creatingItem) {
        return;
      }

      const editors = editorInstanceByGroupRef.current;
      if (shouldSkipFileTreeKeyboardShortcut(event.target, editors)) {
        return;
      }

      if (isCopyShortcut) {
        if (shouldSkipFileTreeCopyShortcut(event.target, editors)) {
          return;
        }
        if (!activeTreeNode) {
          return;
        }
        event.preventDefault();
        handleCopyTreeNode(activeTreeNode);
        return;
      }

      if (isCutShortcut) {
        if (!activeTreeNode) {
          return;
        }
        event.preventDefault();
        handleCutTreeNode(activeTreeNode);
        return;
      }

      if (isPasteShortcut) {
        event.preventDefault();
        if (activeTreeNode) {
          void handlePasteIntoTreeNode(activeTreeNode);
          return;
        }
        if (projectPath) {
          void handlePasteAtRoot();
        }
        return;
      }

      if (!activeTreeNode) {
        return;
      }

      if (event.key === 'F2') {
        event.preventDefault();
        startFileTreeRename(activeTreeNode);
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        void handleFileTreeDelete(activeTreeNode);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [activeSidebarView, activeTreeNode, creatingItem, editorInstanceByGroupRef, handleCopyTreeNode, handleCutTreeNode, handleFileTreeDelete, handlePasteAtRoot, handlePasteIntoTreeNode, isFileTreeCollapsed, projectPath, renamingItem, startFileTreeRename]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openFile = params.get('openFile');
    const proj = params.get('projectPath');

    if (!openFile && !proj) return;

    (async () => {
      try {
        if (proj) {
          const name = proj.split(/[\\/]/).pop() || proj;
          setProjectName(name);
          setProjectPath(proj);
          const nodes = await invoke<FileNode[]>('open_folder', { folderPath: proj });
          setFileTree(nodes);
          setExpandedDirs(new Set());
          setLoadingDirs(new Set());
        }

        if (openFile) {
          await openFileInGroup(openFile, 'group-1');
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [
    openFileInGroup,
    setProjectName,
    setProjectPath,
    setFileTree,
    setExpandedDirs,
    setLoadingDirs,
  ]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { filePath, forceRefresh } = (e as CustomEvent).detail;
      if (filePath) {
        openFileInGroup(filePath, activeGroupId, forceRefresh).catch(console.error);
      }
    };
    window.addEventListener('open-file-in-editor', handler);
    return () => window.removeEventListener('open-file-in-editor', handler);
  }, [openFileInGroup, activeGroupId]);

  useKeyboardShortcuts({
    keyBindings,
    onSaveFile: handleSaveFile,
    onCreateFile: handleCreateFile,
    onToggleChat: () => layoutActions.setIsChatPanelOpen(true),
    onNewChat: () => layoutActions.setIsChatPanelOpen(true),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const closeEditorContextMenu = useCallback(() => {
    setEditorContextMenu(null);
  }, [setEditorContextMenu]);

  useEffect(() => {
    if (!editorContextMenu) return;
    void getLiveServerStatus();
  }, [editorContextMenu, getLiveServerStatus]);

  const { activeSplitRatio } = useEditorSplitResize({
    isSplit,
    isEditorSplitResizing,
    splitDirection,
    splitRatioRow,
    splitRatioColumn,
    editorSplitContainerRef,
    editorGroups,
    layoutEditors,
    setSplitRatioRow,
    setSplitRatioColumn,
    setIsEditorSplitResizing,
    setEditorGroups,
    setActiveGroupId,
    setHoveredTabId,
    editorInstanceByGroupRef,
  });

  const group1 = editorGroups.find((g) => g.id === 'group-1') || editorGroups[0];
  const group2 = editorGroups.find((g) => g.id === 'group-2') || null;

  const isDraggingTabFromGroup2 = !!activeTab && activeTab.groupId === 'group-2';
  const canConvertRowToColumn = isSplit && splitDirection === 'row' && isDraggingTabFromGroup2;
  const canConvertColumnToRow = isSplit && splitDirection === 'column' && isDraggingTabFromGroup2;

  const customCollisionDetection: CollisionDetection = (args) => {
    if (editorGroups.length < 2 && !!activeNode && !activeNode.is_dir) {
      const pointerCollisions = pointerWithin(args);
      const hitDown = pointerCollisions.find((c) => String(c.id) === SPLIT_ZONE_DOWN_ID);
      if (hitDown) return [hitDown];
      const hitRight = pointerCollisions.find((c) => String(c.id) === SPLIT_ZONE_RIGHT_ID);
      if (hitRight) return [hitRight];
      const hitLeft = pointerCollisions.find((c) => String(c.id) === OPEN_ZONE_LEFT_ID);
      if (hitLeft) return [hitLeft];
    }

    const currentActiveId = String(args.active?.id);
    const activeIdIsTab = currentActiveId.startsWith('tab-');
    if (activeIdIsTab) {
      const splitZoneActive = editorGroups.length < 2;
      const downZoneForTabs = splitZoneActive || canConvertRowToColumn;
      const rightZoneForTabs = splitZoneActive || canConvertColumnToRow;
      const droppableContainers = args.droppableContainers.filter((c) => {
        const id = String(c.id);
        const idIsTab = id.startsWith('tab-');
        const idIsTabBar = id.startsWith('tabbar-');
        if (idIsTab || idIsTabBar) return true;
        if (id === SPLIT_ZONE_DOWN_ID) return downZoneForTabs;
        if (id === SPLIT_ZONE_RIGHT_ID) return rightZoneForTabs;
        return false;
      });

      const pointerCollisions = pointerWithin({ ...args, droppableContainers });
      const down = pointerCollisions.find((c) => String(c.id) === SPLIT_ZONE_DOWN_ID);
      if (down) return [down];
      const right = pointerCollisions.find((c) => String(c.id) === SPLIT_ZONE_RIGHT_ID);
      if (right) return [right];
      if (pointerCollisions.length > 0) return pointerCollisions;

      return closestCenter({ ...args, droppableContainers });
    }

    const pointerCollisions = pointerWithin(args);
    const projectRootCollision = pointerCollisions.find(
      (collision) => collision.id === 'project-root'
    );

    if (projectRootCollision) {
      return [projectRootCollision];
    }

    return rectIntersection(args);
  };

  const handleOpenSearchMatch = useCallback(
    async (filePath: string, line: number, column: number, matchLen: number) => {
      await editorOps.openSearchMatch(filePath, line, column, matchLen, openFileInGroup);
    },
    [editorOps, openFileInGroup]
  );

  const {
    handleToggleExplorer,
    handleToggleSearch,
    handleToggleGit,
    handleToggleChat,
    handleToggleAgent,
    handleToggleTerminal,
    handleClickSettings,
    handleSidebarToggleCollapse,
    handleSetExplorerWorkingDir,
  } = useActivityBarCallbacks({
    isFileTreeCollapsed,
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
    showWarning,
    setExplorerWorkingDir,
  });

  const handleOpenGitDiffInEditor = useCallback(
    (payload: {
      name: string;
      originalContent: string;
      modifiedContent: string;
      language: string;
      leftLabel: string;
      rightLabel: string;
    }) => {
      const tabPath = `__diff__/${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const file: OpenFile = {
        kind: 'diff',
        path: tabPath,
        name: payload.name,
        originalContent: payload.originalContent,
        modifiedContent: payload.modifiedContent,
        language: payload.language,
        leftLabel: payload.leftLabel,
        rightLabel: payload.rightLabel,
        isDirty: false,
      };
      setOpenFilesByPath((prev) => ({ ...prev, [tabPath]: file }));
      setEditorGroups((prev) =>
        prev.map((g) =>
          g.id === activeGroupId
            ? {
                ...g,
                tabPaths: g.tabPaths.includes(tabPath) ? g.tabPaths : [...g.tabPaths, tabPath],
                activePath: tabPath,
              }
            : g
        )
      );
    },
    [activeGroupId, setEditorGroups, setOpenFilesByPath]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: '100vw',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-app)',
          color: 'var(--text-primary)',
        }}
      >
        <TitleBar
          onOpenFolder={handleOpenFolder}
          onOpenFile={handleOpenFile}
          projectName={projectName}
          onOpenAgent={handleToggleAgent}
          showIndexedProjects={enableCodeGraph}
          cbmReady={cbmSidecarAvailable}
          indexedProjects={indexedProjects}
          indexedProjectsLoading={indexedProjectsLoading}
          onIndexedProjectsOpen={() => {
            void loadAndReconcile();
          }}
          onOpenFolderAtPath={(path) => {
            void openFolderAtPath(path);
          }}
          onDeleteIndexedProject={(path) => {
            void deleteIndexedProject(path);
          }}
        />

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <ActivityBar
              isExplorerActive={activeSidebarView === 'explorer' && !isFileTreeCollapsed}
              isSearchActive={activeSidebarView === 'search' && !isFileTreeCollapsed}
              isGitActive={activeSidebarView === 'git' && !isFileTreeCollapsed}
              isChatActive={isChatPanelOpen}
              isTerminalActive={isTerminalOpen}
              onToggleExplorer={handleToggleExplorer}
              onToggleSearch={handleToggleSearch}
              onToggleGit={handleToggleGit}
              onToggleChat={handleToggleChat}
              onToggleTerminal={handleToggleTerminal}
              onClickSettings={handleClickSettings}
            />

            <SidebarArea
              sidebarWidth={sidebarWidth}
              isFileTreeCollapsed={isFileTreeCollapsed}
              activeSidebarView={activeSidebarView}
              isResizing={isResizing}
              projectName={projectName}
              projectPath={projectPath}
              sortedVisibleFileTree={sortedVisibleFileTree}
              fileTree={fileTree}
              expandedDirs={expandedDirs}
              loadingDirs={loadingDirs}
              focusedActiveFilePath={focusedActiveFilePath}
              selectedTreeNodePaths={selectedTreeNodePaths}
              treeClipboardMode={treeClipboardMode}
                treeClipboardPaths={treeClipboardPaths}
                autoRevealCurrentFile={autoRevealCurrentFile}
                compactFolders={compactFolders}
                creatingItem={creatingItem}
              renamingItem={renamingItem}
              onToggleCollapse={handleSidebarToggleCollapse}
              onCreateFolder={handleCreateFolder}
              onCreateFile={handleCreateFile}
              onOpenFolder={handleOpenFolder}
              onSelectFile={handleSelectFile}
              onActivateTreeNode={handleActivateTreeNode}
              onContextMenuNode={handleFileTreeContextMenu}
              onContextMenuBlank={handleFileTreeBlankContextMenu}
              onToggleDir={toggleDir}
              onConfirmCreate={handleConfirmCreate}
              onCancelCreate={handleCancelCreate}
              onConfirmRename={handleFileTreeRename}
              onCancelRename={cancelFileTreeRename}
              onSetExplorerWorkingDir={handleSetExplorerWorkingDir}
              onOpenSearchMatch={handleOpenSearchMatch}
              onOpenGitFile={(absolutePath) => {
                void handleSelectFile(absolutePath);
              }}
              onOpenGitFileAtLine={(absolutePath, line) => {
                void handleOpenSearchMatch(absolutePath, line, 1, 0);
              }}
              onGitWorkspaceChanged={() => {
                if (projectPath) handleFilesChanged([projectPath]);
              }}
              onOpenGitDiffInEditor={handleOpenGitDiffInEditor}
              onSidebarResizeStart={handleSidebarResizeStart}
              onCollapse={handleSidebarToggleCollapse}
              parentPath={projectPath}
              showIndexedProjects={enableCodeGraph}
              cbmReady={cbmSidecarAvailable}
              indexedProjects={indexedProjects}
              indexedProjectsLoading={indexedProjectsLoading}
              onOpenIndexedProject={(path) => {
                void openFolderAtPath(path);
              }}
              onDeleteIndexedProject={(path) => {
                void deleteIndexedProject(path);
              }}
            />

            <div
              ref={editorAreaRef}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              <EditorSplitView
                isSplit={isSplit}
                splitDirection={splitDirection}
                activeSplitRatio={activeSplitRatio}
                isEditorSplitResizing={isEditorSplitResizing}
                editorSplitContainerRef={editorSplitContainerRef}
                group1={group1}
                group2={group2}
                activeGroupId={activeGroupId}
                openFilesByPath={openFilesByPath}
                hoveredTabId={hoveredTabId}
                activeNode={activeNode}
                activeTab={activeTab}
                canConvertRowToColumn={canConvertRowToColumn}
                canConvertColumnToRow={canConvertColumnToRow}
                setIsEditorSplitResizing={setIsEditorSplitResizing}
                setHoveredTabId={setHoveredTabId}
                handleActivateTab={handleActivateTab}
                handleCloseTab={handleCloseTab}
                isAnyAgentBusy={isAnyAgentBusy}
                handleEditorChange={handleEditorChange}
                handleEditorMount={handleEditorMount}
                handleFocusGroup={handleFocusGroup}
                handleSplitRight={handleSplitRight}
                handleSplitDown={handleSplitDown}
                handleSingle={handleSingle}
                tabSize={tabSize}
                fontSize={fontSize}
                wordWrap={wordWrap}
                lineNumbers={lineNumbers}
                  minimap={minimap}
                  cursorStyle={cursorStyle}
                  cursorBlinking={cursorBlinking}
                  themeMode={themeMode}
                  renderWhitespace={renderWhitespace}
                  currentLineHighlight={currentLineHighlight}
                  bracketPairColorization={bracketPairColorization}
                  projectPath={projectPath || ''}
                handleFilesChanged={handleFilesChanged}
              />

              <PanelArea
                isTerminalOpen={isTerminalOpen}
                terminalHeight={terminalHeight}
                isTerminalResizing={isTerminalResizing}
                projectPath={projectPath}
                terminalWorkingDir={terminalWorkingDir}
                onTerminalResizeStart={handleTerminalResizeStart}
                onSetIsTerminalOpen={layoutActions.setIsTerminalOpen}
                onSetHasTerminals={layoutActions.setHasTerminals}
              />
            </div>

            <ChatPanelArea
              isOpen={isChatPanelOpen}
              width={chatPanelWidth}
              isResizing={isChatPanelResizing}
              projectPath={projectPath}
              onResizeStart={handleChatPanelResizeStart}
              onFilesChanged={handleFilesChanged}
            />
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        <DragOverlayContent
          activeNode={activeNode}
          activeTab={activeTab}
          openFilesByPath={openFilesByPath}
        />
      </DragOverlay>

      <SaveConfirmModal
        isOpen={modalOpen}
        fileName={
          tabToClose
            ? openFilesByPath[tabToClose.filePath]?.name || getBasename(tabToClose.filePath)
            : ''
        }
        onSave={handleConfirmSave}
        onDontSave={handleConfirmDontSave}
        onCancel={handleCancelClose}
      />

      {editorContextMenu && (
        <EditorContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          groupId={editorContextMenu.groupId}
          onClose={closeEditorContextMenu}
          onRunCommand={runEditorCommand}
          editorInstance={
            editorInstanceByGroupRef.current[editorContextMenu.groupId] as {
              getSelection?: () => { isEmpty?: () => boolean } | null;
              getAction?: (id: string) => { isSupported?: () => boolean } | null;
            } | null
          }
          activeFilePath={
            editorGroups.find((g) => g.id === editorContextMenu.groupId)?.activePath || null
          }
          projectPath={projectPath}
          liveServerStatus={liveServerStatus}
          onOpenWithLiveServer={async (filePath, projPath) => {
            if (projPath) await openWithLiveServer(filePath, projPath);
          }}
          onOpenInBrowser={async (filePath, projPath) => {
            if (projPath) await openInBrowserViaLiveServer(filePath, projPath);
          }}
          onStopLiveServer={stopLiveServer}
          onRefreshLiveServerStatus={getLiveServerStatus}
        />
      )}
      {fileTreeContextMenu && (
        <FileTreeContextMenu
          x={fileTreeContextMenu.x}
          y={fileTreeContextMenu.y}
          node={fileTreeContextMenu.node}
          onClose={closeFileTreeContextMenu}
          onCreateFile={(node) => handleFileTreeCreateAtNode(node, 'file')}
          onCreateFolder={(node) => handleFileTreeCreateAtNode(node, 'folder')}
          isNodeExpanded={
            !!fileTreeContextMenu.node?.is_dir &&
            expandedDirs.has(fileTreeContextMenu.node.path)
          }
          onToggleNodeExpanded={handleToggleTreeNodeExpanded}
          onCopyNode={handleCopyTreeNode}
          onCutNode={handleCutTreeNode}
          onPasteIntoNode={(node) => void handlePasteIntoTreeNode(node)}
          canPasteIntoNode={(node) =>
            canPasteTreeNodeToDirectory(node.is_dir ? node.path : getParentDir(node.path))
          }
          onRename={startFileTreeRename}
          onDelete={(node) => void handleFileTreeDelete(node)}
          onCopyPath={(node) => void handleFileTreeCopyPath(node)}
          onCopyRelativePath={(node) => void handleFileTreeCopyRelativePath(node)}
          onRevealInExplorer={(node) => void handleFileTreeRevealInExplorer(node)}
          onRefresh={(node) => void handleFileTreeRefresh(node)}
          onCreateFileAtRoot={() => handleFileTreeCreateAtRoot('file')}
          onCreateFolderAtRoot={() => handleFileTreeCreateAtRoot('folder')}
          onPasteAtRoot={() => void handlePasteAtRoot()}
          canPasteAtRoot={projectPath ? canPasteTreeNodeToDirectory(projectPath) : false}
          onCopyPathAtRoot={() => void handleRootCopyPath()}
          onCopyRelativePathAtRoot={() => void handleRootCopyRelativePath()}
          onRevealInExplorerAtRoot={() => void handleRootRevealInExplorer()}
          onExpandAll={() => void handleExpandAllTreeNodes()}
          onCollapseAll={handleCollapseAllTreeNodes}
          onRefreshRoot={() => void handleFileTreeRefreshRoot()}
        />
      )}


    </DndContext>
  );
}

export default function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const isDragPreviewWindow = urlParams.get('dragPreview') === '1';

  if (isDragPreviewWindow) {
    return <DragPreviewWindowWithShow />;
  }

  return <AppWithSettings />;
}

function AppWithSettings() {
  const language = useLanguage();
  const themeMode = useThemeMode();
  const currentLineHighlightColor = useCurrentLineHighlightColor();
  const loading = useSettingsLoading();
  const initializeSettings = useInitializeSettings();

  useEffect(() => {
    initializeSettings();
  }, [initializeSettings]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyDocumentTheme = () => {
      const resolvedTheme =
        themeMode === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : themeMode;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.style.colorScheme = resolvedTheme;
      applyCurrentLineHighlightColor(
        useSettingsStore.getState().currentLineHighlightColor,
        resolvedTheme
      );
      refreshMonacoTheme(themeMode);
    };

    applyDocumentTheme();

    if (themeMode !== 'system') {
      return;
    }

    const mediaQueryListener = () => applyDocumentTheme();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', mediaQueryListener);
    } else {
      mediaQuery.addListener(mediaQueryListener);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', mediaQueryListener);
      } else {
        mediaQuery.removeListener(mediaQueryListener);
      }
    };
  }, [themeMode]);

  useEffect(() => {
    applyCurrentLineHighlightColor(
      currentLineHighlightColor,
      resolveThemeFromMode(themeMode)
    );
  }, [themeMode, currentLineHighlightColor]);

  useEffect(() => {
    if (!loading) {
      requestAnimationFrame(() => {
        try {
          getCurrentWindow().show().catch(() => {
            // 非 Tauri 环境或窗口已销毁，忽略
          });
        } catch {
          // 非 Tauri 环境，忽略
        }
      });
    }
  }, [loading]);

  /** Provider 始终在 loading 内外包住子树，避免 loading 抖动或 HMR 时 AppContent 短暂脱离 NotificationProvider */
  return (
    <I18nProvider defaultLocale={language}>
      <NotificationProvider>
        {loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100vw',
              height: '100vh',
              backgroundColor: 'var(--bg-app)',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                border: '3px solid var(--border-primary)',
                borderTopColor: 'var(--border-focus)',
                borderRadius: '50%',
                animation: '_splash_spin 0.8s linear infinite',
              }}
            />
          </div>
        ) : (
          <AppContent />
        )}
      </NotificationProvider>
    </I18nProvider>
  );
}

/** DragPreviewWindow 包装：渲染完成后显示窗口 */
function DragPreviewWindowWithShow() {
  useEffect(() => {
    requestAnimationFrame(() => {
      try {
        getCurrentWindow().show().catch(() => {});
      } catch {}
    });
  }, []);
  return <DragPreviewWindow />;
}

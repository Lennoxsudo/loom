/**
 * Drag Drop Handlers Hook
 *
 * 处理拖拽相关逻辑
 */

import { useRef, useCallback, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition } from '@tauri-apps/api/window';
import type { DragStartEvent, DragEndEvent, DragCancelEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { FileNode } from '../components/FileTree';
import type { EditorGroupId, EditorGroupState, OpenFilesByPath } from '../types/app';
import { logDebug } from '../utils/errorHandling';
import {
  isTabId,
  isTabBarId,
  parseTabId,
  parseTabBarId,
  SPLIT_ZONE_RIGHT_ID,
  SPLIT_ZONE_DOWN_ID,
  OPEN_ZONE_LEFT_ID,
  CHAT_ATTACH_ZONE_ID,
  CHAT_ATTACH_FILE_EVENT,
} from '../types/app';
import { getBasename, normalizePathForCompare } from '../utils/pathUtils';
import { findNodeByPath } from '../utils/fileTreeUtils';
import { isTauriCancellationError } from '../utils/editorUtils';

type WebviewWindowOptions = {
  url?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  resizable?: boolean;
  skipTaskbar?: boolean;
  focus?: boolean;
  decorations?: boolean;
  transparent?: boolean;
  alwaysOnTop?: boolean;
  center?: boolean;
};

export interface DragDropHandlersOptions {
  fileTree: FileNode[];
  openFilesByPath: OpenFilesByPath;
  openFilesByPathRef: React.MutableRefObject<OpenFilesByPath>;
  editorGroups: EditorGroupState[];
  editorGroupsRef: React.MutableRefObject<EditorGroupState[]>;
  activeGroupId: EditorGroupId;
  splitDirection: 'row' | 'column';
  setEditorGroups: React.Dispatch<React.SetStateAction<EditorGroupState[]>>;
  setActiveGroupId: React.Dispatch<React.SetStateAction<EditorGroupId>>;
  setSplitDirection: React.Dispatch<React.SetStateAction<'row' | 'column'>>;
  setSplitRatioRow: React.Dispatch<React.SetStateAction<number>>;
  setSplitRatioColumn: React.Dispatch<React.SetStateAction<number>>;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
  openFileInGroup: (filePath: string, targetGroupId: EditorGroupId) => Promise<void>;
  handleMoveNode: (sourcePath: string, targetPath: string) => Promise<void>;
  projectPath: string;
}

export interface DragDropHandlersReturn {
  activeNode: FileNode | null;
  activeTab: { groupId: EditorGroupId; filePath: string } | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: (event: DragCancelEvent) => void;
  startDragOutTracking: () => void;
  stopDragOutTracking: () => void;
  openInNewWindow: (filePath: string) => void;
  activeNodeRef: React.MutableRefObject<FileNode | null>;
  activeTabRef: React.MutableRefObject<{ groupId: EditorGroupId; filePath: string } | null>;
  activeDragIdRef: React.MutableRefObject<string | null>;
  draggedOutOfWindowRef: React.MutableRefObject<boolean>;
  isSplit: boolean;
}

export function useDragDropHandlers(options: DragDropHandlersOptions): DragDropHandlersReturn {
  const {
    fileTree,
    openFilesByPath: _openFilesByPath,
    openFilesByPathRef: _openFilesByPathRef,
    editorGroups,
    editorGroupsRef: _editorGroupsRef,
    activeGroupId,
    splitDirection,
    setEditorGroups,
    setActiveGroupId,
    setSplitDirection,
    setSplitRatioRow,
    setSplitRatioColumn,
    setOpenFilesByPath: _setOpenFilesByPath,
    openFileInGroup,
    handleMoveNode,
    projectPath,
  } = options;

  const [activeNode, setActiveNode] = useState<FileNode | null>(null);
  const [activeTab, setActiveTab] = useState<{
    groupId: EditorGroupId;
    filePath: string;
  } | null>(null);

  const activeNodeRef = useRef<FileNode | null>(null);
  const activeTabRef = useRef<{ groupId: EditorGroupId; filePath: string } | null>(null);
  const activeDragIdRef = useRef<string | null>(null);
  const draggedOutOfWindowRef = useRef(false);
  const lastDragClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastDragScreenRef = useRef<{ x: number; y: number } | null>(null);
  const dragPreviewWindowRef = useRef<WebviewWindow | null>(null);
  const dragPreviewCleanupRef = useRef<(() => void) | null>(null);
  const dragOutCleanupRef = useRef<(() => void) | null>(null);

  const isSplit = editorGroups.length > 1;

  const ensureDragPreviewWindow = useCallback(() => {
    if (dragPreviewWindowRef.current) return;

    const label = `drag-preview-${Date.now()}`;
    const name = activeNodeRef.current?.name || getBasename(activeDragIdRef.current || '');
    const url = `/?dragPreview=1&name=${encodeURIComponent(name)}`;

    const win = new WebviewWindow(label, {
      url,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      width: 260,
      height: 44,
      focus: false,
    } as WebviewWindowOptions);

    dragPreviewWindowRef.current = win;
    dragPreviewCleanupRef.current = () => {
      void win.close().catch((error) => {
        if (!isTauriCancellationError(error)) {
          console.warn('[Window] close drag preview failed:', error);
        }
      });
    };
  }, []);

  const moveDragPreviewWindow = useCallback(() => {
    const win = dragPreviewWindowRef.current;
    const pos = lastDragScreenRef.current;
    if (!win || !pos) return;

    const x = Math.max(0, Math.round(pos.x + 12));
    const y = Math.max(0, Math.round(pos.y + 12));

    void win.setPosition(new LogicalPosition(x, y)).catch((error) => {
      if (!isTauriCancellationError(error)) {
        console.warn('[Window] move drag preview failed:', error);
      }
    });
  }, []);

  const disposeDragPreviewWindow = useCallback(() => {
    if (dragPreviewCleanupRef.current) {
      dragPreviewCleanupRef.current();
      dragPreviewCleanupRef.current = null;
    }
    dragPreviewWindowRef.current = null;
  }, []);

  const startDragOutTracking = useCallback(() => {
    draggedOutOfWindowRef.current = false;

    if (dragOutCleanupRef.current) {
      dragOutCleanupRef.current();
      dragOutCleanupRef.current = null;
    }

    const updateByCoords = (
      clientX: number,
      clientY: number,
      screenX?: number,
      screenY?: number
    ) => {
      lastDragClientRef.current = { x: clientX, y: clientY };
      if (typeof screenX === 'number' && typeof screenY === 'number') {
        lastDragScreenRef.current = { x: screenX, y: screenY };
      }

      draggedOutOfWindowRef.current =
        clientX < 0 || clientY < 0 || clientX > window.innerWidth || clientY > window.innerHeight;

      const isDraggingFileFromTree = !!activeNodeRef.current && !activeNodeRef.current.is_dir;
      if (draggedOutOfWindowRef.current && isDraggingFileFromTree) {
        ensureDragPreviewWindow();
        moveDragPreviewWindow();
      } else {
        disposeDragPreviewWindow();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      updateByCoords(e.clientX, e.clientY, e.screenX, e.screenY);
    };

    const onMouseMove = (e: MouseEvent) => {
      updateByCoords(e.clientX, e.clientY, e.screenX, e.screenY);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('mousemove', onMouseMove);

    dragOutCleanupRef.current = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [ensureDragPreviewWindow, moveDragPreviewWindow, disposeDragPreviewWindow]);

  const stopDragOutTracking = useCallback(() => {
    if (dragOutCleanupRef.current) {
      dragOutCleanupRef.current();
      dragOutCleanupRef.current = null;
    }
    draggedOutOfWindowRef.current = false;
    disposeDragPreviewWindow();
  }, [disposeDragPreviewWindow]);

  const openInNewWindow = useCallback((filePath: string) => {
    const params = new URLSearchParams();
    params.set('openFile', filePath);
    const url = `/?${params.toString()}`;

    const screen = lastDragScreenRef.current;
    const width = 1380;
    const height = 950;
    const x = screen ? Math.max(0, Math.round(screen.x - 200)) : undefined;
    const y = screen ? Math.max(0, Math.round(screen.y - 40)) : undefined;

    const label = `editor-${Date.now()}`;
    const win = new WebviewWindow(label, {
      url,
      title: 'Loom',
      width,
      height,
      decorations: false,
      center: true,
      ...(typeof x === 'number' && typeof y === 'number' ? { x, y, center: false } : {}),
    });

    void win
      .once('tauri://error', (e) => {
        console.error('Failed to create window', e);
      })
      .catch((error) => {
        if (!isTauriCancellationError(error)) {
          console.warn('[Window] register error listener failed:', error);
        }
      });
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      activeDragIdRef.current = id;

      if (isTabId(id)) {
        const { groupId, filePath } = parseTabId(id);
        setActiveTab({ groupId, filePath });
        activeTabRef.current = { groupId, filePath };
        activeNodeRef.current = null;
        setActiveNode(null);
        startDragOutTracking();
        return;
      }

      const path = id;
      const node = findNodeByPath(fileTree, path);
      setActiveNode(node);
      activeNodeRef.current = node;
      activeTabRef.current = null;
      setActiveTab(null);

      if (node && !node.is_dir) {
        startDragOutTracking();
      } else {
        stopDragOutTracking();
      }
    },
    [fileTree, startDragOutTracking, stopDragOutTracking]
  );

  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      const draggedOut = draggedOutOfWindowRef.current;
      const draggedId = activeDragIdRef.current;
      const draggedNode = activeNodeRef.current;

      if (draggedOut && draggedId && !isTabId(draggedId)) {
        const node = draggedNode || findNodeByPath(fileTree, draggedId);
        if (node && !node.is_dir) {
          openInNewWindow(draggedId);
        }
      }

      setActiveNode(null);
      setActiveTab(null);
      activeNodeRef.current = null;
      activeTabRef.current = null;
      activeDragIdRef.current = null;
      stopDragOutTracking();
    },
    [fileTree, openInNewWindow, stopDragOutTracking]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeId = String(active.id);
      const overId = over ? String(over.id) : null;

      const draggedNode = activeNodeRef.current;

      setActiveNode(null);
      setActiveTab(null);

      activeNodeRef.current = null;
      activeTabRef.current = null;
      activeDragIdRef.current = null;
      const draggedOut = draggedOutOfWindowRef.current;
      stopDragOutTracking();

      logDebug('DragEnd - active: ' + String(active.id) + ' over: ' + String(over?.id), 'DragDrop');

      if (draggedOut && !isTabId(activeId)) {
        const filePath = activeId;
        const node = draggedNode || findNodeByPath(fileTree, filePath);
        if (node && !node.is_dir) {
          openInNewWindow(filePath);
          return;
        }
      }

      if (!overId) return;

      if (isTabId(activeId)) {
        const { groupId: fromGroupId, filePath } = parseTabId(activeId);
        const draggedFile = _openFilesByPathRef.current[filePath];

        if (draggedFile?.kind === 'agent') {
          if (overId === SPLIT_ZONE_DOWN_ID || overId === SPLIT_ZONE_RIGHT_ID) {
            return;
          }
          if (isTabId(overId) || isTabBarId(overId)) {
            const overGroupId = isTabId(overId)
              ? parseTabId(overId).groupId
              : parseTabBarId(overId).groupId;

            if (fromGroupId !== overGroupId) {
              return;
            }
          }
        }

        if (overId === SPLIT_ZONE_DOWN_ID) {
          if (isSplit) {
            if (fromGroupId === 'group-2' && splitDirection === 'row') {
              setSplitDirection('column');
              setEditorGroups((prev) =>
                prev.map((g) => (g.id === 'group-2' ? { ...g, activePath: filePath } : g))
              );
            }
            return;
          }

          if (editorGroups.length < 2) {
            setSplitDirection('column');
            setSplitRatioColumn(0.5);

            setEditorGroups((prevGroups) => {
              const source = prevGroups.find((g) => g.id === fromGroupId) || prevGroups[0];
              const sourceIndex = source.tabPaths.indexOf(filePath);
              const canMoveOut = source.tabPaths.length > 1;

              const nextSourceTabs = canMoveOut
                ? source.tabPaths.filter((p) => p !== filePath)
                : source.tabPaths;

              let nextSourceActive = source.activePath;
              if (canMoveOut && source.activePath === filePath) {
                if (nextSourceTabs.length > 0) {
                  const nextIndex = Math.min(sourceIndex, nextSourceTabs.length - 1);
                  nextSourceActive = nextSourceTabs[nextIndex];
                } else {
                  nextSourceActive = null;
                }
              }

              const nextGroup1: EditorGroupState = {
                id: 'group-1',
                tabPaths:
                  source.id === 'group-1'
                    ? nextSourceTabs
                    : prevGroups.find((g) => g.id === 'group-1')?.tabPaths || [],
                activePath:
                  source.id === 'group-1'
                    ? nextSourceActive
                    : prevGroups.find((g) => g.id === 'group-1')?.activePath || null,
              };

              const nextGroup2: EditorGroupState = {
                id: 'group-2',
                tabPaths: [filePath],
                activePath: filePath,
              };

              return [nextGroup1, nextGroup2];
            });

            setActiveGroupId('group-2');
          }

          return;
        }

        if (overId === SPLIT_ZONE_RIGHT_ID) {
          if (isSplit) {
            if (fromGroupId === 'group-2' && splitDirection === 'column') {
              setSplitDirection('row');
              setEditorGroups((prev) =>
                prev.map((g) => (g.id === 'group-2' ? { ...g, activePath: filePath } : g))
              );
            }
            return;
          }

          if (editorGroups.length < 2) {
            setSplitDirection('row');
            setSplitRatioRow(0.5);

            setEditorGroups((prevGroups) => {
              const source = prevGroups.find((g) => g.id === fromGroupId) || prevGroups[0];
              const sourceIndex = source.tabPaths.indexOf(filePath);
              const canMoveOut = source.tabPaths.length > 1;

              const nextSourceTabs = canMoveOut
                ? source.tabPaths.filter((p) => p !== filePath)
                : source.tabPaths;

              let nextSourceActive = source.activePath;
              if (canMoveOut && source.activePath === filePath) {
                if (nextSourceTabs.length > 0) {
                  const nextIndex = Math.min(sourceIndex, nextSourceTabs.length - 1);
                  nextSourceActive = nextSourceTabs[nextIndex];
                } else {
                  nextSourceActive = null;
                }
              }

              const nextGroup1: EditorGroupState = {
                id: 'group-1',
                tabPaths:
                  source.id === 'group-1'
                    ? nextSourceTabs
                    : prevGroups.find((g) => g.id === 'group-1')?.tabPaths || [],
                activePath:
                  source.id === 'group-1'
                    ? nextSourceActive
                    : prevGroups.find((g) => g.id === 'group-1')?.activePath || null,
              };

              const nextGroup2: EditorGroupState = {
                id: 'group-2',
                tabPaths: [filePath],
                activePath: filePath,
              };

              if (source.id !== 'group-1') {
                nextGroup1.tabPaths = prevGroups.find((g) => g.id === 'group-1')?.tabPaths || [];
                nextGroup1.activePath =
                  prevGroups.find((g) => g.id === 'group-1')?.activePath || null;
              }

              return [nextGroup1, nextGroup2];
            });

            setActiveGroupId('group-2');
          }

          return;
        }

        if (!isTabId(overId) && !isTabBarId(overId)) return;

        const overGroupId = isTabId(overId)
          ? parseTabId(overId).groupId
          : parseTabBarId(overId).groupId;
        const overFilePath = isTabId(overId) ? parseTabId(overId).filePath : null;

        setEditorGroups((prevGroups) => {
          const fromGroup = prevGroups.find((g) => g.id === fromGroupId);
          const toGroup = prevGroups.find((g) => g.id === overGroupId);
          if (!fromGroup || !toGroup) return prevGroups;

          const fromIndex = fromGroup.tabPaths.indexOf(filePath);
          if (fromIndex === -1) return prevGroups;

          if (fromGroupId === overGroupId) {
            if (!overFilePath) return prevGroups;
            const toIndex = toGroup.tabPaths.indexOf(overFilePath);
            if (toIndex === -1 || toIndex === fromIndex) return prevGroups;

            return prevGroups.map((g) =>
              g.id === fromGroupId
                ? { ...g, tabPaths: arrayMove(g.tabPaths, fromIndex, toIndex) }
                : g
            );
          }

          const toAlreadyHas = toGroup.tabPaths.includes(filePath);

          const nextGroups = prevGroups.map((g) => {
            if (g.id === fromGroupId) {
              const newTabs = g.tabPaths.filter((p) => p !== filePath);

              let newActive = g.activePath;
              if (g.activePath === filePath) {
                if (newTabs.length > 0) {
                  const nextIndex = Math.min(fromIndex, newTabs.length - 1);
                  newActive = newTabs[nextIndex];
                } else {
                  newActive = null;
                }
              }

              return { ...g, tabPaths: newTabs, activePath: newActive };
            }

            if (g.id === overGroupId) {
              if (toAlreadyHas) {
                return { ...g, activePath: filePath };
              }

              const insertIndex = overFilePath
                ? Math.max(0, g.tabPaths.indexOf(overFilePath))
                : g.tabPaths.length;
              const nextTabs = [...g.tabPaths];
              const safeIndex = insertIndex === -1 ? nextTabs.length : insertIndex;
              nextTabs.splice(safeIndex, 0, filePath);
              return { ...g, tabPaths: nextTabs, activePath: filePath };
            }

            return g;
          });

          return nextGroups;
        });

        setActiveGroupId(overGroupId);
        return;
      }

      if (isTabId(overId) || isTabBarId(overId)) return;

      if (overId === CHAT_ATTACH_ZONE_ID) {
        const sourcePath = activeId;
        const node = draggedNode || findNodeByPath(fileTree, sourcePath);
        if (!node || node.is_dir) return;

        window.dispatchEvent(
          new CustomEvent(CHAT_ATTACH_FILE_EVENT, {
            detail: {
              path: sourcePath,
              name: node.name || getBasename(sourcePath),
            },
          })
        );
        return;
      }

      if (overId === SPLIT_ZONE_DOWN_ID) {
        const sourcePath = activeId;
        const node = findNodeByPath(fileTree, sourcePath);
        if (!node || node.is_dir) return;

        if (editorGroups.length < 2) {
          setSplitDirection('column');
          setSplitRatioColumn(0.5);
          setEditorGroups((prev) => {
            if (prev.length > 1) return prev;
            const g1 = prev[0];
            const g2: EditorGroupState = {
              id: 'group-2',
              tabPaths: [sourcePath],
              activePath: sourcePath,
            };
            return [g1, g2];
          });
        }

        setActiveGroupId('group-2');
        void openFileInGroup(sourcePath, 'group-2');
        return;
      }

      if (overId === SPLIT_ZONE_RIGHT_ID) {
        const sourcePath = activeId;
        const node = findNodeByPath(fileTree, sourcePath);
        if (!node || node.is_dir) return;

        if (editorGroups.length < 2) {
          setSplitDirection('row');
          setSplitRatioRow(0.5);
          setEditorGroups((prev) => {
            if (prev.length > 1) return prev;
            const g1 = prev[0];
            const g2: EditorGroupState = {
              id: 'group-2',
              tabPaths: [sourcePath],
              activePath: sourcePath,
            };
            return [g1, g2];
          });
        }

        setActiveGroupId('group-2');
        void openFileInGroup(sourcePath, 'group-2');
        return;
      }

      if (overId === OPEN_ZONE_LEFT_ID) {
        const sourcePath = activeId;
        const node = findNodeByPath(fileTree, sourcePath);
        if (!node || node.is_dir) return;

        void openFileInGroup(sourcePath, activeGroupId);
        return;
      }

      const sourcePath = activeId;
      let targetPath = overId;
      const sourceNode = findNodeByPath(fileTree, sourcePath);

      if (targetPath.endsWith('-inner')) {
        targetPath = targetPath.replace('-inner', '');
      }

      if (targetPath === 'project-root') {
        if (!projectPath) {
          logDebug('No project opened, ignoring drop', 'DragDrop');
          return;
        }
        targetPath = projectPath;
        logDebug('Moving to project root: ' + projectPath, 'DragDrop');
      }

      const targetNode = findNodeByPath(fileTree, targetPath);
      const sourceName =
        sourceNode?.name || sourcePath.split(/[\\/]/).filter(Boolean).pop() || sourcePath;
      const normalizedProjectPath = projectPath ? normalizePathForCompare(projectPath) : null;
      const normalizedTargetPath = normalizePathForCompare(targetPath);

      if (normalizedProjectPath && normalizedTargetPath === normalizedProjectPath) {
        targetPath = `${targetPath.replace(/[\\/]$/, '')}\\${sourceName}`;
      } else if (targetNode?.is_dir) {
        targetPath = `${targetPath.replace(/[\\/]$/, '')}\\${sourceName}`;
      } else if (targetNode) {
        const parentDir = targetPath.replace(/[\\/][^\\/]+$/, '');
        if (parentDir) {
          targetPath = `${parentDir.replace(/[\\/]$/, '')}\\${sourceName}`;
        }
      }

      if (normalizePathForCompare(sourcePath) === normalizePathForCompare(targetPath)) {
        logDebug('Drop target is same as source, ignoring', 'DragDrop');
        return;
      }

      logDebug('Calling handleMoveNode: ' + sourcePath + ' -> ' + targetPath, 'DragDrop');
      handleMoveNode(sourcePath, targetPath);
    },
    [
      fileTree,
      editorGroups,
      isSplit,
      splitDirection,
      activeGroupId,
      openFileInGroup,
      handleMoveNode,
      projectPath,
      setEditorGroups,
      setActiveGroupId,
      setSplitDirection,
      setSplitRatioRow,
      setSplitRatioColumn,
      openInNewWindow,
      stopDragOutTracking,
    ]
  );

  return {
    activeNode,
    activeTab,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    startDragOutTracking,
    stopDragOutTracking,
    openInNewWindow,
    activeNodeRef,
    activeTabRef,
    activeDragIdRef,
    draggedOutOfWindowRef,
    isSplit,
  };
}

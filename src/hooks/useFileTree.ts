/**
 * 文件树状态管理 Hook
 */

import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { FileNode } from '../components/FileTree';
import { normalizePathForCompare, isPathUnderRoot } from '../utils/pathUtils';
import { findNodeByPath } from '../utils/fileTreeUtils';
import { isTauriCancellationError } from '../utils/editorUtils';
import { notifyError } from '../utils/notification';
import { useFileStore } from '../stores';

export interface UseFileTreeReturn {
  fileTree: FileNode[];
  projectName: string;
  projectPath: string;
  expandedDirs: Set<string>;
  loadingDirs: Set<string>;
  isFileTreeCollapsed: boolean;
  explorerWorkingDir: string | null;
  setFileTree: (tree: FileNode[] | ((prev: FileNode[]) => FileNode[])) => void;
  setProjectName: (name: string) => void;
  setProjectPath: (path: string) => void;
  setExpandedDirs: (dirs: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setLoadingDirs: (dirs: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setIsFileTreeCollapsed: (collapsed: boolean) => void;
  setExplorerWorkingDir: (dir: string | null) => void;
  loadFolderChildren: (folderPath: string, options?: { silent?: boolean }) => Promise<void>;
  toggleDir: (dirPath: string) => void;
  refreshFileTreeFromDisk: (paths: string[]) => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  handleMoveNode: (sourcePath: string, targetPath: string) => Promise<void>;
}

const EXPANDED_DIRS_STORAGE_KEY = 'loom:fileTreeExpandedDirs:v1';

function normalizeDirPath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/g, '');
}

function readExpandedDirMemory(): Record<string, string[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(EXPANDED_DIRS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeExpandedDirMemory(memory: Record<string, string[]>) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(EXPANDED_DIRS_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* ignore persistence failures */
  }
}

function getSavedExpandedDirs(projectPath: string): string[] {
  const normalizedProjectPath = normalizeDirPath(projectPath).toLowerCase();
  const memory = readExpandedDirMemory();
  const saved = memory[normalizedProjectPath];
  if (!Array.isArray(saved)) {
    return [];
  }

  return saved
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
    .map(normalizeDirPath)
    .filter((path) => isPathUnderRoot(path, projectPath));
}

function saveExpandedDirs(projectPath: string, expandedDirs: Set<string>) {
  const normalizedProjectPath = normalizeDirPath(projectPath).toLowerCase();
  const memory = readExpandedDirMemory();
  memory[normalizedProjectPath] = Array.from(expandedDirs)
    .map(normalizeDirPath)
    .filter((path) => isPathUnderRoot(path, projectPath))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  writeExpandedDirMemory(memory);
}

function collectPendingExpandedLoads(nodes: FileNode[], expandedDirs: Set<string>): string[] {
  const pending: string[] = [];

  const walk = (list: FileNode[]) => {
    for (const node of list) {
      if (!node.is_dir || !expandedDirs.has(node.path)) {
        continue;
      }

      if (!node.children_loaded) {
        pending.push(node.path);
        continue;
      }

      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return pending;
}

export function useFileTree(): UseFileTreeReturn {
  const fileTree = useFileStore((state) => state.fileTree);
  const projectName = useFileStore((state) => state.projectName);
  const projectPath = useFileStore((state) => state.projectPath);
  const expandedDirs = useFileStore((state) => state.expandedDirs);
  const loadingDirs = useFileStore((state) => state.loadingDirs);
  const isFileTreeCollapsed = useFileStore((state) => state.isFileTreeCollapsed);
  const explorerWorkingDir = useFileStore((state) => state.explorerWorkingDir);

  const setFileTree = useFileStore((state) => state.setFileTree);
  const setProjectName = useFileStore((state) => state.setProjectName);
  const setProjectPath = useFileStore((state) => state.setProjectPath);
  const setExpandedDirs = useFileStore((state) => state.setExpandedDirs);
  const setLoadingDirs = useFileStore((state) => state.setLoadingDirs);
  const setIsFileTreeCollapsed = useFileStore((state) => state.setIsFileTreeCollapsed);
  const setExplorerWorkingDir = useFileStore((state) => state.setExplorerWorkingDir);

  // 使用 ref 保存最新状态，避免闭包问题
  const stateRef = useRef({ fileTree, projectPath, expandedDirs, loadingDirs });
  stateRef.current = { fileTree, projectPath, expandedDirs, loadingDirs };
  const inFlightLoadsRef = useRef(new Set<string>());
  const hydratedExpandedDirsProjectRef = useRef<string | null>(null);

  /**
   * 合并子节点，保留已加载状态
   */
  const mergeChildrenPreservingLoaded = useCallback(
    (oldChildren: FileNode[] | undefined, newChildren: FileNode[]) => {
      if (!oldChildren || oldChildren.length === 0) return newChildren;
      const oldByPath = new Map(oldChildren.map((n) => [n.path, n] as const));

      return newChildren.map((n) => {
        const old = oldByPath.get(n.path);
        if (n.is_dir && old?.is_dir && old.children_loaded) {
          return { ...n, children_loaded: true, children: old.children };
        }
        return n;
      });
    },
    []
  );

  /**
   * 更新文件夹子节点
   */
  const updateFolderChildren = useCallback(
    (folderPath: string, children: FileNode[]) => {
      const normalize = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/g, '');
      const target = normalize(folderPath);
      const root = normalize(stateRef.current.projectPath);

      const childrenEqual = (a?: FileNode[], b?: FileNode[]) => {
        if (!a || !b) return a === b;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          const x = a[i];
          const y = b[i];
          if (x.path !== y.path || x.name !== y.name || x.is_dir !== y.is_dir) return false;
          if (x.children_loaded !== y.children_loaded) return false;
        }
        return true;
      };

      if (target && root && target === root) {
        setFileTree((prev) => {
          const merged = mergeChildrenPreservingLoaded(prev, children);
          if (childrenEqual(prev, merged)) return prev;
          return merged;
        });
        return;
      }

      const update = (nodes: FileNode[]): [FileNode[], boolean] => {
        let changed = false;
        const nextNodes = nodes.map((node) => {
          if (normalize(node.path) === target) {
            const merged = mergeChildrenPreservingLoaded(node.children, children);
            if (childrenEqual(node.children, merged) && node.children_loaded) {
              return node;
            }
            changed = true;
            return { ...node, children_loaded: true, children: merged };
          }

          if (node.is_dir && node.children && node.children.length > 0) {
            const [next, childChanged] = update(node.children);
            if (childChanged) {
              changed = true;
              return { ...node, children: next };
            }
          }

          return node;
        });
        return [nextNodes, changed];
      };

      setFileTree((prev) => {
        const [next, changed] = update(prev);
        return changed ? next : prev;
      });
    },
    [mergeChildrenPreservingLoaded, setFileTree]
  );

  /**
   * 加载文件夹子节点
   */
  const loadFolderChildren = useCallback(
    async (folderPath: string, options?: { silent?: boolean }) => {
      if (!folderPath) return;
      const normalizedFolderPath = normalizeDirPath(folderPath);
      if (inFlightLoadsRef.current.has(normalizedFolderPath)) return;

      const silent = options?.silent ?? false;
      inFlightLoadsRef.current.add(normalizedFolderPath);

      if (!silent) {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.add(normalizedFolderPath);
          return next;
        });
      }

      try {
        const children = await invoke<FileNode[]>('read_folder_children', { folderPath: normalizedFolderPath });
        updateFolderChildren(normalizedFolderPath, children);
      } finally {
        inFlightLoadsRef.current.delete(normalizedFolderPath);
        if (!silent) {
          setLoadingDirs((prev) => {
            const next = new Set(prev);
            next.delete(normalizedFolderPath);
            return next;
          });
        }
      }
    },
    [updateFolderChildren, setLoadingDirs]
  );

  useEffect(() => {
    if (!projectPath) {
      hydratedExpandedDirsProjectRef.current = null;
      return;
    }

    if (hydratedExpandedDirsProjectRef.current === projectPath) {
      return;
    }

    const savedExpandedDirs = new Set(getSavedExpandedDirs(projectPath));
    hydratedExpandedDirsProjectRef.current = projectPath;
    setExpandedDirs(savedExpandedDirs);
  }, [projectPath, setExpandedDirs]);

  useEffect(() => {
    if (!projectPath || hydratedExpandedDirsProjectRef.current !== projectPath) {
      return;
    }

    saveExpandedDirs(projectPath, expandedDirs);
  }, [expandedDirs, projectPath]);

  useEffect(() => {
    if (!projectPath || hydratedExpandedDirsProjectRef.current !== projectPath || fileTree.length === 0) {
      return;
    }

    const pendingLoads = collectPendingExpandedLoads(fileTree, expandedDirs);
    if (pendingLoads.length === 0) {
      return;
    }

    let cancelled = false;

    const restoreExpandedLoads = async () => {
      for (const dirPath of pendingLoads) {
        if (cancelled) {
          return;
        }
        await loadFolderChildren(dirPath, { silent: true });
      }
    };

    void restoreExpandedLoads();

    return () => {
      cancelled = true;
    };
  }, [expandedDirs, fileTree, loadFolderChildren, projectPath]);

  /**
   * 从磁盘刷新文件树
   */
  const refreshFileTreeFromDisk = useCallback(
    async (paths: string[]) => {
      if (!stateRef.current.projectPath) return;

      const unique = Array.from(new Set(paths)).filter(Boolean);
      if (unique.length === 0) return;

      const normalizedExpanded = new Set(
        Array.from(stateRef.current.expandedDirs).map((p) =>
          normalizePathForCompare(p).toLowerCase()
        )
      );

      const dirsToRefresh = new Set<string>();
      const projectNorm = normalizePathForCompare(stateRef.current.projectPath);

      for (const p of unique) {
        if (!p) continue;
        if (!isPathUnderRoot(p, stateRef.current.projectPath)) continue;

        const norm = normalizePathForCompare(p);
        const parts = norm.split('\\');
        parts.pop();
        const parent = parts.join('\\') || projectNorm;
        const parentNorm = normalizePathForCompare(parent);

        if (parentNorm.toLowerCase() === projectNorm.toLowerCase()) {
          dirsToRefresh.add(projectNorm);
          continue;
        }

        if (normalizedExpanded.has(parentNorm.toLowerCase())) {
          dirsToRefresh.add(parentNorm);
        }
      }

      if (dirsToRefresh.size === 0) return;

      for (const dir of dirsToRefresh) {
        await loadFolderChildren(dir, { silent: true });
      }
    },
    [loadFolderChildren]
  );

  /**
   * 切换目录展开/折叠
   */
  const toggleDir = useCallback(
    (dirPath: string) => {
      if (!dirPath) return;

      const isOpen = stateRef.current.expandedDirs.has(dirPath);
      if (isOpen) {
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
        return;
      }

      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });

      const node = findNodeByPath(stateRef.current.fileTree, dirPath);
      if (node?.is_dir && !node.children_loaded) {
        void loadFolderChildren(dirPath);
      }
    },
    [loadFolderChildren, setExpandedDirs]
  );

  /**
   * 打开文件夹
   */
  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected === null) return;
      const dirPath = Array.isArray(selected) ? selected[0] : selected;

      const name = dirPath.split(/[\\/]/).pop() || dirPath;
      setProjectName(name);
      setProjectPath(dirPath);

      const nodes = await invoke<FileNode[]>('open_folder', { folderPath: dirPath });
      setFileTree(nodes);
      setLoadingDirs(new Set());
    } catch (error) {
      if (isTauriCancellationError(error)) return;
      console.error(error);
    }
  }, [setProjectName, setProjectPath, setFileTree, setExpandedDirs, setLoadingDirs]);

  /**
   * 移动文件/文件夹
   */
  const handleMoveNode = useCallback(async (sourcePath: string, targetPath: string) => {
    try {
      await invoke('move_file_or_folder', {
        oldPath: sourcePath,
        newPath: targetPath,
        overwrite: false,
        rootPath: stateRef.current.projectPath || undefined,
      });
    } catch (error) {
      console.error('Failed to move:', error);
      notifyError('移动失败', error as Error);
    }
  }, []);

  return {
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
    handleOpenFolder,
    handleMoveNode,
  };
}

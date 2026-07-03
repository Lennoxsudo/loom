/**
 * useFileRefresh Hook
 *
 * 处理打开文件的磁盘刷新逻辑
 */

import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { mergeRefreshedContents } from '../utils/openFilesRefresh';
import { normalizePathForCompare, normalizeEolForCompare } from '../utils/pathUtils';
import type { EditorGroupId, OpenFilesByPath, EditorGroupState } from '../types/app';
import type { MonacoEditor } from '../types/monaco';

export interface UseFileRefreshOptions {
  openFilesByPathRef: React.MutableRefObject<OpenFilesByPath>;
  editorInstanceByGroupRef: React.MutableRefObject<
    Partial<Record<EditorGroupId, MonacoEditor | null>>
  >;
  editorMountedFilePathByGroupRef: React.MutableRefObject<
    Partial<Record<EditorGroupId, string | null>>
  >;
  programmaticRefreshPathsRef: React.MutableRefObject<Set<string>>;
  setEditorGroups: React.Dispatch<React.SetStateAction<EditorGroupState[]>>;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
}

export interface UseFileRefreshReturn {
  refreshOpenFilesFromDisk: (paths: string[]) => Promise<void>;
}

export function useFileRefresh({
  openFilesByPathRef,
  editorInstanceByGroupRef,
  editorMountedFilePathByGroupRef,
  programmaticRefreshPathsRef,
  setEditorGroups,
  setOpenFilesByPath,
}: UseFileRefreshOptions): UseFileRefreshReturn {
  const refreshOpenFilesFromDisk = useCallback(
    async (paths: string[]) => {
      const unique = Array.from(new Set(paths)).filter(Boolean);
      const candidatePaths =
        unique.length > 0
          ? unique
          : Object.keys(openFilesByPathRef.current).filter((path) => {
              const file = openFilesByPathRef.current[path];
              return file && file.kind === 'text';
            });

      if (candidatePaths.length === 0) return;

      const pathByNormalized = new Map<string, string>();
      for (const path of Object.keys(openFilesByPathRef.current)) {
        pathByNormalized.set(normalizePathForCompare(path).toLowerCase(), path);
      }

      const normalizedToActual = candidatePaths
        .map((path) => pathByNormalized.get(normalizePathForCompare(path).toLowerCase()))
        .filter((path): path is string => typeof path === 'string');

      const pathsToRead = normalizedToActual.filter((path) => {
        const file = openFilesByPathRef.current[path];
        return file && file.kind === 'text';
      });

      // 当外部修改文件时（如 AI 工具），强制更新所有打开的文件
      // 不再过滤 isDirty，因为外部修改应该覆盖本地状态
      const canOverwriteNormalized = new Set(
        pathsToRead.map((path) => normalizePathForCompare(path).toLowerCase())
      );

      if (pathsToRead.length === 0) return;

      const results = await Promise.all(
        pathsToRead.map(async (path) => {
          try {
            const content = await invoke<string>('read_file_content', { filePath: path });
            return { path, content };
          } catch (error) {
            console.error('Failed to refresh file', path, error);
            return { path, content: null as string | null, error };
          }
        })
      );

      const refreshed: Record<string, string> = {};
      const missingPaths: string[] = [];
      for (const item of results) {
        if (!item) continue;
        if ('content' in item && typeof item.content === 'string') {
          refreshed[item.path] = item.content;
          continue;
        }
        const message = String((item as { error?: unknown }).error ?? '');
        // 检测文件不存在的错误消息（支持中英文和系统错误码）
        const lowerMessage = message.toLowerCase();
        if (
          message.includes('找不到') ||
          message.includes('不存在') ||
          lowerMessage.includes('not found') ||
          lowerMessage.includes('no such file') ||
          lowerMessage.includes('does not exist') ||
          lowerMessage.includes('(os error 2)') // Linux/Windows 文件不存在错误码
        ) {
          missingPaths.push(item.path);
        }
      }

      if (Object.keys(refreshed).length === 0 && missingPaths.length === 0) return;

      if (missingPaths.length > 0) {
        // 对于未修改的文件，直接关闭；对于已修改的文件，标记为已删除
        const safeRemoveSet = new Set(
          missingPaths
            .filter((p) => {
              const existing = openFilesByPathRef.current[p];
              return existing && existing.kind === 'text' && !existing.isDirty;
            })
            .map((p) => normalizePathForCompare(p).toLowerCase())
        );

        // 标记已修改但被删除的文件
        const deletedButDirtySet = new Set(
          missingPaths
            .filter((p) => {
              const existing = openFilesByPathRef.current[p];
              return existing && existing.kind === 'text' && existing.isDirty;
            })
            .map((p) => normalizePathForCompare(p).toLowerCase())
        );

        if (safeRemoveSet.size > 0) {
          setEditorGroups((prevGroups) => {
            return prevGroups.map((g) => {
              const nextTabs = g.tabPaths.filter(
                (p) => !safeRemoveSet.has(normalizePathForCompare(p).toLowerCase())
              );
              let nextActive = g.activePath;
              if (
                nextActive &&
                safeRemoveSet.has(normalizePathForCompare(nextActive).toLowerCase())
              ) {
                nextActive =
                  nextTabs.length > 0 ? nextTabs[Math.min(nextTabs.length - 1, 0)] : null;
              }
              if (nextTabs.length === g.tabPaths.length && nextActive === g.activePath) return g;
              return { ...g, tabPaths: nextTabs, activePath: nextActive };
            });
          });

          setOpenFilesByPath((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [path, file] of Object.entries(prev)) {
              if (safeRemoveSet.has(normalizePathForCompare(path).toLowerCase())) {
                if (file && file.kind === 'text' && !file.isDirty) {
                  delete next[path];
                  changed = true;
                }
              }
            }
            return changed ? next : prev;
          });
        }

        // 标记已修改但被删除的文件
        if (deletedButDirtySet.size > 0) {
          setOpenFilesByPath((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [path, file] of Object.entries(prev)) {
              if (deletedButDirtySet.has(normalizePathForCompare(path).toLowerCase())) {
                if (file && (file.kind === 'text' || file.kind === 'image')) {
                  next[path] = { ...file, isDeleted: true };
                  changed = true;
                }
              }
            }
            return changed ? next : prev;
          });
        }
      }

      const viewStatesToRestore: Array<{
        groupId: EditorGroupId;
        filePath: string;
        viewState: unknown;
      }> = [];
      try {
        const refreshedByNormalized = new Map<string, string>();
        for (const [p, content] of Object.entries(refreshed)) {
          refreshedByNormalized.set(normalizePathForCompare(p).toLowerCase(), content);
        }

        for (const [groupIdRaw, editor] of Object.entries(editorInstanceByGroupRef.current)) {
          const groupId = groupIdRaw as EditorGroupId;
          const mountedPath = editorMountedFilePathByGroupRef.current[groupId];
          if (!mountedPath) continue;

          const mountedNorm = normalizePathForCompare(mountedPath).toLowerCase();
          if (!refreshedByNormalized.has(mountedNorm)) continue;

          if (editor) {
            const viewState = (editor as MonacoEditor).saveViewState?.();
            if (viewState) {
              viewStatesToRestore.push({ groupId, filePath: mountedPath, viewState });
            }
          }
        }
      } catch {
        /* ignore view state save errors */
      }

      setOpenFilesByPath((prev) => {
        let changed = false;

        let next = mergeRefreshedContents(prev, refreshed);
        if (next !== prev) {
          changed = true;
        }

        for (const [path, diskContent] of Object.entries(refreshed)) {
          const existing = next[path];
          if (!existing || existing.kind !== 'text') continue;
          if (!existing.isDirty) continue;

          if (normalizeEolForCompare(existing.content) === normalizeEolForCompare(diskContent)) {
            next = {
              ...next,
              [path]: { ...existing, isDirty: false },
            };
            changed = true;
          }
        }

        return changed ? next : prev;
      });

      // 始终更新所有已挂载编辑器的 Monaco 模型（不依赖 viewStatesToRestore）
      requestAnimationFrame(() => {
        const refreshedByNorm = new Map<string, string>();
        for (const [p, content] of Object.entries(refreshed)) {
          refreshedByNorm.set(normalizePathForCompare(p).toLowerCase(), content);
        }

        for (const [groupIdRaw, editor] of Object.entries(editorInstanceByGroupRef.current)) {
          const groupId = groupIdRaw as EditorGroupId;
          const mountedPath = editorMountedFilePathByGroupRef.current[groupId];
          if (!editor || !mountedPath) continue;

          const norm = normalizePathForCompare(mountedPath).toLowerCase();
          const diskContent = refreshedByNorm.get(norm);
          if (typeof diskContent !== 'string') continue;

          // 更新 Monaco 模型内容
          if (canOverwriteNormalized.has(norm)) {
            try {
              const model = (editor as MonacoEditor).getModel?.();
              if (model) {
                const current = model.getValue();
                if (normalizeEolForCompare(current) !== normalizeEolForCompare(diskContent)) {
                  programmaticRefreshPathsRef.current.add(norm);
                  model.setValue(diskContent);
                  window.setTimeout(() => {
                    programmaticRefreshPathsRef.current.delete(norm);
                  }, 0);
                }
              }
            } catch {
              /* ignore model update errors */
            }
          }

          // 恢复视图状态
          const savedViewState = viewStatesToRestore.find(
            (v) =>
              v.groupId === groupId && normalizePathForCompare(v.filePath).toLowerCase() === norm
          );
          if (savedViewState) {
            try {
              (editor as MonacoEditor).restoreViewState?.(
                savedViewState.viewState as Parameters<
                  NonNullable<MonacoEditor['restoreViewState']>
                >[0]
              );
            } catch {
              /* ignore view state restore errors */
            }
          }
        }
      });
    },
    [setEditorGroups, setOpenFilesByPath, editorInstanceByGroupRef, editorMountedFilePathByGroupRef]
  );

  return {
    refreshOpenFilesFromDisk,
  };
}

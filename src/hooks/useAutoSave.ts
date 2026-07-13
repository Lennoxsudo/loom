/**
 * useAutoSave Hook
 *
 * 处理编辑器自动保存逻辑
 */

import { useCallback } from 'react';
import { logDebug } from '../utils/errorHandling';
import { normalizeEolForCompare, normalizePathForCompare } from '../utils/pathUtils';
import {
  isPlanEditorPath,
  onPlanEditorContentChange,
  savePlanEditorContent,
} from '../utils/planEditorBridge';
import type { EditorGroupId, OpenFilesByPath, OpenFile } from '../types/app';
import type { MonacoEditor } from '../types/monaco';

// 编辑器实例映射类型 - 与 useEditorOperations 保持一致
type EditorInstanceMap = Partial<Record<EditorGroupId, MonacoEditor | null>>;
type EditorMountedPathMap = Partial<Record<EditorGroupId, string | null>>;

export interface UseAutoSaveOptions {
  autoSaveDelay: number;
  formatOnSave: boolean;
  openFilesByPathRef: React.MutableRefObject<OpenFilesByPath>;
  editorInstanceByGroupRef: React.MutableRefObject<EditorInstanceMap>;
  editorMountedFilePathByGroupRef: React.MutableRefObject<EditorMountedPathMap>;
  programmaticRefreshPathsRef: React.MutableRefObject<Set<string>>;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
  saveFileInternal: (file: OpenFile) => Promise<void>;
  // 外部传入的定时器管理
  autoSaveTimersRef: React.MutableRefObject<Map<string, number>>;
  clearAutoSaveTimer: (filePath: string) => void;
}

export interface UseAutoSaveReturn {
  handleEditorChange: (filePath: string, value: string | undefined, ev?: unknown) => void;
}

export function useAutoSave({
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
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const handleEditorChange = useCallback(
    (filePath: string, value: string | undefined, ev?: unknown) => {
      if (value === undefined) return;

      const event = ev as { isFlush?: boolean } | undefined;
      if (event?.isFlush) {
        return;
      }

      const normalizedPath = normalizePathForCompare(filePath).toLowerCase();
      if (programmaticRefreshPathsRef.current.has(normalizedPath)) {
        programmaticRefreshPathsRef.current.delete(normalizedPath);
        return;
      }

      // Virtual plan tabs: mirror into planStore *outside* the openFiles updater so
      // PLAN_UPDATED (and the in-conversation panel) always receive the edit.
      // Side effects must not live inside setState/Zustand updaters.
      if (isPlanEditorPath(filePath)) {
        onPlanEditorContentChange(filePath, value);
        setOpenFilesByPath((prev) => {
          const existing = prev[filePath];
          if (!existing || existing.kind !== 'text') return prev;
          if (
            normalizeEolForCompare(existing.content) === normalizeEolForCompare(value) &&
            !existing.isDirty
          ) {
            return prev;
          }
          return {
            ...prev,
            [filePath]: { ...existing, content: value, isDirty: false },
          };
        });
        return;
      }

      setOpenFilesByPath((prev) => {
        const existing = prev[filePath];
        if (!existing) return prev;
        if (existing.kind !== 'text') return prev;

        if (normalizeEolForCompare(existing.content) === normalizeEolForCompare(value)) {
          return prev;
        }

        return {
          ...prev,
          [filePath]: { ...existing, content: value, isDirty: true },
        };
      });

      if (autoSaveDelay > 0) {
        clearAutoSaveTimer(filePath);

        const newTimer = window.setTimeout(async () => {
          try {
            const file = openFilesByPathRef.current[filePath];
            if (file && file.kind === 'text' && file.isDirty) {
              if (isPlanEditorPath(filePath)) {
                savePlanEditorContent(filePath, file.content);
                return;
              }
              if (formatOnSave) {
                try {
                  for (const [groupId, mountedPath] of Object.entries(
                    editorMountedFilePathByGroupRef.current
                  )) {
                    if (mountedPath === filePath) {
                      const editor = editorInstanceByGroupRef.current[groupId as EditorGroupId];
                      if (editor) {
                        const formatAction = (editor as MonacoEditor).getAction?.(
                          'editor.action.formatDocument'
                        );
                        if (formatAction) {
                          await formatAction.run();
                          const formattedContent = (editor as MonacoEditor).getValue?.();
                          if (formattedContent !== undefined) {
                            setOpenFilesByPath((prev) => ({
                              ...prev,
                              [filePath]: { ...prev[filePath], content: formattedContent },
                            }));
                          }
                        }
                        break;
                      }
                    }
                  }
                } catch (formatError) {
                  console.warn(`[AutoSave] 格式化失败: ${filePath}`, formatError);
                }
              }

              const updatedFile = openFilesByPathRef.current[filePath];
              if (updatedFile && updatedFile.kind === 'text' && updatedFile.isDirty) {
                await saveFileInternal(updatedFile);
                logDebug('文件已自动保存: ' + filePath, 'AutoSave');
              }
            }
          } catch (error) {
            console.error(`[AutoSave] 自动保存失败: ${filePath}`, error);
          } finally {
            autoSaveTimersRef.current.delete(filePath);
          }
        }, autoSaveDelay);

        autoSaveTimersRef.current.set(filePath, newTimer);
      }
    },
    [
      autoSaveDelay,
      formatOnSave,
      saveFileInternal,
      setOpenFilesByPath,
      editorInstanceByGroupRef,
      editorMountedFilePathByGroupRef,
      clearAutoSaveTimer,
      autoSaveTimersRef,
      programmaticRefreshPathsRef,
      openFilesByPathRef,
    ]
  );

  return {
    handleEditorChange,
  };
}

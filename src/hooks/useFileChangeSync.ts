import { useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { EditorGroupId, EditorGroupState, OpenFilesByPath } from '../types/app';
import type { MonacoEditor } from '../types/monaco';
import {
  normalizePathForCompare,
  normalizeEolForCompare,
  isPathUnderRoot,
} from '../utils/pathUtils';
import { isVirtualEditorPath } from '../utils/planEditorBridge';
import { APP_CONFIG } from '../config/defaultSettings';
import { useFileRefresh } from './useFileRefresh';

export interface UseFileChangeSyncOptions {
  openFilesByPathRef: React.MutableRefObject<OpenFilesByPath>;
  programmaticRefreshPathsRef: React.MutableRefObject<Set<string>>;
  editorInstanceByGroupRef: React.MutableRefObject<
    Partial<Record<EditorGroupId, MonacoEditor | null>>
  >;
  editorMountedFilePathByGroupRef: React.MutableRefObject<
    Partial<Record<EditorGroupId, string | null>>
  >;
  projectPath: string;
  refreshFileTreeFromDisk: (paths: string[]) => Promise<void>;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
  setEditorGroups: React.Dispatch<React.SetStateAction<EditorGroupState[]>>;
}

export function useFileChangeSync({
  openFilesByPathRef,
  programmaticRefreshPathsRef,
  editorInstanceByGroupRef,
  editorMountedFilePathByGroupRef,
  projectPath,
  refreshFileTreeFromDisk,
  setOpenFilesByPath,
  setEditorGroups,
}: UseFileChangeSyncOptions) {
  const externalRefreshInFlightRef = useRef(false);
  const refreshRetryTimersRef = useRef<number[]>([]);

  const isIgnoredByProjectWatcher = useCallback((filePath: string) => {
    const normalized = normalizePathForCompare(filePath).toLowerCase();
    return (
      normalized.includes('node_modules') ||
      normalized.includes('.git') ||
      normalized.includes('target')
    );
  }, []);

  const { refreshOpenFilesFromDisk } = useFileRefresh({
    openFilesByPathRef,
    editorInstanceByGroupRef,
    editorMountedFilePathByGroupRef,
    programmaticRefreshPathsRef,
    setEditorGroups,
    setOpenFilesByPath,
  });

  const clearRefreshRetryTimers = useCallback(() => {
    for (const timer of refreshRetryTimersRef.current) {
      window.clearTimeout(timer);
    }
    refreshRetryTimersRef.current = [];
  }, []);

  const scheduleOpenFilesRefresh = useCallback(
    (paths: string[]) => {
      clearRefreshRetryTimers();

      const runRefresh = () => {
        void refreshOpenFilesFromDisk(paths);
      };

      runRefresh();

      for (const delay of [120, 400, 1000]) {
        const timer = window.setTimeout(runRefresh, delay);
        refreshRetryTimersRef.current.push(timer);
      }
    },
    [clearRefreshRetryTimers, refreshOpenFilesFromDisk]
  );

  const handleFilesChanged = useCallback(
    (paths: string[]) => {
      scheduleOpenFilesRefresh(paths);
      void refreshFileTreeFromDisk(paths);
    },
    [refreshFileTreeFromDisk, scheduleOpenFilesRefresh]
  );

  useEffect(() => {
    const unlistenPromise = listen<{ paths: string[] }>('agent-files-changed', (event) => {
      handleFilesChanged(event.payload.paths);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [handleFilesChanged]);

  useEffect(() => {
    return () => {
      clearRefreshRetryTimers();
    };
  }, [clearRefreshRetryTimers]);

  useEffect(() => {
    const handleAgentFileContentSync = (event: Event) => {
      const customEvent = event as CustomEvent<{ filePath?: string; content?: string }>;
      const filePath = customEvent.detail?.filePath;
      const content = customEvent.detail?.content;
      if (!filePath || typeof content !== 'string') return;

      const targetPath = normalizePathForCompare(filePath).toLowerCase();
      setOpenFilesByPath((prev) => {
        let changed = false;
        const next = { ...prev };

        for (const [openPath, file] of Object.entries(prev)) {
          if (normalizePathForCompare(openPath).toLowerCase() !== targetPath) continue;
          if (!file || file.kind !== 'text') continue;
          if (
            normalizeEolForCompare(file.content) === normalizeEolForCompare(content) &&
            !('isDeleted' in file && file.isDeleted)
          ) {
            return prev;
          }

          next[openPath] = { ...file, content, isDirty: false, isDeleted: false };
          changed = true;
        }

        return changed ? next : prev;
      });

      requestAnimationFrame(() => {
        for (const [groupIdRaw, editor] of Object.entries(editorInstanceByGroupRef.current)) {
          const groupId = groupIdRaw as EditorGroupId;
          const mountedPath = editorMountedFilePathByGroupRef.current[groupId];
          if (!editor || !mountedPath) continue;
          if (normalizePathForCompare(mountedPath).toLowerCase() !== targetPath) continue;

          try {
            const model = editor.getModel?.();
            if (!model) continue;
            const current = model.getValue();
            if (normalizeEolForCompare(current) === normalizeEolForCompare(content)) continue;

            programmaticRefreshPathsRef.current.add(targetPath);
            model.setValue(content);
            window.setTimeout(() => {
              programmaticRefreshPathsRef.current.delete(targetPath);
            }, 0);
          } catch {
            /* ignore model sync errors */
          }
        }
      });
    };

    window.addEventListener('agent-file-content-sync', handleAgentFileContentSync as EventListener);
    return () => {
      window.removeEventListener(
        'agent-file-content-sync',
        handleAgentFileContentSync as EventListener
      );
    };
  }, [setOpenFilesByPath, editorInstanceByGroupRef, editorMountedFilePathByGroupRef]);

  useEffect(() => {
    const intervalMs = Math.max(200, Math.min(1000, APP_CONFIG.autoRefreshIntervalMs || 5000));
    const timer = window.setInterval(() => {
      const candidates = Object.values(openFilesByPathRef.current)
        .filter((file) => file && file.kind === 'text' && !file.isDirty)
        .filter((file) => !isVirtualEditorPath(file.path))
        .filter(
          (file) =>
            !projectPath ||
            !isPathUnderRoot(file.path, projectPath) ||
            isIgnoredByProjectWatcher(file.path)
        )
        .map((file) => file.path);

      if (candidates.length === 0 || externalRefreshInFlightRef.current) return;

      externalRefreshInFlightRef.current = true;
      void refreshOpenFilesFromDisk(candidates)
        .catch(() => {
          // ignore refresh failures
        })
        .finally(() => {
          externalRefreshInFlightRef.current = false;
        });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [projectPath, refreshOpenFilesFromDisk, isIgnoredByProjectWatcher]);

  return { handleFilesChanged, isIgnoredByProjectWatcher };
}

/**
 * 文件监听 Hook
 */

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface UseFileWatcherOptions {
  projectPath: string;
  onFilesChanged: (paths: string[]) => void;
}

export function useFileWatcher({ projectPath, onFilesChanged }: UseFileWatcherOptions): void {
  const onFilesChangedRef = useRef(onFilesChanged);
  onFilesChangedRef.current = onFilesChanged;

  /**
   * 启动文件监听
   */
  useEffect(() => {
    if (!projectPath) return;

    invoke('start_watching', { path: projectPath }).catch((err) => {
      console.error('[useFileWatcher] Failed to start file watcher:', err);
    });

    return () => {
      invoke('stop_watching').catch((err) => {
        console.error('[useFileWatcher] Failed to stop file watcher:', err);
      });
    };
  }, [projectPath]);

  /**
   * 监听文件变更事件
   */
  useEffect(() => {
    const pendingPaths = new Set<string>();
    let timer: number | null = null;

    const flush = () => {
      timer = null;
      if (pendingPaths.size === 0) return;
      const paths = Array.from(pendingPaths);
      pendingPaths.clear();
      onFilesChangedRef.current(paths);
    };

    const unlistenPromise = listen<{ paths: string[] }>('file-changed', (event) => {
      for (const p of event.payload.paths || []) {
        if (typeof p === 'string' && p.trim()) pendingPaths.add(p);
      }

      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(flush, 120);
    });

    return () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}

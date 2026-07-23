import { useEffect, useRef, useCallback } from 'react';
import { useCbmStore, type CbmIndexedProject } from '../stores/useCbmStore';
import { useNotification } from '../contexts/NotificationContext';
import { useTranslation } from '../i18n';

export type { CbmIndexedProject };

/**
 * Thin wrapper over the global CBM store.
 * `enabled` should track `enableCodeGraph`; pass `graphReady` from `useCbmGraphReady`.
 */
export function useIndexedProjects(enabled: boolean, graphReady = false) {
  const t = useTranslation();
  const { showInfo, showError } = useNotification();
  const projects = useCbmStore((s) => s.projects);
  const loading = useCbmStore((s) => s.projectsLoading);
  const error = useCbmStore((s) => s.projectsError);
  const prevEnabledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return [];
    return useCbmStore.getState().refreshProjects();
  }, [enabled]);

  const loadAndReconcile = useCallback(async () => {
    if (!enabled) return [];
    const { list, cleanedNames } = await useCbmStore.getState().loadAndReconcile(true);
    for (const name of cleanedNames) {
      showInfo(t.graph.indexedProjectsStale.replace('{name}', name));
    }
    return list;
  }, [enabled, showInfo, t.graph.indexedProjectsStale]);

  const deleteIndex = useCallback(
    async (repoPath: string) => {
      try {
        await useCbmStore.getState().deleteProject(repoPath, true);
        showInfo(t.graph.indexDeleted);
      } catch {
        showError(t.graph.indexDeleteFailed);
      }
    },
    [showError, showInfo, t.graph.indexDeleted, t.graph.indexDeleteFailed]
  );

  // Refresh when code graph is turned on, or when the sidecar becomes ready.
  useEffect(() => {
    const wasEnabled = prevEnabledRef.current;
    prevEnabledRef.current = enabled;
    if (enabled && !wasEnabled) {
      void useCbmStore.getState().refreshProjects();
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled && graphReady) {
      void useCbmStore.getState().refreshProjects();
    }
  }, [enabled, graphReady]);

  return {
    projects,
    loading,
    error,
    refresh,
    loadAndReconcile,
    deleteIndex,
  };
}

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useEnableCodeGraph, useGraphAutoIndexMaxFiles, useGraphAutoIndexOnOpen } from '../stores';
import { useCbmGraphReady } from '../stores/useCbmStore';
import { isCbmSkippedTooLarge, scheduleCbmWorkspaceIndex } from '../utils/cbmRuntime';

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').toLowerCase();
}

/** Re-index main window project after Agent removes it from workspace list (§8.6 optional). */
export function useCbmMainWindowReindex(projectPath: string): void {
  const enableCodeGraph = useEnableCodeGraph();
  const graphAutoIndexOnOpen = useGraphAutoIndexOnOpen();
  const graphAutoIndexMaxFiles = useGraphAutoIndexMaxFiles();
  const cbmReady = useCbmGraphReady(enableCodeGraph);
  const enabled = cbmReady && graphAutoIndexOnOpen;

  useEffect(() => {
    if (!enabled || !projectPath.trim()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      unlisten = await listen<{ repo_path?: string }>('cbm-agent-project-deleted', (event) => {
        const deleted = event.payload.repo_path?.trim();
        if (!deleted) return;
        if (normalizePath(deleted) !== normalizePath(projectPath)) return;
        void scheduleCbmWorkspaceIndex(projectPath, {
          maxFiles: graphAutoIndexMaxFiles > 0 ? graphAutoIndexMaxFiles : undefined,
        }).then((result) => {
          if (!cancelled && isCbmSkippedTooLarge(result)) {
            console.warn('CBM re-index skipped: project too large');
          }
        });
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, graphAutoIndexMaxFiles, projectPath]);
}

import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import {
  checkCbmSidecarAvailable,
  deleteCbmWorkspaceIndex,
  fetchCbmStorageInfo,
  listIndexedProjects,
  probeTauriIpc,
  type CbmIndexedProject,
} from '../utils/cbmRuntime';

export type { CbmIndexedProject };

interface CbmStoreState {
  sidecarChecked: boolean;
  sidecarAvailable: boolean;
  versionMismatch: boolean;
  ipcReady: boolean;
  projects: CbmIndexedProject[];
  projectsLoading: boolean;
  projectsError: string | null;
  initialized: boolean;
  eventListenersRegistered: boolean;
  initialize: () => Promise<void>;
  refreshProjects: () => Promise<CbmIndexedProject[]>;
  loadAndReconcile: (
    enableCodeGraph: boolean,
  ) => Promise<{ list: CbmIndexedProject[]; cleanedNames: string[] }>;
  deleteProject: (repoPath: string, enableCodeGraph: boolean) => Promise<void>;
}

let refreshPromise: Promise<CbmIndexedProject[]> | null = null;
let initPromise: Promise<void> | null = null;

async function registerCbmEventListeners(
  refresh: () => Promise<CbmIndexedProject[]>,
): Promise<void> {
  if (!isTauri()) return;
  await Promise.all([
    listen('cbm-index-complete', () => {
      void refresh();
    }),
    listen('cbm-index-deleted', () => {
      void refresh();
    }),
  ]);
}

export const useCbmStore = create<CbmStoreState>()(
  devtools(
    (set, get) => ({
      sidecarChecked: false,
      sidecarAvailable: false,
      versionMismatch: false,
      ipcReady: false,
      projects: [],
      projectsLoading: false,
      projectsError: null,
      initialized: false,
      eventListenersRegistered: false,

      initialize: async () => {
        if (initPromise) return initPromise;
        initPromise = (async () => {
          if (!isTauri()) {
            set({
              sidecarChecked: true,
              sidecarAvailable: false,
              ipcReady: false,
              initialized: true,
            });
            return;
          }

          const ipcReady = await probeTauriIpc();
          let sidecarAvailable = ipcReady ? await checkCbmSidecarAvailable() : false;

          // Verify sidecar runtime version matches pinned major version.
          // A mismatch (e.g. user replaced the binary) means CLI tool names
          // may not match, causing silent failures. Degrade to unavailable.
          let versionMismatch = false;
          if (ipcReady && sidecarAvailable) {
            const info = await fetchCbmStorageInfo();
            if (info?.runtimeVersion && info.pinnedVersion) {
              const pinnedMajor = info.pinnedVersion.split('.')[0];
              const runtimeMajor = info.runtimeVersion.split('.')[0];
              if (pinnedMajor !== runtimeMajor) {
                console.warn(
                  `CBM version mismatch: pinned=${info.pinnedVersion}, runtime=${info.runtimeVersion}`,
                );
                sidecarAvailable = false;
                versionMismatch = true;
              }
            }
          }

          set({
            ipcReady,
            sidecarAvailable,
            sidecarChecked: true,
            initialized: true,
            versionMismatch,
            projectsError: !ipcReady
              ? 'Tauri IPC unavailable'
              : versionMismatch
                ? 'CBM version mismatch'
                : null,
          });

          if (!get().eventListenersRegistered && isTauri()) {
            await registerCbmEventListeners(() => get().refreshProjects());
            set({ eventListenersRegistered: true });
          }

          if (ipcReady && sidecarAvailable) {
            await get().refreshProjects();
          }
        })().finally(() => {
          initPromise = null;
        });
        return initPromise;
      },

      refreshProjects: async () => {
        if (!isTauri() || !get().ipcReady) {
          return [];
        }

        if (refreshPromise) return refreshPromise;

        set({ projectsLoading: true, projectsError: null });
        refreshPromise = (async () => {
          try {
            const list = await listIndexedProjects();
            set({ projects: list, projectsError: null });
            return list;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('Failed to list CBM projects:', error);
            set({ projects: [], projectsError: message });
            return [];
          } finally {
            set({ projectsLoading: false });
            refreshPromise = null;
          }
        })();

        return refreshPromise;
      },

      loadAndReconcile: async (enableCodeGraph: boolean) => {
        const list = await get().refreshProjects();
        const stale = list.filter((item) => item.path_status !== 'ok');
        if (stale.length === 0) {
          return { list, cleanedNames: [] as string[] };
        }

        const cleanedNames: string[] = [];
        for (const item of stale) {
          try {
            await deleteCbmWorkspaceIndex(item.repo_path, enableCodeGraph);
            cleanedNames.push(item.display_name);
          } catch {
            // best-effort stale cleanup
          }
        }
        const refreshed = await get().refreshProjects();
        return { list: refreshed, cleanedNames };
      },

      deleteProject: async (repoPath: string, enableCodeGraph: boolean) => {
        await deleteCbmWorkspaceIndex(repoPath, enableCodeGraph);
        await get().refreshProjects();
      },
    }),
    { name: 'CbmStore' },
  ),
);

export const useCbmSidecarState = () =>
  useCbmStore(
    useShallow((s) => ({
      available: s.sidecarAvailable,
      checked: s.sidecarChecked,
      ipcReady: s.ipcReady,
      initialized: s.initialized,
      versionMismatch: s.versionMismatch,
    })),
  );

export const useCbmProjects = () =>
  useCbmStore(
    useShallow((s) => ({
      projects: s.projects,
      loading: s.projectsLoading,
      error: s.projectsError,
      refresh: s.refreshProjects,
      loadAndReconcile: s.loadAndReconcile,
      deleteProject: s.deleteProject,
    })),
  );

/** True when code graph tools and CBM commands may be used. */
export function useCbmGraphReady(enableCodeGraph: boolean): boolean {
  const checked = useCbmStore((s) => s.sidecarChecked);
  const ipcReady = useCbmStore((s) => s.ipcReady);
  const available = useCbmStore((s) => s.sidecarAvailable);
  return Boolean(enableCodeGraph && checked && ipcReady && available);
}

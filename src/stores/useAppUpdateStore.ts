import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'restartRequired'
  | 'error'
  | 'desktopOnly';

interface PendingUpdate {
  version: string;
  body?: string | null;
  date?: string | null;
  downloadAndInstall: (
    onEvent?: (event: {
      event: string;
      data?: { contentLength?: number; chunkLength?: number };
    }) => void,
  ) => Promise<void>;
}

interface AppUpdateState {
  currentVersion: string | null;
  status: AppUpdateStatus;
  availableVersion: string | null;
  notes: string | null;
  publishedAt: string | null;
  downloadedBytes: number;
  contentLength: number | null;
  error: string | null;
  checkForUpdates: (options?: { silent?: boolean }) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  clearError: () => void;
}

let checkPromise: Promise<void> | null = null;
let pendingUpdate: PendingUpdate | null = null;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function resolveCurrentVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}

export const useAppUpdateStore = create<AppUpdateState>()(
  devtools(
    (set, get) => ({
      currentVersion: null,
      status: 'idle',
      availableVersion: null,
      notes: null,
      publishedAt: null,
      downloadedBytes: 0,
      contentLength: null,
      error: null,

      clearError: () => set({ error: null }),

      checkForUpdates: (options) => {
        if (checkPromise) return checkPromise;

        checkPromise = (async () => {
          if (!isTauri()) {
            set({
              status: 'desktopOnly',
              error: null,
              availableVersion: null,
              notes: null,
              publishedAt: null,
            });
            return;
          }

          set({
            status: 'checking',
            error: null,
            downloadedBytes: 0,
            contentLength: null,
          });

          try {
            const currentVersion = await resolveCurrentVersion();
            const { check } = await import('@tauri-apps/plugin-updater');
            const update = await check();

            if (!update) {
              pendingUpdate = null;
              set({
                currentVersion,
                status: 'upToDate',
                availableVersion: null,
                notes: null,
                publishedAt: null,
                error: null,
              });
              return;
            }

            pendingUpdate = {
              version: update.version,
              body: update.body,
              date: update.date,
              downloadAndInstall: (onEvent) => update.downloadAndInstall(onEvent as never),
            };

            set({
              currentVersion,
              status: 'available',
              availableVersion: update.version,
              notes: update.body ?? null,
              publishedAt: update.date ?? null,
              error: null,
            });
          } catch (error) {
            if (options?.silent) {
              set({
                status: get().availableVersion ? 'available' : 'idle',
                error: null,
              });
              return;
            }
            set({
              status: 'error',
              error: errorMessage(error),
            });
          }
        })().finally(() => {
          checkPromise = null;
        });

        return checkPromise;
      },

      downloadAndInstall: async () => {
        if (!isTauri()) {
          set({ status: 'desktopOnly', error: null });
          return;
        }

        const update = pendingUpdate;
        if (!update) {
          set({
            status: 'error',
            error: 'No update is ready to install. Check for updates first.',
          });
          return;
        }

        set({
          status: 'downloading',
          error: null,
          downloadedBytes: 0,
          contentLength: null,
        });

        try {
          await update.downloadAndInstall((event) => {
            if (event.event === 'Started') {
              set({
                status: 'downloading',
                contentLength: event.data?.contentLength ?? null,
                downloadedBytes: 0,
              });
              return;
            }
            if (event.event === 'Progress') {
              const chunk = event.data?.chunkLength ?? 0;
              set((state) => ({
                status: 'downloading',
                downloadedBytes: state.downloadedBytes + chunk,
              }));
              return;
            }
            if (event.event === 'Finished') {
              set({ status: 'installing' });
            }
          });

          // On Windows the updater may exit the process for install.
          // If we are still alive, surface restart-required state.
          set({
            status: 'restartRequired',
            error: null,
          });
        } catch (error) {
          set({
            status: 'error',
            error: errorMessage(error),
          });
        }
      },
    }),
    { name: 'AppUpdateStore' },
  ),
);

export const useAppUpdateState = () =>
  useAppUpdateStore(
    useShallow((s) => ({
      currentVersion: s.currentVersion,
      status: s.status,
      availableVersion: s.availableVersion,
      notes: s.notes,
      publishedAt: s.publishedAt,
      downloadedBytes: s.downloadedBytes,
      contentLength: s.contentLength,
      error: s.error,
      checkForUpdates: s.checkForUpdates,
      downloadAndInstall: s.downloadAndInstall,
      clearError: s.clearError,
    })),
  );

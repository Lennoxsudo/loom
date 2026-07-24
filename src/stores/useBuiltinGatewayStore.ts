import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  activateBuiltinGateway,
  checkBuiltinHealth,
  createInstallId,
  fetchBuiltinModels,
  fetchBuiltinQuota,
  type BuiltinGatewayState,
  type BuiltinQuotaStatus,
  type BuiltinQuotas,
  BUILTIN_STORAGE_FILE,
  keyPrefix,
} from '../utils/builtinGateway';

export type BuiltinGatewayStatus =
  | 'idle'
  | 'loading'
  | 'inactive'
  | 'active'
  | 'activating'
  | 'error'
  | 'desktopOnly';

interface BuiltinGatewayStore extends BuiltinGatewayState {
  status: BuiltinGatewayStatus;
  error: string | null;
  healthy: boolean | null;
  /** Live GET /v1/quota snapshot (not persisted). */
  quotaStatus: BuiltinQuotaStatus | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  activate: (inviteCode: string) => Promise<boolean>;
  clearLocalKey: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  /** Manual refresh only — activation already fetches once and caches to disk. */
  refreshModels: () => Promise<string[]>;
  refreshQuota: () => Promise<BuiltinQuotaStatus | null>;
  isActivated: () => boolean;
  getKeyPrefix: () => string;
}

function emptyState(): BuiltinGatewayState {
  return {
    installId: '',
    apiKey: null,
    clientSecret: null,
    clientId: null,
    activatedAt: null,
    lastQuotas: null,
    models: [],
  };
}

function parseStoredModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is string => typeof m === 'string')
    .map((m) => m.trim())
    .filter(Boolean);
}

function parseStored(raw: string): BuiltinGatewayState {
  try {
    const data = JSON.parse(raw) as Partial<BuiltinGatewayState>;
    return {
      installId: typeof data.installId === 'string' ? data.installId : '',
      apiKey: typeof data.apiKey === 'string' && data.apiKey ? data.apiKey : null,
      clientSecret:
        typeof data.clientSecret === 'string' && data.clientSecret ? data.clientSecret : null,
      clientId: typeof data.clientId === 'string' ? data.clientId : null,
      activatedAt: typeof data.activatedAt === 'string' ? data.activatedAt : null,
      lastQuotas:
        data.lastQuotas && typeof data.lastQuotas === 'object'
          ? (data.lastQuotas as BuiltinQuotas)
          : null,
      models: parseStoredModels(data.models),
    };
  } catch {
    return emptyState();
  }
}

async function resolveStoragePath(): Promise<string> {
  const appData = await invoke<string>('get_app_data_path');
  const sep = appData.includes('\\') ? '\\' : '/';
  const base = appData.replace(/[/\\]+$/, '');
  return `${base}${sep}${BUILTIN_STORAGE_FILE}`;
}

async function readStateFromDisk(): Promise<BuiltinGatewayState> {
  if (!isTauri()) return emptyState();
  try {
    const path = await resolveStoragePath();
    const raw = await invoke<string>('read_file_content', { filePath: path });
    return parseStored(raw);
  } catch {
    return emptyState();
  }
}

async function writeStateToDisk(state: BuiltinGatewayState): Promise<void> {
  if (!isTauri()) return;
  const path = await resolveStoragePath();
  const payload: BuiltinGatewayState = {
    installId: state.installId,
    apiKey: state.apiKey,
    clientSecret: state.clientSecret,
    clientId: state.clientId,
    activatedAt: state.activatedAt,
    lastQuotas: state.lastQuotas,
    models: state.models ?? [],
  };
  await invoke('write_file_content', {
    filePath: path,
    content: JSON.stringify(payload, null, 2),
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export const useBuiltinGatewayStore = create<BuiltinGatewayStore>()(
  devtools(
    (set, get) => ({
      ...emptyState(),
      status: 'idle',
      error: null,
      healthy: null,
      quotaStatus: null,
      hydrated: false,

      isActivated: () => Boolean(get().apiKey?.trim() && get().clientSecret?.trim()),

      getKeyPrefix: () => keyPrefix(get().apiKey),

      hydrate: async () => {
        if (!isTauri()) {
          set({ status: 'desktopOnly', hydrated: true });
          return;
        }
        set({ status: 'loading', error: null });
        try {
          let stored = await readStateFromDisk();
          if (!stored.installId) {
            stored = { ...stored, installId: createInstallId() };
            await writeStateToDisk(stored);
          }
          const hasKey = Boolean(stored.apiKey?.trim());
          const hasSecret = Boolean(stored.clientSecret?.trim());
          const active = hasKey && hasSecret;
          const needsReactivate = hasKey && !hasSecret;
          set({
            ...stored,
            models: stored.models ?? [],
            status: needsReactivate ? 'error' : active ? 'active' : 'inactive',
            hydrated: true,
            error: needsReactivate ? 'UNAUTHORIZED' : null,
            quotaStatus: active ? get().quotaStatus : null,
          });
          if (active) {
            void get().refreshQuota();
          }
        } catch (error) {
          set({
            status: 'error',
            error: errorMessage(error),
            hydrated: true,
          });
        }
      },

      activate: async (inviteCode: string) => {
        if (!isTauri()) {
          set({ status: 'desktopOnly' });
          return false;
        }
        let { installId } = get();
        if (!installId) {
          installId = createInstallId();
          set({ installId });
        }
        set({ status: 'activating', error: null });
        try {
          const result = await activateBuiltinGateway(inviteCode, installId);
          const quotas: BuiltinQuotas | null = result.quotas
            ? {
                qps: result.quotas.qps ?? 0,
                daily_requests: result.quotas.daily_requests ?? 0,
                daily_tokens: result.quotas.daily_tokens ?? 0,
              }
            : null;
          let models: string[] = [];
          try {
            models = await fetchBuiltinModels(result.api_key);
          } catch (modelErr) {
            const msg = errorMessage(modelErr);
            if (msg === 'UNAUTHORIZED' || (modelErr as { status?: number }).status === 401) {
              set({ error: 'UNAUTHORIZED', status: 'error' });
              return false;
            }
            // Activation succeeded even if model list fails transiently
          }
          const next: BuiltinGatewayState = {
            installId,
            apiKey: result.api_key,
            clientSecret: result.client_secret,
            clientId: result.client_id,
            activatedAt: new Date().toISOString(),
            lastQuotas: quotas,
            models,
          };
          await writeStateToDisk(next);
          set({
            ...next,
            status: 'active',
            error: null,
            quotaStatus: null,
          });
          void get().refreshQuota();
          return true;
        } catch (error) {
          set({
            status: get().apiKey ? 'active' : 'inactive',
            error: errorMessage(error),
          });
          return false;
        }
      },

      clearLocalKey: async () => {
        const { installId } = get();
        const next: BuiltinGatewayState = {
          installId: installId || createInstallId(),
          apiKey: null,
          clientSecret: null,
          clientId: null,
          activatedAt: null,
          lastQuotas: null,
          models: [],
        };
        try {
          await writeStateToDisk(next);
        } catch {
          // still clear memory
        }
        set({
          ...next,
          status: 'inactive',
          quotaStatus: null,
          error: null,
        });
      },

      refreshHealth: async () => {
        const ok = await checkBuiltinHealth();
        set({ healthy: ok });
      },

      refreshModels: async () => {
        const apiKey = get().apiKey;
        if (!apiKey) {
          set({ models: [] });
          return [];
        }
        try {
          const models = await fetchBuiltinModels(apiKey);
          const { installId, clientId, clientSecret, activatedAt, lastQuotas } = get();
          const next: BuiltinGatewayState = {
            installId,
            apiKey,
            clientSecret,
            clientId,
            activatedAt,
            lastQuotas,
            models,
          };
          await writeStateToDisk(next);
          set({ models, error: null, status: 'active' });
          return models;
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status === 401 || errorMessage(error) === 'UNAUTHORIZED') {
            set({ error: 'UNAUTHORIZED', status: 'error' });
          } else {
            set({ error: errorMessage(error) });
          }
          return [];
        }
      },

      refreshQuota: async () => {
        const apiKey = get().apiKey;
        if (!apiKey) {
          set({ quotaStatus: null });
          return null;
        }
        try {
          const status = await fetchBuiltinQuota(apiKey);
          set({
            quotaStatus: status,
            lastQuotas: status.quotas,
            error: get().error === 'UNAUTHORIZED' ? null : get().error,
            status:
              get().status === 'error' && get().error === 'UNAUTHORIZED' ? 'active' : get().status,
          });
          // Persist limit snapshot only (usage/remaining stay in memory).
          const { installId, clientId, clientSecret, activatedAt, models } = get();
          void writeStateToDisk({
            installId,
            apiKey,
            clientSecret,
            clientId,
            activatedAt,
            lastQuotas: status.quotas,
            models: models ?? [],
          });
          return status;
        } catch (error) {
          const httpStatus = (error as { status?: number }).status;
          if (httpStatus === 401 || errorMessage(error) === 'UNAUTHORIZED') {
            set({ error: 'UNAUTHORIZED', status: 'error' });
          }
          // Keep previous quotaStatus on transient failures
          return get().quotaStatus;
        }
      },
    }),
    { name: 'BuiltinGatewayStore' }
  )
);

export const useBuiltinGatewayState = () =>
  useBuiltinGatewayStore(
    useShallow((s) => ({
      status: s.status,
      error: s.error,
      installId: s.installId,
      clientId: s.clientId,
      activatedAt: s.activatedAt,
      lastQuotas: s.lastQuotas,
      quotaStatus: s.quotaStatus,
      healthy: s.healthy,
      models: s.models,
      hydrated: s.hydrated,
      apiKeyPresent: Boolean(s.apiKey),
      keyPrefix: keyPrefix(s.apiKey),
    }))
  );

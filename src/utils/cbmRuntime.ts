import { invoke, isTauri } from '@tauri-apps/api/core';

const IPC_RETRY_ATTEMPTS = 8;
const IPC_RETRY_BASE_MS = 200;
const IPC_RETRY_MAX_MS = 3000;
const DEFAULT_INVOKE_TIMEOUT_MS = 15_000;

function isTransientIpcError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('connection refused') ||
    msg.includes('err_connection_refused') ||
    msg.includes('network') ||
    msg.includes('ipc custom protocol')
  );
}

function retryDelayMs(attempt: number): number {
  return Math.min(IPC_RETRY_BASE_MS * 2 ** attempt, IPC_RETRY_MAX_MS);
}

/**
 * Wrap invoke with retry for Tauri IPC startup race.
 * During `tauri dev`, the webview may load before the Rust IPC channel is ready.
 */
export async function invokeWithRetry<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < IPC_RETRY_ATTEMPTS; attempt++) {
    try {
      return await invokeWithTimeout<T>(cmd, args, timeoutMs);
    } catch (error) {
      lastError = error;
      if (isTransientIpcError(error) && attempt < IPC_RETRY_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function invokeWithTimeout<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(cmd, args),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Tauri invoke timeout (${timeoutMs}ms): ${cmd}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Probe whether Tauri IPC is reachable (used once at app boot). */
export async function probeTauriIpc(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invokeWithRetry<boolean>('cbm_sidecar_available', undefined, 5_000);
    return true;
  } catch {
    return false;
  }
}

export async function checkCbmSidecarAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invokeWithRetry<boolean>('cbm_sidecar_available', undefined, 5_000);
  } catch {
    return false;
  }
}

export interface CbmScheduleResult {
  status: string;
  repoPath: string;
  message?: string | null;
}

export interface CbmStorageInfo {
  cacheDir: string;
  totalBytes: number;
  pinnedVersion: string;
  runtimeVersion?: string | null;
  sidecarAvailable: boolean;
}

export interface ScheduleCbmOptions {
  maxFiles?: number;
  force?: boolean;
}

export async function scheduleCbmWorkspaceIndex(
  repoPath: string,
  options?: ScheduleCbmOptions,
): Promise<CbmScheduleResult | null> {
  const trimmed = repoPath.trim();
  if (!trimmed) return null;
  const maxFiles = options?.maxFiles && options.maxFiles > 0 ? options.maxFiles : null;
  const force = options?.force === true;
  try {
    return await invokeWithRetry<CbmScheduleResult>('cbm_schedule_workspace_index', {
      repoPath: trimmed,
      maxFiles,
      force,
    });
  } catch (error) {
    console.warn('CBM schedule failed:', error);
    return null;
  }
}

export async function reindexCbmWorkspaceIndex(
  repoPath: string,
  options?: Omit<ScheduleCbmOptions, 'force'>,
): Promise<CbmScheduleResult | null> {
  return scheduleCbmWorkspaceIndex(repoPath, { ...options, force: true });
}

export type CbmScheduleOutcome =
  | 'scheduled'
  | 'in_progress'
  | 'already_indexed'
  | 'skipped_too_large'
  | 'skipped_unavailable'
  | 'skipped_empty'
  | 'failed'
  | 'unknown';

export function getCbmScheduleOutcome(
  result: CbmScheduleResult | null | undefined,
): CbmScheduleOutcome {
  if (!result) return 'failed';
  switch (result.status) {
    case 'scheduled':
      return 'scheduled';
    case 'in_progress':
      return 'in_progress';
    case 'already_indexed':
      return 'already_indexed';
    case 'skipped_too_large':
      return 'skipped_too_large';
    case 'skipped_unavailable':
      return 'skipped_unavailable';
    case 'skipped_empty':
      return 'skipped_empty';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

export interface CbmDeleteResult {
  status:
    | 'deleted'
    | 'not_found'
    | 'skipped_disabled'
    | 'skipped_unavailable'
    | 'skipped_in_progress'
    | 'failed';
  repoPath: string;
  message?: string | null;
}

/** Extract a human-readable message from CBM CLI JSON error payloads. */
export function parseCbmCliErrorMessage(raw: string | null | undefined): string {
  const text = raw?.trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
    if (typeof parsed.message === 'string') return parsed.message;
    return text;
  } catch {
    return text;
  }
}

export async function deleteCbmWorkspaceIndex(
  repoPath: string,
  enableCodeGraph: boolean,
): Promise<CbmDeleteResult> {
  const trimmed = repoPath.trim();
  if (!trimmed) {
    return { status: 'not_found', repoPath: '', message: null };
  }
  const result = await invokeWithRetry<CbmDeleteResult>('cbm_delete_workspace_index', {
    repoPath: trimmed,
    enableCodeGraph,
  });
  if (result.status === 'failed') {
    const detail = parseCbmCliErrorMessage(result.message);
    throw new Error(detail || 'CBM delete failed');
  }
  return result;
}

export async function fetchCbmStorageInfo(): Promise<CbmStorageInfo | null> {
  try {
    return await invokeWithRetry<CbmStorageInfo>('cbm_storage_info');
  } catch (error) {
    console.warn('CBM storage info failed:', error);
    return null;
  }
}

export function isCbmSkippedTooLarge(result: CbmScheduleResult | null | undefined): boolean {
  return result?.status === 'skipped_too_large';
}

export interface CbmIndexedProject {
  repo_path: string;
  display_name: string;
  indexed_at?: string | null;
  node_count?: number | null;
  path_status: 'ok' | 'missing' | 'not_directory';
  index_status: 'ready' | 'indexing';
  is_stale: boolean;
}

/** Wire shape from Tauri (`#[serde(rename_all = "camelCase")]`). */
export type CbmIndexedProjectWire = {
  repoPath?: string;
  repo_path?: string;
  displayName?: string;
  display_name?: string;
  indexedAt?: string | null;
  indexed_at?: string | null;
  nodeCount?: number | null;
  node_count?: number | null;
  pathStatus?: CbmIndexedProject['path_status'];
  path_status?: CbmIndexedProject['path_status'];
  indexStatus?: CbmIndexedProject['index_status'];
  index_status?: CbmIndexedProject['index_status'];
  isStale?: boolean;
  is_stale?: boolean;
};

export function normalizeCbmIndexedProject(
  raw: CbmIndexedProjectWire,
  index = 0,
): CbmIndexedProject {
  const repo_path = (raw.repoPath ?? raw.repo_path ?? '').trim();
  const display_name =
    (raw.displayName ?? raw.display_name ?? '').trim() ||
    repo_path.split(/[\\/]/).pop() ||
    `project-${index}`;

  return {
    repo_path,
    display_name,
    indexed_at: raw.indexedAt ?? raw.indexed_at ?? null,
    node_count: raw.nodeCount ?? raw.node_count ?? null,
    path_status: raw.pathStatus ?? raw.path_status ?? 'ok',
    index_status: raw.indexStatus ?? raw.index_status ?? 'ready',
    is_stale: raw.isStale ?? raw.is_stale ?? false,
  };
}

export function normalizeCbmIndexedProjects(list: CbmIndexedProjectWire[]): CbmIndexedProject[] {
  return list.map((item, index) => normalizeCbmIndexedProject(item, index));
}

/** Stable React list key even when repo_path is missing or duplicated. */
export function cbmIndexedProjectKey(project: CbmIndexedProject, index: number): string {
  const repo = project.repo_path.trim();
  if (repo) return repo;
  const name = project.display_name.trim();
  if (name) return `name:${name}:${index}`;
  return `project:${index}`;
}

export async function listIndexedProjects(): Promise<CbmIndexedProject[]> {
  const raw = await invokeWithRetry<CbmIndexedProjectWire[]>('cbm_list_indexed_projects');
  return normalizeCbmIndexedProjects(raw);
}

export interface CbmUiStatus {
  running: boolean;
  port: number;
  url: string;
  uiSupported: boolean;
  message?: string | null;
}

export interface CbmConfigSyncResult {
  success: boolean;
  errors: string[];
}

export async function syncCbmConfig(options: {
  autoIndex: boolean;
  autoIndexLimit?: number;
}): Promise<CbmConfigSyncResult | null> {
  try {
    const limit =
      options.autoIndexLimit && options.autoIndexLimit > 0 ? options.autoIndexLimit : null;
    return await invokeWithRetry<CbmConfigSyncResult>('cbm_sync_config', {
      autoIndex: options.autoIndex,
      autoIndexLimit: limit,
    });
  } catch (error) {
    console.warn('CBM config sync failed:', error);
    return null;
  }
}

export async function fetchCbmUiStatus(): Promise<CbmUiStatus | null> {
  try {
    return await invokeWithRetry<CbmUiStatus>('cbm_ui_status', undefined, 5_000);
  } catch {
    return null;
  }
}

const CBM_UI_READY_TIMEOUT_MS = 35_000;
const CBM_UI_READY_POLL_MS = 400;

export async function waitForCbmUiReady(
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<CbmUiStatus> {
  const timeoutMs = options?.timeoutMs ?? CBM_UI_READY_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? CBM_UI_READY_POLL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await fetchCbmUiStatus();
    if (status?.running) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `CBM UI 在 ${Math.round(timeoutMs / 1000)} 秒内未就绪。请运行 npm run fetch:cbm -- --force 后重启应用；开发环境下请勿让 target/debug 中的 CLI 版 sidecar 覆盖 binaries 目录中的 UI 版。`,
  );
}

export async function startCbmUiServer(): Promise<CbmUiStatus> {
  try {
    const status = await invokeWithRetry<CbmUiStatus>('cbm_start_ui', undefined, 8_000);
    if (status.running) {
      return status;
    }
    return await waitForCbmUiReady();
  } catch (error) {
    console.warn('CBM UI start failed:', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function stopCbmUiServer(): Promise<CbmUiStatus | null> {
  try {
    return await invokeWithRetry<CbmUiStatus>('cbm_stop_ui');
  } catch (error) {
    console.warn('CBM UI stop failed:', error);
    return null;
  }
}

export async function invokeCbmGraph(
  tool: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<string> {
  return invokeWithRetry<string>('cbm_graph', { tool, action, payload });
}

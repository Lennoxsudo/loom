import { invoke } from '@tauri-apps/api/core';

export type PortOwnership = 'loomManaged' | 'knownExternal' | 'external' | 'protected';

export interface PortHint {
  labelKey: string | null;
  description: string | null;
}

export interface ListeningPortEntry {
  port: number;
  address: string;
  protocol: string;
  pid: number;
  processName: string;
  commandLine: string | null;
  hint: PortHint;
  ownership: PortOwnership;
  canKill: boolean;
}

export const PORT_KILL_PERMISSION_DENIED = 'PORT_KILL_PERMISSION_DENIED';

export type PortKillFailure =
  | { type: 'permission_denied'; pid: number }
  | { type: 'generic'; message: string };

export function parsePortKillFailure(error: unknown): PortKillFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(`${PORT_KILL_PERMISSION_DENIED}:`)) {
    const pid = Number.parseInt(message.slice(PORT_KILL_PERMISSION_DENIED.length + 1), 10);
    return {
      type: 'permission_denied',
      pid: Number.isFinite(pid) ? pid : 0,
    };
  }
  if (
    message.includes('权限不足') ||
    /access is denied/i.test(message) ||
    /access denied/i.test(message)
  ) {
    const pidMatch = message.match(/PID\s*(\d+)/i);
    return {
      type: 'permission_denied',
      pid: pidMatch ? Number.parseInt(pidMatch[1], 10) : 0,
    };
  }
  return {
    type: 'generic',
    message: message || 'Failed to terminate process',
  };
}

let portScanCache: ListeningPortEntry[] | null = null;
const processPathCache = new Map<number, string | null>();

export function getCachedListeningPorts(): ListeningPortEntry[] | null {
  return portScanCache;
}

export async function getProcessExecutablePath(pid: number): Promise<string | null> {
  if (processPathCache.has(pid)) {
    return processPathCache.get(pid) ?? null;
  }
  const path = await invoke<string | null>('get_process_executable_path', { pid });
  processPathCache.set(pid, path);
  return path;
}

export function clearProcessPathCache(): void {
  processPathCache.clear();
}

export async function listListeningPorts(options?: {
  force?: boolean;
}): Promise<ListeningPortEntry[]> {
  if (!options?.force && portScanCache !== null) {
    return portScanCache;
  }
  const result = await invoke<ListeningPortEntry[]>('list_listening_ports');
  portScanCache = result;
  clearProcessPathCache();
  return result;
}

export function removeFromPortScanCache(port: number, pid: number): void {
  if (portScanCache === null) return;
  portScanCache = portScanCache.filter((entry) => !(entry.port === port && entry.pid === pid));
}

export async function killPortProcess(port: number, pid: number): Promise<void> {
  await invoke('kill_port_process', { port, pid });
  removeFromPortScanCache(port, pid);
}

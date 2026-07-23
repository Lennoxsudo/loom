import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  AGENT_SESSION_EXTRAS_STORAGE_KEY,
  PENDING_CHANGES_STORAGE_KEY,
  SESSION_EXTRAS_PERSIST_DEBOUNCE_MS,
} from '../types/chat';
import type { PendingFileChange } from '../components/agent/utils';

export interface AgentSessionExtras {
  version: 1;
  drafts: Record<string, string>;
  pendingChanges: Record<string, PendingFileChange[]>;
}

interface AgentSessionExtrasFileResponse {
  version?: number;
  drafts?: Record<string, string>;
  pendingChanges?: Record<string, PendingFileChange[]>;
  pending_changes?: Record<string, PendingFileChange[]>;
}

const EMPTY_EXTRAS: AgentSessionExtras = {
  version: 1,
  drafts: {},
  pendingChanges: {},
};

function isPendingFileChange(value: unknown): value is PendingFileChange {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.agentId === 'string' &&
    typeof record.conversationId === 'string' &&
    typeof record.filePath === 'string' &&
    typeof record.afterContent === 'string'
  );
}

function sanitizePendingChanges(
  input: Record<string, unknown> | undefined
): Record<string, PendingFileChange[]> {
  if (!input) return {};
  const result: Record<string, PendingFileChange[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Array.isArray(value)) continue;
    const items = value.filter(isPendingFileChange);
    if (items.length > 0) {
      result[key] = items;
    }
  }
  return result;
}

function sanitizeDrafts(input: Record<string, unknown> | undefined): Record<string, string> {
  if (!input) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) {
      result[key] = value;
    }
  }
  return result;
}

function readLocalSessionExtras(): AgentSessionExtras {
  try {
    const raw = localStorage.getItem(AGENT_SESSION_EXTRAS_STORAGE_KEY);
    if (!raw) return { ...EMPTY_EXTRAS };
    const parsed = JSON.parse(raw) as AgentSessionExtrasFileResponse;
    return {
      version: 1,
      drafts: sanitizeDrafts(parsed.drafts),
      pendingChanges: sanitizePendingChanges(parsed.pendingChanges ?? parsed.pending_changes),
    };
  } catch {
    return { ...EMPTY_EXTRAS };
  }
}

function readLegacyPendingChanges(): Record<string, PendingFileChange[]> {
  try {
    const raw = localStorage.getItem(PENDING_CHANGES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return sanitizePendingChanges(parsed);
  } catch {
    return {};
  }
}

function mergeSessionExtras(
  ...sources: Array<Partial<AgentSessionExtras> | null | undefined>
): AgentSessionExtras {
  const merged: AgentSessionExtras = {
    version: 1,
    drafts: {},
    pendingChanges: {},
  };

  for (const source of sources) {
    if (!source) continue;
    Object.assign(merged.drafts, source.drafts ?? {});
    Object.assign(merged.pendingChanges, source.pendingChanges ?? {});
  }

  merged.drafts = sanitizeDrafts(merged.drafts);
  merged.pendingChanges = sanitizePendingChanges(merged.pendingChanges);
  return merged;
}

function normalizeFileExtras(file: AgentSessionExtrasFileResponse | null): AgentSessionExtras {
  if (!file) return { ...EMPTY_EXTRAS };
  return {
    version: 1,
    drafts: sanitizeDrafts(file.drafts),
    pendingChanges: sanitizePendingChanges(file.pendingChanges ?? file.pending_changes),
  };
}

export function readInitialSessionExtras(): AgentSessionExtras {
  const local = readLocalSessionExtras();
  const legacyPending = readLegacyPendingChanges();
  return mergeSessionExtras(local, { pendingChanges: legacyPending });
}

export async function loadAgentSessionExtras(): Promise<AgentSessionExtras> {
  const initial = readInitialSessionExtras();

  if (!isTauri()) {
    return initial;
  }

  try {
    const file = await invoke<AgentSessionExtrasFileResponse | null>('load_agent_session_extras');
    return mergeSessionExtras(normalizeFileExtras(file), initial);
  } catch {
    return initial;
  }
}

export function writeLocalSessionExtras(extras: AgentSessionExtras): void {
  try {
    localStorage.setItem(AGENT_SESSION_EXTRAS_STORAGE_KEY, JSON.stringify(extras));
  } catch {
    // ignore persist failures
  }
}

export async function saveAgentSessionExtras(extras: AgentSessionExtras): Promise<void> {
  const sanitized = mergeSessionExtras(extras);
  writeLocalSessionExtras(sanitized);

  if (!isTauri()) return;

  try {
    await invoke('save_agent_session_extras', {
      extras: {
        version: sanitized.version,
        drafts: sanitized.drafts,
        pendingChanges: sanitized.pendingChanges,
      },
    });
  } catch {
    // ignore persist failures; localStorage backup remains
  }
}

export function createDebouncedSessionExtrasSaver(delayMs = SESSION_EXTRAS_PERSIST_DEBOUNCE_MS) {
  let timer: number | null = null;
  let latest: AgentSessionExtras | null = null;

  const flush = async () => {
    if (!latest) return;
    const snapshot = latest;
    latest = null;
    await saveAgentSessionExtras(snapshot);
  };

  return {
    schedule(extras: AgentSessionExtras) {
      latest = mergeSessionExtras(extras);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        void flush();
      }, delayMs);
    },
    async flushNow() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
    cancel() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      latest = null;
    },
  };
}

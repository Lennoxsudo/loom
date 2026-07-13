import { invoke, isTauri } from '@tauri-apps/api/core';
import { useSettingsStore } from '../stores/useSettingsStore';

export async function setSandboxContext(projectPath?: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  const mode = useSettingsStore.getState().agentAccessMode;
  const trimmedPath = projectPath?.trim();

  await invoke('set_sandbox_context', {
    accessMode: mode,
    writableRoots: trimmedPath ? [trimmedPath] : [],
    readableRoots: trimmedPath ? [trimmedPath] : [],
    networkEnabled: mode === 'full_access',
  });
}

/**
 * Register a per-execution sandbox snapshot (phase 2).
 * Concurrent agent / subagent runs should each use a distinct executionId.
 */
export async function beginSandboxExecution(options: {
  executionId: string;
  sessionId?: string;
  label?: string;
  projectPath?: string;
}): Promise<void> {
  if (!isTauri()) {
    return;
  }

  const mode = useSettingsStore.getState().agentAccessMode;
  const trimmedPath = options.projectPath?.trim();

  // Ensure workspace policy is up to date, then pin an execution snapshot.
  await setSandboxContext(trimmedPath);

  await invoke('begin_sandbox_execution', {
    executionId: options.executionId,
    sessionId: options.sessionId ?? null,
    label: options.label ?? null,
    accessMode: mode,
    writableRoots: trimmedPath ? [trimmedPath] : null,
    readableRoots: trimmedPath ? [trimmedPath] : null,
    networkEnabled: mode === 'full_access',
  });
}

export async function endSandboxExecution(executionId: string): Promise<void> {
  if (!isTauri() || !executionId.trim()) {
    return;
  }
  try {
    await invoke('end_sandbox_execution', { executionId });
  } catch {
    // best-effort cleanup
  }
}

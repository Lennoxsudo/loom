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
    networkEnabled: mode === 'full_access',
  });
}

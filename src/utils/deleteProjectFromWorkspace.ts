import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { deleteCbmWorkspaceIndex } from './cbmRuntime';
import {
  deleteProjectState,
  getProjectState,
  projectStorageKey,
} from './agentPersistence';
import { collectImagePathsFromMessages } from '../components/agent/utils';
import { normalizeProjectPath } from '../shared/lib/projectPath';
import { removeProjectStateBackupFromLocalStorage } from '../components/agent/hooks/useAgentInit';
import type { ChatMessage } from '../types/chat';

export interface DeleteProjectFromWorkspaceOptions {
  projectPath: string;
  currentProjectPath: string;
  removeRecentWorkspace: (path: string) => Promise<void>;
  clearSessionExtrasForProject: (projectKey: string) => void;
  onResetActiveProject?: () => void;
  onProjectPathChange?: (path: string) => void;
  invalidateProjectSnapshot?: (projectKey: string) => void;
  onCbmDeleteFailed?: (error: unknown) => void;
  enableCodeGraph: boolean;
}

export async function deleteProjectFromWorkspace(
  options: DeleteProjectFromWorkspaceOptions
): Promise<void> {
  const trimmedPath = options.projectPath.trim();
  if (!trimmedPath) return;

  const projectKey = await projectStorageKey(trimmedPath);
  const rawState = await getProjectState(projectKey);
  const deletedImagePaths = new Set<string>();

  if (rawState?.conversations?.length) {
    for (const conversation of rawState.conversations) {
      const messages = (conversation.messages ?? []) as ChatMessage[];
      for (const path of collectImagePathsFromMessages(messages)) {
        deletedImagePaths.add(path);
      }
    }
  }

  options.clearSessionExtrasForProject(projectKey);
  await deleteProjectState(projectKey);
  try {
    await deleteCbmWorkspaceIndex(trimmedPath, options.enableCodeGraph);
  } catch (error) {
    console.warn('CBM delete index failed:', error);
    options.onCbmDeleteFailed?.(error);
  }
  try {
    await emit('cbm-agent-project-deleted', { repo_path: trimmedPath });
  } catch {
    // non-Tauri test environments
  }
  await options.removeRecentWorkspace(trimmedPath);
  removeProjectStateBackupFromLocalStorage(projectKey);
  options.invalidateProjectSnapshot?.(projectKey);

  if (deletedImagePaths.size > 0) {
    await invoke('cleanup_unreferenced_chat_images', {
      candidatePaths: Array.from(deletedImagePaths),
    });
  }

  const isActiveProject =
    normalizeProjectPath(trimmedPath) === normalizeProjectPath(options.currentProjectPath);
  if (isActiveProject) {
    options.onResetActiveProject?.();
    options.onProjectPathChange?.('');
  }
}

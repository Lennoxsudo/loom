import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  createDefaultAgent,
  getAgent,
  getProjectState,
  getProjectsIndex,
  migrateToSingleAgent,
  projectStorageKey,
  recoverProjectStateForPath,
  touchProjectIndex,
  type Agent,
} from '../../../utils/agentPersistence';
import { getActiveProfileRuntime, type LoadedAiConfig } from '../../../utils/aiProviderRuntime';
import type { AIProvider } from '../../../utils/agentPersistence';
import {
  ensureConversationStateForAgent,
  emptyProjectConversationState,
  migrateConversationStateForProject,
  normalizeProjectPath,
  projectStateToAgentConversationState,
  toProjectConversationStateForPersistence,
} from '../utils';
import type { AgentConversationState } from '../../../types/chat';
import { hydrateSubagentRunsFromConversationState } from '../../../utils/subagents/persistSubagentRuns';
import { AGENT_CHAT_CONVERSATIONS_STORAGE_KEY } from '../../../types/chat';
import type { ProjectConversationState } from '../../../utils/agentPersistence';
import { agentPersistenceSnapshotSeedRef } from './useAgentConversationPersistence';

export interface UseAgentInitOptions {
  projectPath: string;
  loadErrorMessage: string;
  onSetAgent: (agent: Agent | null) => void;
  onSetConversationState: (state: AgentConversationState) => void;
  onSetActiveProjectKey: (key: string) => void;
  onSetIsInitializing: (v: boolean) => void;
  onSetError: (msg: string | null) => void;
  onActiveProjectPathResolved?: (path: string) => void;
  /** When true, skip the next bootstrap (project switch already loaded state). */
  skipProjectBootstrapRef?: React.MutableRefObject<boolean>;
}

function loadProjectStateBackupFromLocalStorage(
  projectKey: string
): ProjectConversationState | null {
  try {
    const raw = localStorage.getItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY);
    if (!raw) return null;
    const backup = JSON.parse(raw) as Record<string, ProjectConversationState>;
    const entry = backup[projectKey];
    if (!entry || !Array.isArray(entry.conversations) || entry.conversations.length === 0) {
      return null;
    }
    console.warn(`从 localStorage 备份恢复项目 ${projectKey} 的会话`);
    return entry;
  } catch {
    return null;
  }
}

export function removeProjectStateBackupFromLocalStorage(projectKey: string): void {
  try {
    const raw = localStorage.getItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY);
    if (!raw) return;
    const backup = JSON.parse(raw) as Record<string, ProjectConversationState>;
    if (!(projectKey in backup)) return;
    delete backup[projectKey];
    if (Object.keys(backup).length === 0) {
      localStorage.removeItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY);
    } else {
      localStorage.setItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY, JSON.stringify(backup));
    }
  } catch {
    // ignore backup failures
  }
}

async function resolveInitialProjectPath(projectPath: string): Promise<string> {
  const trimmed = projectPath.trim();
  if (trimmed) return trimmed;
  try {
    const index = await getProjectsIndex();
    const lastActive = index.lastActiveProjectPath?.trim();
    if (lastActive) return lastActive;
  } catch {
    // ignore index failures
  }
  return trimmed;
}

async function createAgentFromAiConfig(): Promise<Agent> {
  let provider: AIProvider = 'openai';
  let model = 'gpt-4o';
  let profileId: string | undefined;

  try {
    const configStr = await invoke<string>('load_ai_config');
    if (configStr) {
      const config = JSON.parse(configStr) as LoadedAiConfig;
      provider = (config.selectedProvider || 'openai') as AIProvider;
      const runtime = getActiveProfileRuntime(config, provider);
      if (runtime) {
        model = runtime.defaultModel;
        profileId = runtime.profileId || undefined;
      }
    }
  } catch {
    // use defaults
  }

  return createDefaultAgent({
    name: 'Agent',
    type: 'assistant',
    model,
    provider,
    profileId,
    temperature: 0.2,
    capabilities: {
      canExecuteCommands: true,
      canAccessBrowser: true,
      canUseGit: true,
      canUseMcp: true,
    },
  });
}

export async function loadProjectConversationStateFromDisk(
  projectPath: string,
  agent: Agent
): Promise<{ projectKey: string; state: AgentConversationState }> {
  const key = await projectStorageKey(projectPath);
  let raw = await getProjectState(key);

  // Only recover when the project file is missing. An on-disk empty state is intentional
  // (e.g. after deleting all threads) and must not be replaced by stale localStorage backup.
  if (raw == null) {
    raw =
      loadProjectStateBackupFromLocalStorage(key) ??
      (await recoverProjectStateForPath(projectPath)) ??
      null;
  }

  const projectState = raw ?? { selectedConversationId: null, conversations: [] };
  const normalized = projectStateToAgentConversationState(projectState, projectPath);
  const ensured = ensureConversationStateForAgent(agent, normalized, undefined);
  const migrated = migrateConversationStateForProject(ensured, projectPath);
  return { projectKey: key, state: migrated };
}

export function seedProjectPersistenceSnapshot(projectKey: string, state: AgentConversationState) {
  const snapshot = JSON.stringify(toProjectConversationStateForPersistence(state));
  agentPersistenceSnapshotSeedRef.current?.({ [projectKey]: snapshot });
}

export function useAgentInit(options: UseAgentInitOptions) {
  const {
    projectPath,
    loadErrorMessage,
    onSetAgent,
    onSetConversationState,
    onSetActiveProjectKey,
    onSetIsInitializing,
    onSetError,
    onActiveProjectPathResolved,
    skipProjectBootstrapRef,
  } = options;

  const bootstrapGenerationRef = useRef(0);

  useEffect(() => {
    const generation = bootstrapGenerationRef.current + 1;
    bootstrapGenerationRef.current = generation;
    let cancelled = false;

    const bootstrap = async () => {
      if (skipProjectBootstrapRef?.current) {
        skipProjectBootstrapRef.current = false;
        return;
      }

      onSetIsInitializing(true);
      onSetError(null);
      try {
        await migrateToSingleAgent();

        let agent = await getAgent();
        if (!agent) {
          agent = await createAgentFromAiConfig();
        }

        const activePath = await resolveInitialProjectPath(projectPath);
        const { projectKey, state } = await loadProjectConversationStateFromDisk(activePath, agent);
        if (activePath.trim()) {
          await touchProjectIndex(activePath);
        }

        if (cancelled || bootstrapGenerationRef.current !== generation) return;

        seedProjectPersistenceSnapshot(projectKey, state);

        onSetAgent(agent);
        onSetActiveProjectKey(projectKey);
        onSetConversationState(state);
        hydrateSubagentRunsFromConversationState(state.conversations ?? []);

        if (
          onActiveProjectPathResolved &&
          activePath.trim() &&
          normalizeProjectPath(activePath) !== normalizeProjectPath(projectPath)
        ) {
          onActiveProjectPathResolved(activePath);
        }
      } catch (error) {
        console.error('Agent init failed', error);
        if (!cancelled && bootstrapGenerationRef.current === generation) {
          onSetError(loadErrorMessage);
          onSetAgent(null);
          onSetConversationState(emptyProjectConversationState());
          onSetActiveProjectKey('');
        }
      } finally {
        if (!cancelled && bootstrapGenerationRef.current === generation) {
          onSetIsInitializing(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [
    projectPath,
    loadErrorMessage,
    onSetAgent,
    onSetConversationState,
    onSetActiveProjectKey,
    onSetIsInitializing,
    onSetError,
    onActiveProjectPathResolved,
    skipProjectBootstrapRef,
  ]);
}

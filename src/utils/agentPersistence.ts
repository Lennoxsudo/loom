import { invoke } from '@tauri-apps/api/core';
import { coerceProjectPath, normalizeProjectPath } from '../components/agent/utils';
import type { AgentConversationState } from '../types/chat';

type AgentStatus = 'online' | 'busy' | 'offline';
export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';
/** Agent composer protocol selector: a concrete provider or automatic routing. */
export type AgentProtocolSelection = AIProvider | 'auto';
export type AgentRoutingMode = 'manual' | 'auto';

export interface AgentCapabilities {
  canExecuteCommands: boolean;
  canAccessBrowser: boolean;
  canUseGit: boolean;
  canUseMcp: boolean;
}

export interface Agent {
  id: string;
  name: string;
  type: string;
  icon: string;
  status: AgentStatus;
  description?: string;
  model: string;
  provider?: AIProvider;
  profileId?: string;
  temperature: number;
  capabilities: AgentCapabilities;
  callable?: boolean;
  callableDescription?: string;
  rules?: string;
  maxContextTokens?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentPayload {
  name: string;
  type: string;
  icon?: string;
  status?: AgentStatus;
  description?: string;
  model: string;
  provider?: AIProvider;
  profileId?: string;
  temperature: number;
  capabilities: AgentCapabilities;
  callable?: boolean;
  callableDescription?: string;
  rules?: string;
  maxContextTokens?: number;
}

export interface ProjectConversationState {
  selectedConversationId: string | null;
  conversations: AgentConversationState['conversations'];
}

export interface ProjectIndexEntry {
  key: string;
  path: string;
  updatedAt: string;
}

export interface ProjectsIndex {
  version?: number;
  lastActiveProjectPath?: string | null;
  projects: ProjectIndexEntry[];
}

export interface MigrateToSingleAgentResult {
  migrated: boolean;
  migratedFromAgentCount: number;
  projectCount: number;
  agent: Agent | null;
}

const KNOWN_PROVIDERS: AIProvider[] = ['openai', 'anthropic', 'gemini', 'ollama'];

function inferProviderFromModel(model: string): AIProvider | undefined {
  const providerCandidate = model.split(':')[0] as AIProvider | undefined;
  if (!providerCandidate) {
    return undefined;
  }
  return KNOWN_PROVIDERS.includes(providerCandidate) ? providerCandidate : undefined;
}

function resolveProvider(agent: Agent): AIProvider {
  const candidate = agent.provider ?? inferProviderFromModel(agent.model);
  if (!candidate || (candidate as string) === 'claude-cli' || !KNOWN_PROVIDERS.includes(candidate)) {
    return 'openai';
  }
  return candidate;
}

function normalizeAgent(agent: Agent): Agent {
  return {
    ...agent,
    provider: resolveProvider(agent),
    rules: agent.rules ?? '',
    capabilities: {
      canExecuteCommands: agent.capabilities?.canExecuteCommands ?? true,
      canAccessBrowser: agent.capabilities?.canAccessBrowser ?? true,
      canUseGit: agent.capabilities?.canUseGit ?? true,
      canUseMcp: agent.capabilities?.canUseMcp ?? true,
    },
  };
}

const projectKeyCache = new Map<string, string>();

export async function projectStorageKey(projectPath: string): Promise<string> {
  const normalized = normalizeProjectPath(projectPath);
  const cached = projectKeyCache.get(normalized);
  if (cached) return cached;
  const key = await invoke<string>('get_project_storage_key', { projectPath: normalized });
  projectKeyCache.set(normalized, key);
  return key;
}

export async function getAgent(): Promise<Agent | null> {
  const agent = await invoke<Agent | null>('get_agent');
  return agent ? normalizeAgent(agent) : null;
}

export async function saveAgent(agent: Agent): Promise<Agent> {
  const saved = await invoke<Agent>('save_agent', { agent });
  return normalizeAgent(saved);
}

export async function createDefaultAgent(payload: CreateAgentPayload): Promise<Agent> {
  const now = new Date().toISOString();
  const agent: Agent = {
    id: crypto.randomUUID(),
    name: payload.name,
    type: payload.type,
    icon: payload.icon ?? 'AI',
    status: payload.status ?? 'online',
    description: payload.description,
    model: payload.model,
    provider: payload.provider,
    profileId: payload.profileId,
    temperature: payload.temperature,
    capabilities: payload.capabilities,
    callable: payload.callable,
    callableDescription: payload.callableDescription,
    rules: payload.rules,
    maxContextTokens: payload.maxContextTokens,
    createdAt: now,
    updatedAt: now,
  };
  return saveAgent(agent);
}

export async function getProjectState(projectKey: string): Promise<ProjectConversationState | null> {
  return await invoke<ProjectConversationState | null>('get_project_state', { projectKey });
}

export async function saveProjectState(
  projectKey: string,
  projectState: ProjectConversationState
): Promise<void> {
  await invoke('save_project_state', { projectKey, projectState });
}

export async function getProjectsIndex(): Promise<ProjectsIndex> {
  return await invoke<ProjectsIndex>('get_projects_index');
}

export async function touchProjectIndex(projectPath: string): Promise<ProjectsIndex> {
  return await invoke<ProjectsIndex>('touch_project_index', { projectPath });
}

export async function deleteProjectState(projectKey: string): Promise<void> {
  await invoke('delete_project_state', { projectKey });
}

export async function migrateToSingleAgent(): Promise<MigrateToSingleAgentResult> {
  const result = await invoke<MigrateToSingleAgentResult>('migrate_to_single_agent');
  return {
    ...result,
    agent: result.agent ? normalizeAgent(result.agent) : null,
  };
}

export async function getAgentStoragePath(): Promise<string> {
  return await invoke<string>('get_agent_storage_path');
}

export interface ProjectThreadSummary {
  id: string;
  title: string;
  updatedAt?: number;
  projectPath: string;
  projectKey: string;
}

/** Scan indexed project files for conversations whose projectPath matches the target path. */
export async function recoverProjectStateForPath(
  projectPath: string
): Promise<ProjectConversationState | null> {
  const normalizedTarget = normalizeProjectPath(projectPath);
  if (!normalizedTarget) return null;

  const index = await getProjectsIndex();
  let recovered: ProjectConversationState | null = null;

  for (const entry of index.projects) {
    const state = await getProjectState(entry.key);
    if (!state?.conversations.length) continue;

    const matching = state.conversations.filter(
      (conversation) => normalizeProjectPath(conversation.projectPath ?? '') === normalizedTarget
    );
    if (matching.length === 0) continue;

    if (!recovered) {
      recovered = {
        selectedConversationId: state.selectedConversationId,
        conversations: [...matching],
      };
      continue;
    }

    const seen = new Set(recovered.conversations.map((conversation) => conversation.id));
    for (const conversation of matching) {
      if (!seen.has(conversation.id)) {
        recovered.conversations.push(conversation);
        seen.add(conversation.id);
      }
    }
  }

  if (recovered && recovered.conversations.length > 0) {
    console.warn(`从其他项目文件恢复 ${recovered.conversations.length} 条会话到 ${normalizedTarget}`);
  }

  return recovered;
}

export async function loadAllProjectThreadSummaries(): Promise<
  Record<string, ProjectThreadSummary[]>
> {
  const index = await getProjectsIndex();
  const grouped: Record<string, ProjectThreadSummary[]> = {};

  await Promise.all(
    index.projects.map(async (entry) => {
      const state = await getProjectState(entry.key);
      if (!state?.conversations.length) return;

      for (const conversation of state.conversations) {
        const path =
          coerceProjectPath(conversation.projectPath).trim() ||
          coerceProjectPath(entry.path).trim();
        if (!path) continue;
        const pathKey = normalizeProjectPath(path);
        const summaries = grouped[pathKey] ?? (grouped[pathKey] = []);
        if (summaries.some((item) => item.id === conversation.id)) continue;
        summaries.push({
          id: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
          projectPath: path,
          projectKey: entry.key,
        });
      }
    })
  );

  // Preserve on-disk conversation order; do not reorder by updatedAt.
  return grouped;
}

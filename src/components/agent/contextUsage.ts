import { DEFAULT_CONTEXT_WINDOW, estimateMessageTokens, estimateToolsTokens } from '../../utils/contextBudget';
import { shouldInjectRules, prependRulesToFirstUserMessage } from '../../utils/rulesInjector';
import { prependPlanModeToLastUserMessage } from '../../utils/planModeInjector';
import { shouldInjectProjectPath as checkShouldInjectProjectPath } from '../../hooks/useContextInjectionState';
import { loadSkillsContext } from '../../utils/skills';
import { invoke } from '@tauri-apps/api/core';
import {
  type Agent,
  type AIProvider,
} from '../../utils/agentPersistence';
import {
  reconcileRuntimeForAgentRequest,
  resolveAgentRequestRuntime,
  type AgentRuntimeSnapshot,
} from './utils';
import type {
  AgentConversation,
  CompactState,
  PendingImageAttachment,
  ProviderRequestMessage,
  ChatMessage,
} from '../../types/chat';
import type { CompactableMessage } from '../../utils/compact';
import { buildContextForRequest, toProviderRequestMessages } from './utils';
import { maybeAutoCompactConversation } from '../../utils/compact';

export const AGENT_CONTEXT_RESERVE_TOKENS = 8192;

export interface BuildAgentContextUsageOptions {
  agent: Agent | null;
  conversation: AgentConversation | null;
  draftMessage: string;
  attachedImages: PendingImageAttachment[];
  projectPath: string;
  agentMode: 'plan' | 'always-allow';
  tools?: unknown;
  runtimeSnapshot?: AgentRuntimeSnapshotInput | null;
}

export interface AgentContextUsage {
  maxContextTokens: number;
  availableContextTokens: number;
  messageTokens: number;
  toolTokens: number;
  usedTokens: number;
  usagePercent: number;
}

export interface BuildAgentRequestContextOptions {
  agent: Agent;
  provider: AIProvider;
  model: string;
  conversation: AgentConversation | null;
  messages: ChatMessage[];
  projectPath: string;
  agentMode: 'plan' | 'always-allow';
  tools?: unknown;
  shouldInjectProjectPath?: boolean;
  subagentCatalog?: string;
  profileId?: string;
}

export type AgentRuntimeSnapshotInput = Pick<
  AgentRuntimeSnapshot,
  'provider' | 'model' | 'profileId' | 'routingMode'
>;

export async function resolveAgentContextRuntime(
  agent: Agent,
  runtime?: AgentRuntimeSnapshotInput | null,
): Promise<{ provider: AIProvider; model: string; profileId?: string }> {
  try {
    const configStr = await invoke<string>('load_ai_config');
    if (configStr) {
      const reconciled = reconcileRuntimeForAgentRequest(
        JSON.parse(configStr),
        agent,
        runtime ?? undefined,
      );
      if (reconciled) {
        return reconciled;
      }
    }
  } catch {
    // fall back to agent defaults when config cannot be loaded
  }

  return resolveAgentRequestRuntime(agent, runtime ?? undefined);
}

export interface AgentRequestContext {
  preparedMessages: unknown[];
  compressed: boolean;
  messages: ChatMessage[];
  compactState: CompactState;
  tools: unknown;
}

function buildDraftMessage(
  draftMessage: string,
  attachedImages: PendingImageAttachment[],
): ChatMessage | null {
  const text = draftMessage.trim();
  if (!text && attachedImages.length === 0) {
    return null;
  }

  return {
    id: 'draft-message',
    role: 'user',
    text,
    attachments: attachedImages.map(({ previewUrl: _previewUrl, ...attachment }) => attachment),
    createdAt: Date.now(),
  };
}

function buildAgentRequestMessages(
  messages: ChatMessage[],
  agent: Agent,
  conversation: AgentConversation | null,
  agentMode: 'plan' | 'always-allow',
): ProviderRequestMessage[] {
  const requestMessages: ProviderRequestMessage[] = toProviderRequestMessages(messages);

  if (agentMode === 'plan') {
    prependPlanModeToLastUserMessage(requestMessages);
  }

  const needsRulesInjection = shouldInjectRules(
    agent.rules ?? '',
    !!conversation?.contextInjected?.rules?.injected,
    conversation?.contextInjected?.rules?.contentHash,
  );
  if (needsRulesInjection) {
    prependRulesToFirstUserMessage(requestMessages, agent.rules ?? '');
  }

  return requestMessages;
}

export async function buildAgentRequestContext(
  options: BuildAgentRequestContextOptions,
): Promise<AgentRequestContext> {
  const {
    agent,
    provider,
    model,
    conversation,
    messages,
    projectPath,
    agentMode,
    tools,
    shouldInjectProjectPath,
    subagentCatalog,
    profileId,
  } = options;

  const maxContextTokens = agent.maxContextTokens ?? DEFAULT_CONTEXT_WINDOW;

  const compactOutcome = await maybeAutoCompactConversation({
    messages: messages as unknown as CompactableMessage[],
    provider,
    model,
    profileId: profileId ?? agent.profileId,
    tools,
    maxContextTokens,
    reserveTokens: AGENT_CONTEXT_RESERVE_TOKENS,
    compactState: conversation?.compactState,
  });

  const activeMessages = compactOutcome.messages as unknown as ChatMessage[];
  const requestMessages = buildAgentRequestMessages(activeMessages, agent, conversation, agentMode);
  const needsProjectPathInjection =
    shouldInjectProjectPath ??
    checkShouldInjectProjectPath(conversation ?? undefined, projectPath);
  const skillsContext = await loadSkillsContext(projectPath);

  const { messages: preparedMessages, tools: resolvedTools } = buildContextForRequest({
    systemPrompt: agent.description,
    projectPath,
    shouldInjectProjectPath: needsProjectPathInjection,
    skillsContext,
    subagentCatalog,
    requestMessages,
    provider,
    model,
    tools,
    maxContextTokens,
    interactionMode: agentMode,
  });

  return {
    preparedMessages,
    compressed: compactOutcome.compacted,
    messages: activeMessages,
    compactState: compactOutcome.compactState,
    tools: resolvedTools,
  };
}

export async function buildAgentContextUsage(
  options: BuildAgentContextUsageOptions,
): Promise<AgentContextUsage> {
  const { agent, conversation, draftMessage, attachedImages, projectPath, agentMode, tools, runtimeSnapshot } =
    options;
  const maxContextTokens = agent?.maxContextTokens ?? DEFAULT_CONTEXT_WINDOW;

  if (!agent) {
    return {
      maxContextTokens,
      availableContextTokens: Math.max(0, maxContextTokens - AGENT_CONTEXT_RESERVE_TOKENS),
      messageTokens: 0,
      toolTokens: 0,
      usedTokens: 0,
      usagePercent: 0,
    };
  }

  const { provider, model, profileId } = await resolveAgentContextRuntime(agent, runtimeSnapshot);

  const previousMessages = (conversation?.messages ?? []).filter((message) => !message.isStreaming);
  const draftUserMessage = buildDraftMessage(draftMessage, attachedImages);
  const allMessages = draftUserMessage ? [...previousMessages, draftUserMessage] : previousMessages;

  const { preparedMessages } = await buildAgentRequestContext({
    agent,
    provider,
    model,
    conversation,
    messages: allMessages,
    projectPath,
    agentMode,
    tools,
    profileId,
  });

  const normalizedMessages = preparedMessages as Array<{ role: string; content: unknown }>;
  const messageTokens = normalizedMessages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  );
  const toolTokens = estimateToolsTokens(tools);
  const availableContextTokens = Math.max(0, maxContextTokens - AGENT_CONTEXT_RESERVE_TOKENS);
  const usedTokens = messageTokens + toolTokens;
  const usagePercent =
    availableContextTokens > 0 ? (usedTokens / availableContextTokens) * 100 : 0;

  return {
    maxContextTokens,
    availableContextTokens,
    messageTokens,
    toolTokens,
    usedTokens,
    usagePercent,
  };
}

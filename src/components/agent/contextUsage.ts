import {
  DEFAULT_CONTEXT_WINDOW,
  estimateMessageTokens,
  estimateToolsTokens,
} from '../../utils/contextBudget';
import { shouldInjectRules, formatRulesContext, prependRulesToFirstUserMessage } from '../../utils/rulesInjector';
import {
  loadProjectMemoryContext,
  shouldInjectProjectMemory,
  prependProjectMemoryToFirstUserMessage,
} from '../../utils/projectMemory';
import {
  resolveAgentMemoryFrozenSnapshot,
  type AgentMemoryFlags,
} from '../../utils/agentMemory';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { injectPlanContextForRequest } from '../../utils/planModeInjector';
import { shouldInjectProjectPath as checkShouldInjectProjectPath } from '../../hooks/useContextInjectionState';
import { loadSkillsContext } from '../../utils/skills';
import { invoke } from '@tauri-apps/api/core';
import { type Agent, type AIProvider } from '../../utils/agentPersistence';
import {
  reconcileRuntimeForAgentRequest,
  resolveAgentRequestRuntime,
  type AgentRuntimeSnapshot,
} from './utils';
import {
  PROJECT_PATH_CONTEXT_PREFIX,
  type AgentConversation,
  type CompactState,
  type PendingImageAttachment,
  type ProviderRequestMessage,
  type ChatMessage,
} from '../../types/chat';
import type { CompactableMessage } from '../../utils/compact';
import {
  buildContextForRequestWithAiSummary,
  toProviderRequestMessages,
} from './utils';
import { maybeAutoCompactConversation } from '../../utils/compact';
import { computeCompressionThreshold } from '../../utils/compact/autoCompact';
import { estimateMessageListTokens } from '../../utils/compact/autoCompact';
import {
  buildCoreSystemPrompt,
  buildRuntimeIdentityPrompt,
} from '../../utils/coreSystemPrompt';

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

export interface AgentContextUsageBreakdown {
  system: number;
  rules: number;
  skills: number;
  tools: number;
  messages: number;
}

export interface AgentContextUsage {
  maxContextTokens: number;
  availableContextTokens: number;
  messageTokens: number;
  toolTokens: number;
  usedTokens: number;
  usagePercent: number;
  breakdown: AgentContextUsageBreakdown;
  compressionThresholdTokens: number;
  messageTokensForCompact: number;
  tokensUntilCompact: number;
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
  /** 只读统计路径置 true：不执行压缩，避免触发付费 LLM 摘要 */
  skipCompact?: boolean;
}

export type AgentRuntimeSnapshotInput = Pick<
  AgentRuntimeSnapshot,
  'provider' | 'model' | 'profileId' | 'routingMode'
>;

export async function resolveAgentContextRuntime(
  agent: Agent,
  runtime?: AgentRuntimeSnapshotInput | null
): Promise<{ provider: AIProvider; model: string; profileId?: string }> {
  try {
    const configStr = await invoke<string>('load_ai_config');
    if (configStr) {
      const reconciled = reconcileRuntimeForAgentRequest(
        JSON.parse(configStr),
        agent,
        runtime ?? undefined
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
  /** Present when a frozen Agent Memory snapshot was resolved this request */
  agentMemoryCapture?: { text: string; justCaptured: boolean };
}

function readAgentMemoryFlags(): AgentMemoryFlags {
  const s = useSettingsStore.getState();
  return {
    enableAgentMemory: s.enableAgentMemory,
    enableAgentMemoryUserProfile: s.enableAgentMemoryUserProfile,
    enableAgentMemoryNotes: s.enableAgentMemoryNotes,
  };
}

/** Flags for core system-prompt Agent Memory / session_search sections. */
function readAgentMemoryPromptFlags(): {
  enableAgentMemory: boolean;
  enableAgentSessionSearch: boolean;
} {
  const s = useSettingsStore.getState();
  return {
    enableAgentMemory:
      s.enableAgentMemory &&
      (s.enableAgentMemoryUserProfile || s.enableAgentMemoryNotes),
    enableAgentSessionSearch: s.enableAgentSessionSearch,
  };
}

function buildDraftMessage(
  draftMessage: string,
  attachedImages: PendingImageAttachment[]
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
  memoryText = ''
): ProviderRequestMessage[] {
  const requestMessages: ProviderRequestMessage[] = toProviderRequestMessages(messages);

  injectPlanContextForRequest(requestMessages, {
    interactionMode: agentMode,
    conversationId: conversation?.id,
  });

  const needsRulesInjection = shouldInjectRules(
    agent.rules ?? '',
    !!conversation?.contextInjected?.rules?.injected,
    conversation?.contextInjected?.rules?.contentHash
  );
  if (needsRulesInjection) {
    prependRulesToFirstUserMessage(requestMessages, agent.rules ?? '');
  }

  const needsMemoryInjection = shouldInjectProjectMemory(
    memoryText,
    !!conversation?.contextInjected?.memory?.injected,
    conversation?.contextInjected?.memory?.contentHash
  );
  if (needsMemoryInjection) {
    prependProjectMemoryToFirstUserMessage(requestMessages, memoryText);
  }

  return requestMessages;
}

function estimateTextTokens(text: string): number {
  if (!text.trim()) return 0;
  return estimateMessageTokens({ role: 'user', content: text });
}

function buildAgentContextBreakdown(options: {
  agent: Agent;
  provider: AIProvider;
  model: string;
  agentMode: 'plan' | 'always-allow';
  projectPath: string;
  conversation: AgentConversation | null;
  skillsContext: string;
  shouldInjectProjectPath: boolean;
  preparedMessages: Array<{ role: string; content: unknown }>;
  tools: unknown;
}): AgentContextUsageBreakdown {
  const {
    agent,
    provider,
    model,
    agentMode,
    projectPath,
    conversation,
    skillsContext,
    shouldInjectProjectPath,
    preparedMessages,
    tools,
  } = options;

  const needsRulesInjection = shouldInjectRules(
    agent.rules ?? '',
    !!conversation?.contextInjected?.rules?.injected,
    conversation?.contextInjected?.rules?.contentHash
  );

  const promptFlags = readAgentMemoryPromptFlags();
  const systemText = [
    buildRuntimeIdentityPrompt({ provider, model }),
    buildCoreSystemPrompt({
      planMode: agentMode === 'plan',
      enableAgentMemory: promptFlags.enableAgentMemory,
      enableAgentSessionSearch: promptFlags.enableAgentSessionSearch,
    }),
    agent.description?.trim() ?? '',
    shouldInjectProjectPath && projectPath.trim()
      ? `${PROJECT_PATH_CONTEXT_PREFIX}${projectPath}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const rulesTokens = needsRulesInjection
    ? estimateTextTokens(formatRulesContext(agent.rules ?? ''))
    : 0;
  const skillsTokens = estimateTextTokens(skillsContext);
  const systemTokens = estimateTextTokens(systemText);
  const toolTokens = estimateToolsTokens(tools);

  let preparedConversationTokens = 0;
  for (const message of preparedMessages) {
    if (message.role === 'system') continue;
    preparedConversationTokens += estimateMessageTokens(message);
  }

  const messagesTokens = Math.max(0, preparedConversationTokens - rulesTokens);

  return {
    system: systemTokens,
    rules: rulesTokens,
    skills: skillsTokens,
    tools: toolTokens,
    messages: messagesTokens,
  };
}

export async function buildAgentRequestContext(
  options: BuildAgentRequestContextOptions
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
    skipCompact,
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
    skipCompact,
  });

  const activeMessages = compactOutcome.messages as unknown as ChatMessage[];
  const memoryText = await loadProjectMemoryContext(projectPath);
  const requestMessages = buildAgentRequestMessages(
    activeMessages,
    agent,
    conversation,
    agentMode,
    memoryText
  );
  const needsProjectPathInjection =
    shouldInjectProjectPath ?? checkShouldInjectProjectPath(conversation ?? undefined, projectPath);
  const skillsContext = await loadSkillsContext(projectPath);

  const agentMemoryFlags = readAgentMemoryFlags();
  const agentMemorySnapshot = await resolveAgentMemoryFrozenSnapshot({
    flags: agentMemoryFlags,
    alreadyCaptured: !!conversation?.contextInjected?.agentMemory?.captured,
    frozenText: conversation?.contextInjected?.agentMemory?.frozenText,
  });
  const promptFlags = readAgentMemoryPromptFlags();

  const { messages: preparedMessages, tools: resolvedTools } =
    await buildContextForRequestWithAiSummary({
      systemPrompt: agent.description,
      projectPath,
      shouldInjectProjectPath: needsProjectPathInjection,
      skillsContext,
      agentMemoryContext: agentMemorySnapshot.text,
      enableAgentMemory: promptFlags.enableAgentMemory,
      enableAgentSessionSearch: promptFlags.enableAgentSessionSearch,
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
    agentMemoryCapture: agentMemorySnapshot,
  };
}

export async function buildAgentContextUsage(
  options: BuildAgentContextUsageOptions
): Promise<AgentContextUsage> {
  const {
    agent,
    conversation,
    draftMessage,
    attachedImages,
    projectPath,
    agentMode,
    tools,
    runtimeSnapshot,
  } = options;
  const maxContextTokens = agent?.maxContextTokens ?? DEFAULT_CONTEXT_WINDOW;

  if (!agent) {
    return {
      maxContextTokens,
      availableContextTokens: Math.max(0, maxContextTokens - AGENT_CONTEXT_RESERVE_TOKENS),
      messageTokens: 0,
      toolTokens: 0,
      usedTokens: 0,
      usagePercent: 0,
      breakdown: { system: 0, rules: 0, skills: 0, tools: 0, messages: 0 },
      compressionThresholdTokens: 0,
      messageTokensForCompact: 0,
      tokensUntilCompact: 0,
    };
  }

  const { provider, model, profileId } = await resolveAgentContextRuntime(agent, runtimeSnapshot);

  const previousMessages = (conversation?.messages ?? []).filter((message) => !message.isStreaming);
  const draftUserMessage = buildDraftMessage(draftMessage, attachedImages);
  const allMessages = draftUserMessage ? [...previousMessages, draftUserMessage] : previousMessages;

  // 只读统计路径：skipCompact 避免打字/查看用量时触发付费 LLM 摘要
  const compactOutcome = await maybeAutoCompactConversation({
    messages: allMessages as unknown as CompactableMessage[],
    provider,
    model,
    profileId,
    tools,
    maxContextTokens,
    reserveTokens: AGENT_CONTEXT_RESERVE_TOKENS,
    compactState: conversation?.compactState,
    skipCompact: true,
  });
  const activeMessages = compactOutcome.messages as unknown as ChatMessage[];

  const needsProjectPathInjection = checkShouldInjectProjectPath(conversation ?? undefined, projectPath);
  const skillsContext = (await loadSkillsContext(projectPath)) ?? '';

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
    skipCompact: true,
  });

  const normalizedMessages = preparedMessages as Array<{ role: string; content: unknown }>;
  const messageTokens = normalizedMessages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0
  );
  const toolTokens = estimateToolsTokens(tools);
  const availableContextTokens = Math.max(0, maxContextTokens - AGENT_CONTEXT_RESERVE_TOKENS);
  const usedTokens = messageTokens + toolTokens;
  const usagePercent = availableContextTokens > 0 ? (usedTokens / availableContextTokens) * 100 : 0;

  const breakdown = buildAgentContextBreakdown({
    agent,
    provider,
    model,
    agentMode,
    projectPath,
    conversation,
    skillsContext,
    shouldInjectProjectPath: needsProjectPathInjection,
    preparedMessages: normalizedMessages,
    tools,
  });

  const compressionThresholdTokens = computeCompressionThreshold({
    maxContextTokens,
    tools,
    reserveTokens: AGENT_CONTEXT_RESERVE_TOKENS,
  });
  const messageTokensForCompact = estimateMessageListTokens(
    activeMessages as unknown as CompactableMessage[]
  );
  const tokensUntilCompact = Math.max(0, compressionThresholdTokens - messageTokensForCompact);

  return {
    maxContextTokens,
    availableContextTokens,
    messageTokens,
    toolTokens,
    usedTokens,
    usagePercent,
    breakdown,
    compressionThresholdTokens,
    messageTokensForCompact,
    tokensUntilCompact,
  };
}

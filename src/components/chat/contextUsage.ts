import {
  shouldInjectRules,
  prependRulesToFirstUserMessage,
  getRulesContentHash,
} from '../../utils/rulesInjector';
import { injectPlanContextForRequest } from '../../utils/planModeInjector';
import {
  estimateMessageTokens,
  estimateToolsTokens,
  DEFAULT_CONTEXT_WINDOW,
} from '../../utils/contextBudget';
import { loadSkillsContext } from '../../utils/skills';
import { loadClaudeMd } from '../../utils/subagents/contextPolicy';
import {
  shouldInjectProjectPath,
  hashString,
} from '../../hooks/useContextInjectionState';
import { buildContextForRequestWithAiSummary } from '../agent/utils';
import { toChatPanelProviderRequestMessages, type Conversation, type Message } from './types';
import type { CompactState, ProviderRequestMessage } from '../../types/chat';
import type { AIProvider } from '../../utils/visionCapabilities';
import { maybeAutoCompactConversation } from '../../utils/compact';

export const CHAT_CONTEXT_RESERVE_TOKENS = 8192;

export interface BuildChatContextUsageOptions {
  messages: Message[];
  provider: AIProvider;
  model: string;
  profileId?: string;
  tools?: unknown;
  projectPath: string;
  chatMode: 'plan' | 'always-allow';
  chatRules: { content: string }[];
  chatRulesInjected: boolean;
  /** Hash of rules last injected (for change detection) */
  chatRulesContentHash?: string;
  /** Current conversation — used for project-path injection state */
  conversation?: Conversation | null;
  compactState?: CompactState | null;
  maxContextTokens?: number;
  /** Conversation id for plan document injection (optional). */
  conversationId?: string;
  /** 只读统计路径置 true：不执行压缩，避免触发付费 LLM 摘要 */
  skipCompact?: boolean;
  /** 用户回合：推进 compact 后再压缩门闩（发送时 true，工具续跑 false） */
  countTurn?: boolean;
}

export interface ChatContextUsage {
  preparedMessages: unknown[];
  tools: unknown;
  compressed: boolean;
  messages: Message[];
  compactState: CompactState;
  maxContextTokens: number;
  availableContextTokens: number;
  messageTokens: number;
  toolTokens: number;
  usedTokens: number;
  usagePercent: number;
  /** Merge into conversation.contextInjected after a successful send */
  contextInjectedUpdate?: Conversation['contextInjected'];
}

function buildChatRequestMessages(
  messages: Message[],
  chatRules: { content: string }[],
  chatRulesInjected: boolean,
  chatRulesContentHash: string | undefined,
  chatMode: 'plan' | 'always-allow',
  conversationId?: string
): { requestMessages: ProviderRequestMessage[]; needsRulesInjection: boolean; rulesHash: string } {
  const requestMessages = toChatPanelProviderRequestMessages(messages);
  const combinedChatRules = chatRules.map((rule) => rule.content).join('\n');
  const needsRulesInjection = shouldInjectRules(
    combinedChatRules,
    chatRulesInjected,
    chatRulesContentHash
  );

  if (needsRulesInjection) {
    prependRulesToFirstUserMessage(requestMessages, combinedChatRules);
  }

  injectPlanContextForRequest(requestMessages, {
    interactionMode: chatMode,
    conversationId,
  });

  return {
    requestMessages,
    needsRulesInjection,
    rulesHash: getRulesContentHash(combinedChatRules),
  };
}

export async function buildChatContextUsage(
  options: BuildChatContextUsageOptions
): Promise<ChatContextUsage> {
  const {
    messages,
    provider,
    model,
    profileId,
    tools,
    projectPath,
    chatMode,
    chatRules,
    chatRulesInjected,
    chatRulesContentHash,
    conversation,
    compactState,
    maxContextTokens = DEFAULT_CONTEXT_WINDOW,
    conversationId,
    skipCompact,
    countTurn,
  } = options;

  const compactOutcome = await maybeAutoCompactConversation({
    messages: messages as unknown as import('../../utils/compact').CompactableMessage[],
    provider,
    model,
    profileId,
    tools,
    maxContextTokens,
    reserveTokens: CHAT_CONTEXT_RESERVE_TOKENS,
    compactState,
    skipCompact,
    countTurn,
  });

  const activeMessages = compactOutcome.messages as unknown as Message[];

  const { requestMessages, needsRulesInjection, rulesHash } = buildChatRequestMessages(
    activeMessages,
    chatRules,
    chatRulesInjected,
    chatRulesContentHash,
    chatMode,
    conversationId ?? conversation?.id
  );
  const skillsContext = await loadSkillsContext(projectPath);
  const projectInstructionsContext = await loadClaudeMd(projectPath);
  const needsProjectPathInjection = shouldInjectProjectPath(
    conversation ?? undefined,
    projectPath
  );

  const { messages: preparedMessages } = await buildContextForRequestWithAiSummary({
    projectPath,
    shouldInjectProjectPath: needsProjectPathInjection,
    skillsContext,
    projectInstructionsContext,
    requestMessages,
    provider,
    model,
    tools,
    maxContextTokens,
    interactionMode: chatMode,
    // Agent Memory is Agent-panel only (design non-goal for Chat).
    enableAgentMemory: false,
    enableAgentSessionSearch: false,
  });

  const normalizedMessages = preparedMessages as Array<{ role: string; content: unknown }>;
  const messageTokens = normalizedMessages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0
  );
  const toolTokens = estimateToolsTokens(tools);
  const availableContextTokens = Math.max(0, maxContextTokens - CHAT_CONTEXT_RESERVE_TOKENS);
  const usedTokens = messageTokens + toolTokens;
  const usagePercent = availableContextTokens > 0 ? (usedTokens / availableContextTokens) * 100 : 0;

  let contextInjectedUpdate: Conversation['contextInjected'] | undefined;
  if (needsRulesInjection || needsProjectPathInjection) {
    contextInjectedUpdate = { ...conversation?.contextInjected };
    if (needsRulesInjection) {
      contextInjectedUpdate.rules = {
        injected: true,
        contentHash: rulesHash,
      };
    }
    if (needsProjectPathInjection && projectPath.trim()) {
      contextInjectedUpdate.projectPath = {
        injected: true,
        pathHash: hashString(projectPath),
        injectedAt: Date.now(),
      };
    }
  }

  return {
    preparedMessages,
    tools,
    compressed: compactOutcome.compacted,
    messages: activeMessages,
    compactState: compactOutcome.compactState,
    maxContextTokens,
    availableContextTokens,
    messageTokens,
    toolTokens,
    usedTokens,
    usagePercent,
    contextInjectedUpdate,
  };
}

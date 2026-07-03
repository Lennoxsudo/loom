import { shouldInjectRules, prependRulesToFirstUserMessage } from '../../utils/rulesInjector';
import { prependPlanModeToLastUserMessage } from '../../utils/planModeInjector';
import {
  estimateMessageTokens,
  estimateToolsTokens,
  DEFAULT_CONTEXT_WINDOW,
} from '../../utils/contextBudget';
import { loadSkillsContext } from '../../utils/skills';
import { buildContextForRequest } from '../agent/utils';
import { toChatPanelProviderRequestMessages, type Message } from './types';
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
  compactState?: CompactState | null;
  maxContextTokens?: number;
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
}

function buildChatRequestMessages(
  messages: Message[],
  chatRules: { content: string }[],
  chatRulesInjected: boolean,
  chatMode: 'plan' | 'always-allow',
): ProviderRequestMessage[] {
  const requestMessages = toChatPanelProviderRequestMessages(messages);
  const combinedChatRules = chatRules.map((rule) => rule.content).join('\n');
  const needsRulesInjection = shouldInjectRules(combinedChatRules, chatRulesInjected);

  if (needsRulesInjection) {
    prependRulesToFirstUserMessage(requestMessages, combinedChatRules);
  }

  if (chatMode === 'plan') {
    prependPlanModeToLastUserMessage(requestMessages);
  }

  return requestMessages;
}

export async function buildChatContextUsage(
  options: BuildChatContextUsageOptions,
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
    compactState,
    maxContextTokens = DEFAULT_CONTEXT_WINDOW,
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
  });

  const activeMessages = compactOutcome.messages as unknown as Message[];

  const requestMessages = buildChatRequestMessages(
    activeMessages,
    chatRules,
    chatRulesInjected,
    chatMode,
  );
  const skillsContext = await loadSkillsContext(projectPath);
  const { messages: preparedMessages } = buildContextForRequest({
    projectPath,
    skillsContext,
    requestMessages,
    provider,
    model,
    tools,
    maxContextTokens,
    interactionMode: chatMode,
  });

  const normalizedMessages = preparedMessages as Array<{ role: string; content: unknown }>;
  const messageTokens = normalizedMessages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  );
  const toolTokens = estimateToolsTokens(tools);
  const availableContextTokens = Math.max(0, maxContextTokens - CHAT_CONTEXT_RESERVE_TOKENS);
  const usedTokens = messageTokens + toolTokens;
  const usagePercent =
    availableContextTokens > 0 ? (usedTokens / availableContextTokens) * 100 : 0;

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
  };
}
